-- ================================================================
-- WAYPOINT RESTAURANT OS — Yönetici sipariş ayarları
--
-- Eklemelidir: tablo, kolon ve satır silmez; DROP içermez. fulfillment_settings genişletilir.
-- Varsayılanlar bugünkü davranışı korur: masa siparişi açık, sipariş alımı açık, saat sınırı yok.
-- Kurallar sipariş RPC'lerinde uygulanır; arayüzde gizlemek tek başına yetmez.
-- Personel (garson) siparişi bu ayarlardan etkilenmez: kapalıyken de masaya sipariş girebilir.
-- ================================================================

begin;

alter table public.fulfillment_settings add column if not exists dine_in_enabled boolean not null default true;
alter table public.fulfillment_settings add column if not exists accepting_orders boolean not null default true;
alter table public.fulfillment_settings add column if not exists auto_open_order_type boolean not null default true;
alter table public.fulfillment_settings add column if not exists hours_enabled boolean not null default false;
-- Gün (0=Pazar) → {"open":"09:00","close":"23:00"}. Olmayan gün kapalıdır; kapanış açılıştan küçükse ertesi güne sarkar.
alter table public.fulfillment_settings add column if not exists operating_hours jsonb not null default '{}'::jsonb;
alter table public.fulfillment_settings add column if not exists timezone text not null default 'Europe/Istanbul';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'delivery_zones_postal_format') then
    alter table public.delivery_zones add constraint delivery_zones_postal_format
      check (array_to_string(postal_codes, ',') ~ '^[0-9]{5}(,[0-9]{5})*$');
  end if;
end $$;

-- ── Sipariş alımı kararı ───────────────────────────────────────
create or replace function pos_private.ordering_block() returns text
language plpgsql stable set search_path = public, pg_temp
as $$
declare
  v_settings public.fulfillment_settings;
  v_local    timestamp;
  v_time     time;
  v_today    jsonb;
  v_previous jsonb;
begin
  select * into v_settings from public.fulfillment_settings where id = 1;
  if not v_settings.accepting_orders then return 'ordering_closed'; end if;
  if not v_settings.hours_enabled then return null; end if;
  v_local := now() at time zone v_settings.timezone;
  v_time := v_local::time;
  v_today := v_settings.operating_hours -> extract(dow from v_local)::int::text;
  v_previous := v_settings.operating_hours -> extract(dow from v_local - interval '1 day')::int::text;
  if v_today is not null then
    if (v_today ->> 'open')::time < (v_today ->> 'close')::time then
      if v_time >= (v_today ->> 'open')::time and v_time < (v_today ->> 'close')::time then return null; end if;
    elsif v_time >= (v_today ->> 'open')::time then
      return null;
    end if;
  end if;
  if v_previous is not null and (v_previous ->> 'close')::time < (v_previous ->> 'open')::time and v_time < (v_previous ->> 'close')::time then
    return null;
  end if;
  return 'outside_hours';
end;
$$;

create or replace function public.get_ordering_config() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_settings public.fulfillment_settings;
  v_block    text := pos_private.ordering_block();
begin
  select * into v_settings from public.fulfillment_settings where id = 1;
  return jsonb_build_object(
    'pickup', v_block is null and v_settings.pickup_enabled and v_settings.allow_pay_at_pickup,
    'delivery', v_block is null and v_settings.delivery_enabled and v_settings.allow_cash_on_delivery and exists (select 1 from public.delivery_zones z where z.is_active),
    'dine_in', v_block is null and v_settings.dine_in_enabled,
    'auto_open', v_settings.auto_open_order_type,
    'blocked', v_block);
end;
$$;

-- ── Müşteri siparişi: tekrar gönderim önce çözülür, kapalıyken de mevcut siparişi döndürür ──
create or replace function public.get_qr_table(p_table_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_table public.restaurant_tables;
  v_block text;
begin
  select * into v_table from public.restaurant_tables where id = pos_private.table_by_token(p_table_token);
  v_block := pos_private.ordering_block();
  if v_block is not null then perform pos_private.fail(v_block); end if;
  if not (select dine_in_enabled from public.fulfillment_settings where id = 1) then perform pos_private.fail('channel_closed'); end if;
  return jsonb_build_object('table_label', v_table.label);
end;
$$;

create or replace function public.place_qr_order(
  p_table_token text, p_idempotency_key uuid, p_items jsonb,
  p_note text default null, p_client_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_table_id uuid := pos_private.table_by_token(p_table_token);
  v_block text;
begin
  if not exists (select 1 from public.orders where idempotency_key = p_idempotency_key) then
    v_block := pos_private.ordering_block();
    if v_block is not null then perform pos_private.fail(v_block); end if;
    if not (select dine_in_enabled from public.fulfillment_settings where id = 1) then perform pos_private.fail('channel_closed'); end if;
  end if;
  return pos_private.create_order(v_table_id, 'qr', auth.uid(), p_idempotency_key, p_items, p_note, p_client_ref);
end;
$$;

create or replace function public.place_online_order(
  p_fulfillment_type text, p_idempotency_key uuid, p_items jsonb, p_customer jsonb,
  p_address jsonb default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_settings public.fulfillment_settings;
  v_order    public.orders;
  v_ff       public.order_fulfillments;
  v_zone     public.delivery_zones;
  v_name     text := trim(coalesce(p_customer ->> 'name', ''));
  v_phone    text := regexp_replace(coalesce(p_customer ->> 'phone', ''), '[^0-9]', '', 'g');
  v_street   text := trim(coalesce(p_address ->> 'street', ''));
  v_district text := trim(coalesce(p_address ->> 'district', ''));
  v_postal   text := trim(coalesce(p_address ->> 'postal_code', ''));
  v_block    text;
  v_subtotal bigint;
  v_fee      bigint := 0;
begin
  if p_fulfillment_type not in ('pickup', 'delivery') then perform pos_private.fail('invalid_fulfillment'); end if;
  if p_idempotency_key is null then perform pos_private.fail('idempotency_key_required'); end if;

  -- Aynı anahtarlı eşzamanlı istekler sıraya girer; ikincisi mevcut siparişi bulur.
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_order from public.orders where idempotency_key = p_idempotency_key;
  if found then
    if v_order.fulfillment_type <> p_fulfillment_type then perform pos_private.fail('idempotency_key_conflict'); end if;
    select * into v_ff from public.order_fulfillments where order_id = v_order.id;
    return pos_private.online_order_json(v_order, v_ff, true);
  end if;

  v_block := pos_private.ordering_block();
  if v_block is not null then perform pos_private.fail(v_block); end if;
  select * into v_settings from public.fulfillment_settings where id = 1;
  if p_fulfillment_type = 'pickup' and not (v_settings.pickup_enabled and v_settings.allow_pay_at_pickup) then perform pos_private.fail('channel_closed'); end if;
  if p_fulfillment_type = 'delivery' and not (v_settings.delivery_enabled and v_settings.allow_cash_on_delivery) then perform pos_private.fail('channel_closed'); end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then perform pos_private.fail('empty_order'); end if;
  if jsonb_array_length(p_items) > 30 then perform pos_private.fail('too_many_lines'); end if;
  if char_length(p_note) > 300 then perform pos_private.fail('note_too_long'); end if;
  if char_length(v_name) not between 2 and 80 then perform pos_private.fail('invalid_name'); end if;
  if v_phone !~ '^[0-9]{10,15}$' then perform pos_private.fail('invalid_phone'); end if;

  if (select count(*) from public.order_fulfillments where customer_phone = v_phone and created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.order_fulfillments where created_at > now() - interval '5 minutes') >= 60 then
    perform pos_private.fail('rate_limited');
  end if;

  if p_fulfillment_type = 'delivery' then
    if char_length(v_street) not between 5 and 200 or char_length(v_district) not between 2 and 80 or v_postal !~ '^[0-9]{5}$' then
      perform pos_private.fail('invalid_address');
    end if;
    if char_length(p_address ->> 'building') > 20 or char_length(p_address ->> 'floor') > 20 or char_length(p_address ->> 'door') > 20
       or char_length(p_address ->> 'apartment') > 60 or char_length(p_address ->> 'instructions') > 300 then
      perform pos_private.fail('invalid_address');
    end if;
    v_zone := pos_private.find_zone(v_postal, v_district);
    if v_zone.id is null then perform pos_private.fail('out_of_area'); end if;
    v_fee := v_zone.fee_cents;
  end if;

  insert into public.orders(idempotency_key, fulfillment_type, source, note)
    values (p_idempotency_key, p_fulfillment_type, 'qr', nullif(trim(p_note), ''))
    returning * into v_order;
  v_subtotal := pos_private.add_order_items(v_order.id, p_items);
  if p_fulfillment_type = 'delivery' and v_subtotal < v_zone.min_order_cents then
    perform pos_private.fail('below_minimum', v_zone.min_order_cents::text);
  end if;

  update public.orders set subtotal_cents = v_subtotal where id = v_order.id returning * into v_order;
  insert into public.order_status_history(order_id, from_status, to_status) values (v_order.id, null, 'new');
  insert into public.order_fulfillments(order_id, customer_name, customer_phone, payment_method, delivery_fee_cents, total_cents,
      zone_id, street, district, postal_code, building, floor, door, apartment, instructions)
    values (v_order.id, v_name, v_phone, case when p_fulfillment_type = 'pickup' then 'pay_at_pickup' else 'cash_on_delivery' end,
      v_fee, v_subtotal + v_fee, v_zone.id, nullif(v_street, ''), nullif(v_district, ''), nullif(v_postal, ''),
      nullif(trim(p_address ->> 'building'), ''), nullif(trim(p_address ->> 'floor'), ''), nullif(trim(p_address ->> 'door'), ''),
      nullif(trim(p_address ->> 'apartment'), ''), nullif(trim(p_address ->> 'instructions'), ''))
    returning * into v_ff;
  return pos_private.online_order_json(v_order, v_ff, false);
end;
$$;

-- ── Yönetici ayarları: yalnızca bu RPC yazar, doğrular ve denetim kaydı tutar ──
create or replace function public.update_ordering_settings(p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['admin']);
  v_key   text;
  v_day   jsonb;
  v_hours jsonb := coalesce(p_settings -> 'operating_hours', '{}'::jsonb);
  v_row   public.fulfillment_settings;
begin
  if jsonb_typeof(p_settings) <> 'object' then perform pos_private.fail('invalid_settings'); end if;
  foreach v_key in array array['dine_in_enabled', 'pickup_enabled', 'delivery_enabled', 'accepting_orders', 'auto_open_order_type', 'hours_enabled'] loop
    if jsonb_typeof(p_settings -> v_key) is distinct from 'boolean' then perform pos_private.fail('invalid_settings', v_key); end if;
  end loop;
  if jsonb_typeof(v_hours) <> 'object' then perform pos_private.fail('invalid_hours'); end if;
  for v_key, v_day in select key, value from jsonb_each(v_hours) loop
    if v_key !~ '^[0-6]$' or jsonb_typeof(v_day) <> 'object'
       or coalesce(v_day ->> 'open', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(v_day ->> 'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or v_day ->> 'open' = v_day ->> 'close' then
      perform pos_private.fail('invalid_hours', v_key);
    end if;
  end loop;
  if (p_settings -> 'hours_enabled')::boolean and v_hours = '{}'::jsonb then perform pos_private.fail('invalid_hours'); end if;

  -- Tek ödeme yöntemi var: kanal açılırsa ilgili ödeme de açılır.
  update public.fulfillment_settings set
    dine_in_enabled = (p_settings -> 'dine_in_enabled')::boolean,
    pickup_enabled = (p_settings -> 'pickup_enabled')::boolean,
    allow_pay_at_pickup = (p_settings -> 'pickup_enabled')::boolean,
    delivery_enabled = (p_settings -> 'delivery_enabled')::boolean,
    allow_cash_on_delivery = (p_settings -> 'delivery_enabled')::boolean,
    accepting_orders = (p_settings -> 'accepting_orders')::boolean,
    auto_open_order_type = (p_settings -> 'auto_open_order_type')::boolean,
    hours_enabled = (p_settings -> 'hours_enabled')::boolean,
    operating_hours = v_hours,
    updated_at = now()
  where id = 1 returning * into v_row;
  insert into public.audit_log(actor, action, entity, entity_id, details)
    values (v_actor, 'settings.ordering', 'fulfillment_settings', '1', p_settings);
  return to_jsonb(v_row);
end;
$$;

-- ── Yetkiler ───────────────────────────────────────────────────
-- Ayarlar yalnızca RPC ile değişir; doğrudan güncelleme kapatılır. RLS açık kalır.
revoke update on public.fulfillment_settings from authenticated;
revoke all on all functions in schema pos_private from public, anon, authenticated;
revoke execute on function public.update_ordering_settings(jsonb) from public, anon, authenticated;
grant execute on function public.update_ordering_settings(jsonb) to authenticated;
revoke execute on function public.get_ordering_config(), public.get_qr_table(text), public.place_qr_order(text, uuid, jsonb, text, text),
  public.place_online_order(text, uuid, jsonb, jsonb, jsonb, text) from public;
grant execute on function public.get_ordering_config(), public.get_qr_table(text), public.place_qr_order(text, uuid, jsonb, text, text),
  public.place_online_order(text, uuid, jsonb, jsonb, jsonb, text) to anon, authenticated;

commit;
