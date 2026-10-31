-- ================================================================
-- WAYPOINT RESTAURANT OS — Masa, paket ve kurye siparişleri
--
-- Eklemelidir: tablo, kolon ve satır silmez; DROP içermez. Mevcut siparişler dine_in olur.
-- orders.table_id/session_id/bill_id NOT NULL kaldırılır; yeni CHECK masa siparişlerinde üçünü
-- de zorunlu, paket ve kuryede boş tutar (sahte masa veya adisyon olmaz).
-- update_order_status güncellenir: masa siparişinin davranışı aynıdır.
-- Paket ve kurye varsayılan olarak KAPALIDIR, bölge eklenmez: ücret ve kapsam yönetici tanımlar.
-- Kişisel veriler ayrı tabloda; mutfak ve garson okuyamaz, Realtime yayınına eklenmez.
-- ================================================================

begin;

create table if not exists public.fulfillment_settings (
  id                     integer primary key default 1 check (id = 1),
  pickup_enabled         boolean not null default false,
  delivery_enabled       boolean not null default false,
  allow_pay_at_pickup    boolean not null default false,
  allow_cash_on_delivery boolean not null default false,
  updated_at             timestamptz not null default now()
);
insert into public.fulfillment_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.delivery_zones (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(trim(name)) between 1 and 80),
  postal_codes    text[] not null check (cardinality(postal_codes) > 0),
  districts       text[] not null default '{}',
  fee_cents       bigint not null check (fee_cents >= 0),
  min_order_cents bigint not null default 0 check (min_order_cents >= 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

alter table public.orders add column if not exists fulfillment_type text not null default 'dine_in';
alter table public.orders alter column table_id drop not null;
alter table public.orders alter column session_id drop not null;
alter table public.orders alter column bill_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_fulfillment_type_check') then
    alter table public.orders add constraint orders_fulfillment_type_check check (fulfillment_type in ('dine_in', 'pickup', 'delivery'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_table_matches_fulfillment') then
    alter table public.orders add constraint orders_table_matches_fulfillment check (
      (fulfillment_type = 'dine_in' and table_id is not null and session_id is not null and bill_id is not null)
      or (fulfillment_type <> 'dine_in' and table_id is null and session_id is null and bill_id is null));
  end if;
end $$;
create index if not exists orders_fulfillment_type_idx on public.orders(fulfillment_type, created_at) where fulfillment_type <> 'dine_in';

-- Teslimat durumu mutfak durumundan ayrıdır: orders.status mutfağın, status buranın.
create table if not exists public.order_fulfillments (
  order_id           uuid primary key references public.orders(id) on delete cascade,
  tracking_token     text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  status             text not null default 'pending'
                     check (status in ('pending', 'awaiting_handoff', 'handed_to_courier', 'delivered', 'collected', 'cancelled')),
  customer_name      text not null check (char_length(customer_name) between 2 and 80),
  customer_phone     text not null check (customer_phone ~ '^[0-9]{10,15}$'),
  payment_method     text not null check (payment_method in ('pay_at_pickup', 'cash_on_delivery')),
  payment_status     text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  paid_method        text check (paid_method in ('cash', 'card')),
  paid_at            timestamptz,
  paid_by            uuid references auth.users(id) on delete set null,
  delivery_fee_cents bigint not null default 0 check (delivery_fee_cents >= 0),
  total_cents        bigint not null check (total_cents >= 0),
  zone_id            uuid references public.delivery_zones(id) on delete set null,
  street             text check (char_length(street) <= 200),
  district           text check (char_length(district) <= 80),
  postal_code        text check (char_length(postal_code) <= 10),
  building           text check (char_length(building) <= 20),
  floor              text check (char_length(floor) <= 20),
  door               text check (char_length(door) <= 20),
  apartment          text check (char_length(apartment) <= 60),
  instructions       text check (char_length(instructions) <= 300),
  courier_name       text check (char_length(courier_name) <= 80),
  handed_at          timestamptz,
  completed_at       timestamptz,
  updated_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((payment_status = 'paid') = (paid_at is not null))
);
create index if not exists order_fulfillments_phone_idx on public.order_fulfillments(customer_phone, created_at);
create index if not exists order_fulfillments_status_idx on public.order_fulfillments(status, created_at);

-- ── Yardımcılar ────────────────────────────────────────────────
create or replace function pos_private.norm_text(p_value text) returns text
language sql immutable set search_path = pg_catalog, pg_temp
as $$ select lower(translate(trim(coalesce(p_value, '')), 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc')) $$;

create or replace function pos_private.find_zone(p_postal_code text, p_district text) returns public.delivery_zones
language sql stable set search_path = public, pg_temp
as $$
  select z.* from public.delivery_zones z
  where z.is_active and trim(coalesce(p_postal_code, '')) = any(z.postal_codes)
    and (cardinality(z.districts) = 0 or pos_private.norm_text(p_district) in (select pos_private.norm_text(d) from unnest(z.districts) d))
  order by z.created_at limit 1
$$;

-- Fiyat ve ad her zaman sunucudaki menüden gelir.
create or replace function pos_private.add_order_items(p_order_id uuid, p_items jsonb) returns bigint
language plpgsql set search_path = public, pg_temp
as $$
declare
  v_line      jsonb;
  v_item      public.menu_items;
  v_item_id   uuid;
  v_qty       integer;
  v_line_note text;
  v_unit      bigint;
  v_subtotal  bigint := 0;
  v_position  smallint := 0;
begin
  for v_line in select value from jsonb_array_elements(p_items) loop
    v_position := v_position + 1;
    if jsonb_typeof(v_line) <> 'object' then perform pos_private.fail('invalid_line', v_position::text); end if;
    begin
      v_item_id := (v_line ->> 'menu_item_id')::uuid;
      v_qty := (v_line ->> 'quantity')::integer;
    exception when others then
      perform pos_private.fail('invalid_line', v_position::text);
    end;
    if v_qty is null or v_qty < 1 or v_qty > 20 then perform pos_private.fail('invalid_quantity', v_position::text); end if;
    v_line_note := nullif(trim(v_line ->> 'note'), '');
    if char_length(v_line_note) > 200 then perform pos_private.fail('note_too_long', v_position::text); end if;
    select * into v_item from public.menu_items where id = v_item_id;
    if not found or v_item.is_available is false then perform pos_private.fail('item_unavailable', coalesce(v_item_id::text, '')); end if;
    if v_item.price is null or v_item.price <= 0 then perform pos_private.fail('invalid_price', v_item_id::text); end if;
    v_unit := round(v_item.price * 100)::bigint;
    insert into public.order_items(order_id, position, menu_item_id, item_name, unit_price_cents, quantity, note)
      values (p_order_id, v_position, v_item.id, v_item.name, v_unit, v_qty, v_line_note);
    v_subtotal := v_subtotal + v_unit * v_qty;
  end loop;
  return v_subtotal;
end;
$$;

create or replace function pos_private.online_order_json(p_order public.orders, p_ff public.order_fulfillments, p_duplicate boolean) returns jsonb
language sql stable set search_path = public, pg_temp
as $$
  select pos_private.order_json(p_order, p_duplicate) || jsonb_build_object(
    'fulfillment_type', p_order.fulfillment_type, 'tracking_token', p_ff.tracking_token,
    'delivery_fee_cents', p_ff.delivery_fee_cents, 'total_cents', p_ff.total_cents,
    'payment_method', p_ff.payment_method, 'payment_status', p_ff.payment_status)
$$;

-- ── Müşteri RPC'leri (hesap gerektirmez) ───────────────────────
create or replace function public.get_ordering_config() returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'pickup', s.pickup_enabled and s.allow_pay_at_pickup,
    'delivery', s.delivery_enabled and s.allow_cash_on_delivery and exists (select 1 from public.delivery_zones z where z.is_active))
  from public.fulfillment_settings s where s.id = 1
$$;

create or replace function public.check_delivery_address(p_postal_code text, p_district text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_zone public.delivery_zones;
begin
  v_zone := pos_private.find_zone(p_postal_code, p_district);
  if v_zone.id is null then return jsonb_build_object('in_area', false); end if;
  return jsonb_build_object('in_area', true, 'zone_name', v_zone.name, 'fee_cents', v_zone.fee_cents, 'min_order_cents', v_zone.min_order_cents);
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

-- Takip bağlantısı kişisel veri döndürmez: ad, telefon, adres ve kurye adı yok.
create or replace function public.get_order_tracking(p_tracking_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_ff    public.order_fulfillments;
  v_order public.orders;
begin
  if p_tracking_token is null or p_tracking_token !~ '^[0-9a-f]{64}$' then perform pos_private.fail('invalid_tracking'); end if;
  select * into v_ff from public.order_fulfillments where tracking_token = p_tracking_token;
  if not found then perform pos_private.fail('invalid_tracking'); end if;
  select * into v_order from public.orders where id = v_ff.order_id;
  return jsonb_build_object(
    'order_number', v_order.order_number, 'fulfillment_type', v_order.fulfillment_type,
    'kitchen_status', v_order.status, 'fulfillment_status', v_ff.status,
    'payment_method', v_ff.payment_method, 'payment_status', v_ff.payment_status,
    'subtotal_cents', v_order.subtotal_cents, 'delivery_fee_cents', v_ff.delivery_fee_cents, 'total_cents', v_ff.total_cents,
    'created_at', v_order.created_at,
    'items', (select jsonb_agg(jsonb_build_object('name', i.item_name, 'quantity', i.quantity, 'line_total_cents', i.line_total_cents, 'note', i.note) order by i.position)
              from public.order_items i where i.order_id = v_order.id));
end;
$$;

-- ── Personel RPC'leri ──────────────────────────────────────────
-- Masa siparişi önceki davranışıyla aynıdır. Paket ve kuryede adisyon yoktur, "servis" adımı teslimden gelir.
create or replace function public.update_order_status(
  p_order_id uuid, p_status text, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_role   text := public.pos_current_role();
  v_actor  uuid := auth.uid();
  v_order  public.orders;
  v_allowed text[];
  v_online boolean;
begin
  if v_role is null then perform pos_private.fail('forbidden'); end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then perform pos_private.fail('order_not_found'); end if;
  if v_order.status = p_status then return pos_private.order_json(v_order, true); end if;
  v_online := v_order.fulfillment_type <> 'dine_in';
  -- FOR SHARE: eşzamanlı masa kapatma ile yarışmaz; kapanış bitene kadar bekler.
  if not v_online and not exists (select 1 from public.bills where id = v_order.bill_id and status = 'open' for share) then
    perform pos_private.fail('bill_closed');
  end if;

  -- Geçiş → bu geçişi yapabilen roller
  v_allowed := case v_order.status || '>' || p_status
    when 'new>preparing'      then array['kitchen', 'manager', 'admin']
    when 'preparing>ready'    then array['kitchen', 'manager', 'admin']
    when 'ready>served'       then case when v_online then null else array['waiter', 'kitchen', 'manager', 'admin'] end
    when 'new>cancelled'      then case when v_online then array['cashier', 'manager', 'admin'] else array['waiter', 'manager', 'admin'] end
    when 'preparing>cancelled' then array['manager', 'admin']
    when 'ready>cancelled'    then array['manager', 'admin']
    when 'served>cancelled'   then case when v_online then null else array['manager', 'admin'] end
  end;
  if v_allowed is null then perform pos_private.fail('invalid_transition', v_order.status || '>' || p_status); end if;
  if not v_role = any(v_allowed) then perform pos_private.fail('forbidden'); end if;
  if p_status = 'cancelled' and v_order.status <> 'new' and nullif(trim(p_reason), '') is null then
    perform pos_private.fail('reason_required');
  end if;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by, reason)
    values (p_order_id, v_order.status, p_status, v_actor, nullif(trim(p_reason), ''));
  update public.orders set status = p_status, updated_at = now(),
         cancelled_at = case when p_status = 'cancelled' then now() end,
         cancel_reason = case when p_status = 'cancelled' then nullif(trim(p_reason), '') end
    where id = p_order_id returning * into v_order;
  if v_online and p_status in ('ready', 'cancelled') then
    update public.order_fulfillments
       set status = case when p_status = 'ready' then 'awaiting_handoff' else 'cancelled' end, updated_at = now(), updated_by = v_actor
     where order_id = p_order_id;
  end if;
  if p_status = 'cancelled' then
    insert into public.audit_log(actor, action, entity, entity_id, details)
      values (v_actor, 'order.cancel', 'orders', p_order_id::text,
              jsonb_build_object('reason', p_reason, 'subtotal_cents', v_order.subtotal_cents));
  end if;
  return pos_private.order_json(v_order, false);
end;
$$;

-- Kuryeye verildi / teslim edildi yalnızca personelin onayıyla işlenir; otomatik sevk yoktur.
create or replace function public.update_fulfillment_status(p_order_id uuid, p_status text, p_courier_name text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['cashier', 'manager', 'admin']);
  v_order public.orders;
  v_ff    public.order_fulfillments;
  v_courier text;
  v_path  text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.fulfillment_type = 'dine_in' then perform pos_private.fail('order_not_found'); end if;
  select * into v_ff from public.order_fulfillments where order_id = p_order_id for update;
  if v_ff.status = p_status then return jsonb_build_object('status', v_ff.status, 'duplicate', true); end if;
  v_path := v_order.fulfillment_type || ':' || v_ff.status || '>' || p_status;
  if v_path not in ('pickup:awaiting_handoff>collected', 'delivery:awaiting_handoff>handed_to_courier', 'delivery:handed_to_courier>delivered') then
    perform pos_private.fail('invalid_transition', v_path);
  end if;
  v_courier := coalesce(nullif(trim(p_courier_name), ''), v_ff.courier_name);
  if p_status = 'handed_to_courier' and v_courier is null then perform pos_private.fail('courier_required'); end if;

  update public.order_fulfillments set status = p_status, courier_name = v_courier, updated_at = now(), updated_by = v_actor,
         handed_at = case when p_status in ('handed_to_courier', 'collected') then now() else handed_at end,
         completed_at = case when p_status in ('delivered', 'collected') then now() else completed_at end
   where order_id = p_order_id returning * into v_ff;
  -- Mutfağın işi bitti: fiş Servis sütununa geçer. Değişiklik orders üzerinden Realtime sinyali olur.
  if v_order.status = 'ready' then
    insert into public.order_status_history(order_id, from_status, to_status, changed_by) values (p_order_id, 'ready', 'served', v_actor);
    update public.orders set status = 'served', updated_at = now() where id = p_order_id;
  else
    update public.orders set updated_at = now() where id = p_order_id;
  end if;
  insert into public.audit_log(actor, action, entity, entity_id, details)
    values (v_actor, 'fulfillment.update', 'orders', p_order_id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('status', v_ff.status, 'duplicate', false);
end;
$$;

create or replace function public.assign_order_courier(p_order_id uuid, p_courier_name text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['cashier', 'manager', 'admin']);
  v_ff public.order_fulfillments;
begin
  if char_length(trim(coalesce(p_courier_name, ''))) not between 2 and 80 then perform pos_private.fail('courier_required'); end if;
  update public.order_fulfillments f set courier_name = trim(p_courier_name), updated_at = now(), updated_by = v_actor
    from public.orders o
   where f.order_id = p_order_id and o.id = f.order_id and o.fulfillment_type = 'delivery' and f.status in ('pending', 'awaiting_handoff')
   returning f.* into v_ff;
  if v_ff.order_id is null then perform pos_private.fail('invalid_transition'); end if;
  update public.orders set updated_at = now() where id = p_order_id;
  insert into public.audit_log(actor, action, entity, entity_id) values (v_actor, 'fulfillment.assign_courier', 'orders', p_order_id::text);
  return jsonb_build_object('courier_name', v_ff.courier_name);
end;
$$;

-- Ödeme yalnızca personel tahsilatı onaylayınca işlenir; yöntem seçmek ödeme sayılmaz.
create or replace function public.record_fulfillment_payment(p_order_id uuid, p_method text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['cashier', 'manager', 'admin']);
  v_ff public.order_fulfillments;
begin
  if p_method not in ('cash', 'card') then perform pos_private.fail('invalid_method'); end if;
  select * into v_ff from public.order_fulfillments where order_id = p_order_id for update;
  if not found then perform pos_private.fail('order_not_found'); end if;
  if v_ff.status = 'cancelled' then perform pos_private.fail('invalid_transition'); end if;
  if v_ff.payment_status = 'paid' then return jsonb_build_object('payment_status', 'paid', 'duplicate', true); end if;
  update public.order_fulfillments set payment_status = 'paid', paid_method = p_method, paid_at = now(), paid_by = v_actor, updated_at = now(), updated_by = v_actor
   where order_id = p_order_id;
  update public.orders set updated_at = now() where id = p_order_id;
  insert into public.audit_log(actor, action, entity, entity_id, details)
    values (v_actor, 'fulfillment.payment', 'orders', p_order_id::text, jsonb_build_object('amount_cents', v_ff.total_cents, 'method', p_method));
  return jsonb_build_object('payment_status', 'paid', 'duplicate', false);
end;
$$;

-- ── Yetkiler ve RLS ────────────────────────────────────────────
revoke all on public.fulfillment_settings, public.delivery_zones, public.order_fulfillments from anon, authenticated;
grant select on public.fulfillment_settings, public.delivery_zones, public.order_fulfillments to authenticated;
grant update on public.fulfillment_settings to authenticated;
grant insert, update on public.delivery_zones to authenticated;

alter table public.fulfillment_settings enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.order_fulfillments enable row level security;

do $$
declare
  p text[];
begin
  foreach p slice 1 in array array[
    ['fulfillment_settings', 'Fulfillment staff read settings',
     $q$for select to authenticated using ((select public.pos_has_role(array['cashier', 'manager', 'admin'])))$q$],
    ['fulfillment_settings', 'Managers update settings',
     $q$for update to authenticated using ((select public.pos_has_role(array['manager', 'admin']))) with check ((select public.pos_has_role(array['manager', 'admin'])))$q$],
    ['delivery_zones', 'Fulfillment staff read zones',
     $q$for select to authenticated using ((select public.pos_has_role(array['cashier', 'manager', 'admin'])))$q$],
    ['delivery_zones', 'Managers insert zones',
     $q$for insert to authenticated with check ((select public.pos_has_role(array['manager', 'admin'])))$q$],
    ['delivery_zones', 'Managers update zones',
     $q$for update to authenticated using ((select public.pos_has_role(array['manager', 'admin']))) with check ((select public.pos_has_role(array['manager', 'admin'])))$q$],
    ['order_fulfillments', 'Fulfillment staff read customer details',
     $q$for select to authenticated using ((select public.pos_has_role(array['cashier', 'manager', 'admin'])))$q$]
  ] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p[1] and policyname = p[2]) then
      execute format('create policy %I on public.%I %s', p[2], p[1], p[3]);
    end if;
  end loop;
end $$;

revoke all on all functions in schema pos_private from public, anon, authenticated;
revoke execute on function public.get_ordering_config(), public.check_delivery_address(text, text),
  public.place_online_order(text, uuid, jsonb, jsonb, jsonb, text), public.get_order_tracking(text),
  public.update_fulfillment_status(uuid, text, text), public.assign_order_courier(uuid, text),
  public.record_fulfillment_payment(uuid, text), public.update_order_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_ordering_config(), public.check_delivery_address(text, text),
  public.place_online_order(text, uuid, jsonb, jsonb, jsonb, text), public.get_order_tracking(text) to anon, authenticated;
grant execute on function public.update_fulfillment_status(uuid, text, text), public.assign_order_courier(uuid, text),
  public.record_fulfillment_payment(uuid, text), public.update_order_status(uuid, text, text) to authenticated;

commit;
