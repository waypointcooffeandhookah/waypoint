-- ================================================================
-- WAYPOINT RESTAURANT OS — Milestone 1: POS temel şeması
--
-- Yıkıcı değildir: mevcut categories / menu_items / menu_promotion /
-- social_settings tablolarına dokunmaz, yalnızca yeni nesneler ekler.
-- Uzak veritabanına uygulamadan önce onay alınmalıdır.
--
-- Tasarım ilkeleri
--  * Para birimi: tamsayı kuruş (bigint *_cents). Float kullanılmaz.
--  * Fiyat, ürün adı ve masa her zaman sunucuda belirlenir; tarayıcıdan
--    yalnızca ürün kimliği, adet ve not kabul edilir.
--  * Tüm yazma işlemleri SECURITY DEFINER RPC'ler üzerinden yapılır;
--    tablolara doğrudan yazma izni yoktur (masa tanımları hariç).
--  * Her sipariş benzersiz bir idempotency_key taşır; tekrar gönderim
--    yeni sipariş oluşturmaz, mevcut siparişi döndürür.
--  * Masa satırı FOR UPDATE ile kilitlenir; aynı masaya eşzamanlı gelen
--    siparişler sıraya girer, tek açık oturum / tek adisyon garanti edilir.
--  * Adisyon toplamı saklanmaz, iptal edilmemiş siparişlerden hesaplanır;
--    böylece eşzamanlı siparişler birbirinin toplamını ezemez.
-- ================================================================

begin;

create schema if not exists pos_private;
revoke all on schema pos_private from public;

-- ── Personel ────────────────────────────────────────────────────
create table if not exists public.staff_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  role         text not null check (role in ('admin', 'manager', 'cashier', 'waiter', 'kitchen')),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Mevcut yönetici hesabı (app_metadata.role = admin) staff_profiles kaydı
-- olmadan da yönetici sayılır; diğer roller yalnızca aktif profilden gelir.
create or replace function public.pos_current_role() returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' then 'admin'
    else (select sp.role from public.staff_profiles sp
          where sp.user_id = (select auth.uid()) and sp.is_active)
  end
$$;

create or replace function public.pos_has_role(p_roles text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.pos_current_role() = any(p_roles), false) $$;

-- ── Masalar ve QR anahtarları ──────────────────────────────────
create table if not exists public.restaurant_tables (
  id         uuid primary key default gen_random_uuid(),
  label      text not null unique check (char_length(trim(label)) between 1 and 40),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- QR anahtarı ayrı tabloda tutulur: garson/mutfak masaları görebilir,
-- anahtarları yalnızca yönetici görür ve yeniler.
create table if not exists public.table_qr_tokens (
  table_id   uuid primary key references public.restaurant_tables(id) on delete cascade,
  token      text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  rotated_at timestamptz not null default now()
);

create or replace function pos_private.create_table_token() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.table_qr_tokens(table_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists restaurant_tables_create_token on public.restaurant_tables;
create trigger restaurant_tables_create_token after insert on public.restaurant_tables
  for each row execute function pos_private.create_table_token();

-- ── Oturum, adisyon, sipariş ───────────────────────────────────
create table if not exists public.table_sessions (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references public.restaurant_tables(id),
  status     text not null default 'open' check (status in ('open', 'closed')),
  opened_via text not null check (opened_via in ('qr', 'staff')),
  opened_by  uuid references auth.users(id) on delete set null,
  opened_at  timestamptz not null default now(),
  closed_by  uuid references auth.users(id) on delete set null,
  closed_at  timestamptz,
  check ((status = 'open') = (closed_at is null))
);
create unique index if not exists table_sessions_one_open_per_table
  on public.table_sessions(table_id) where status = 'open';

create table if not exists public.bills (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null unique references public.table_sessions(id),
  status         text not null default 'open' check (status in ('open', 'closed')),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  created_at     timestamptz not null default now(),
  closed_at      timestamptz
);

create sequence if not exists public.pos_order_number_seq;

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    bigint not null unique default nextval('public.pos_order_number_seq'),
  idempotency_key uuid not null unique,
  table_id        uuid not null references public.restaurant_tables(id),
  session_id      uuid not null references public.table_sessions(id),
  bill_id         uuid not null references public.bills(id),
  source          text not null check (source in ('qr', 'waiter')),
  status          text not null default 'new'
                  check (status in ('new', 'preparing', 'ready', 'served', 'cancelled')),
  subtotal_cents  bigint not null default 0 check (subtotal_cents >= 0),
  note            text check (char_length(note) <= 300),
  client_ref      text check (char_length(client_ref) <= 64),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  cancelled_at    timestamptz,
  cancel_reason   text check (char_length(cancel_reason) <= 300)
);
create index if not exists orders_active_idx on public.orders(status, created_at);
create index if not exists orders_bill_idx on public.orders(bill_id);
create index if not exists orders_session_idx on public.orders(session_id);
create index if not exists orders_table_created_idx on public.orders(table_id, created_at);

create table if not exists public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  position         smallint not null,
  menu_item_id     uuid references public.menu_items(id) on delete set null,
  item_name        text not null,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  quantity         integer not null check (quantity between 1 and 20),
  line_total_cents bigint generated always as (unit_price_cents * quantity) stored,
  note             text check (char_length(note) <= 200),
  unique (order_id, position)
);

create table if not exists public.order_status_history (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references auth.users(id) on delete set null,
  reason      text,
  changed_at  timestamptz not null default now()
);
create index if not exists order_status_history_order_idx on public.order_status_history(order_id);

-- Ödeme kaydı yalnızca tutar ve yöntemdir; kart bilgisi asla saklanmaz.
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  bill_id         uuid not null references public.bills(id),
  amount_cents    bigint not null check (amount_cents > 0),
  method          text not null check (method in ('cash', 'card')),
  note            text check (char_length(note) <= 200),
  recorded_by     uuid not null references auth.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists payments_bill_idx on public.payments(bill_id);

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor      uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace view public.bill_summaries with (security_invoker = true) as
select b.id as bill_id, b.session_id, s.table_id, b.status, b.discount_cents,
       coalesce(o.subtotal, 0) as subtotal_cents,
       greatest(coalesce(o.subtotal, 0) - b.discount_cents, 0) as total_cents,
       coalesce(p.paid, 0) as paid_cents,
       greatest(coalesce(o.subtotal, 0) - b.discount_cents, 0) - coalesce(p.paid, 0) as balance_cents,
       coalesce(o.order_count, 0) as order_count
from public.bills b
join public.table_sessions s on s.id = b.session_id
left join lateral (select sum(subtotal_cents)::bigint as subtotal, count(*)::int as order_count
                   from public.orders where bill_id = b.id and status <> 'cancelled') o on true
left join lateral (select sum(amount_cents)::bigint as paid
                   from public.payments where bill_id = b.id) p on true;

-- ── Yardımcılar (dışarı açık değil) ────────────────────────────
create or replace function pos_private.fail(p_code text, p_detail text default null) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = 'pos:' || p_code, detail = coalesce(p_detail, '');
end;
$$;

create or replace function pos_private.require_role(p_roles text[]) returns uuid
language plpgsql stable set search_path = public, pg_temp
as $$
begin
  if not public.pos_has_role(p_roles) then perform pos_private.fail('forbidden'); end if;
  return auth.uid();
end;
$$;

create or replace function pos_private.bill_balance(p_bill_id uuid) returns bigint
language sql stable set search_path = public, pg_temp
as $$ select balance_cents from public.bill_summaries where bill_id = p_bill_id $$;

create or replace function pos_private.order_json(p_order public.orders, p_duplicate boolean) returns jsonb
language sql stable set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'order_id', p_order.id, 'order_number', p_order.order_number,
    'idempotency_key', p_order.idempotency_key, 'status', p_order.status,
    'source', p_order.source, 'table_label', (select label from public.restaurant_tables where id = p_order.table_id),
    'subtotal_cents', p_order.subtotal_cents, 'created_at', p_order.created_at,
    'duplicate', p_duplicate)
$$;

-- Müşteri ve garson siparişlerinin ortak tek oluşturma yolu.
create or replace function pos_private.create_order(
  p_table_id uuid, p_source text, p_actor uuid, p_idempotency_key uuid,
  p_items jsonb, p_note text, p_client_ref text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order      public.orders;
  v_session_id uuid;
  v_bill_id    uuid;
  v_line       jsonb;
  v_item       public.menu_items;
  v_item_id    uuid;
  v_qty        integer;
  v_line_note  text;
  v_unit       bigint;
  v_subtotal   bigint := 0;
  v_position   smallint := 0;
begin
  if p_idempotency_key is null then perform pos_private.fail('idempotency_key_required'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform pos_private.fail('empty_order');
  end if;
  if jsonb_array_length(p_items) > 30 then perform pos_private.fail('too_many_lines'); end if;
  if char_length(p_note) > 300 then perform pos_private.fail('note_too_long'); end if;

  -- Aynı gönderim tekrar gelirse mevcut siparişi döndür.
  select * into v_order from public.orders where idempotency_key = p_idempotency_key;
  if found then
    if v_order.table_id <> p_table_id then perform pos_private.fail('idempotency_key_conflict'); end if;
    return pos_private.order_json(v_order, true);
  end if;

  -- Masa başına seri hale getir: oturum açma, hız sınırı ve tekrar kontrolü
  -- aynı masadaki eşzamanlı gönderimler arasında yarış oluşturmaz.
  perform 1 from public.restaurant_tables where id = p_table_id and is_active for update;
  if not found then perform pos_private.fail('table_not_found'); end if;

  select * into v_order from public.orders where idempotency_key = p_idempotency_key;
  if found then
    if v_order.table_id <> p_table_id then perform pos_private.fail('idempotency_key_conflict'); end if;
    return pos_private.order_json(v_order, true);
  end if;

  if p_source = 'qr' and (select count(*) from public.orders
      where table_id = p_table_id and source = 'qr' and created_at > now() - interval '5 minutes') >= 12 then
    perform pos_private.fail('rate_limited');
  end if;

  select id into v_session_id from public.table_sessions where table_id = p_table_id and status = 'open';
  if v_session_id is null then
    insert into public.table_sessions(table_id, opened_via, opened_by)
      values (p_table_id, case when p_source = 'qr' then 'qr' else 'staff' end, p_actor)
      returning id into v_session_id;
    insert into public.bills(session_id) values (v_session_id) returning id into v_bill_id;
  else
    select id into v_bill_id from public.bills where session_id = v_session_id and status = 'open';
    if v_bill_id is null then perform pos_private.fail('bill_closed'); end if;
  end if;

  insert into public.orders(idempotency_key, table_id, session_id, bill_id, source, note, client_ref, created_by)
    values (p_idempotency_key, p_table_id, v_session_id, v_bill_id, p_source,
            nullif(trim(p_note), ''), nullif(trim(p_client_ref), ''), p_actor)
    returning * into v_order;

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
    if not found or v_item.is_available is false then
      perform pos_private.fail('item_unavailable', coalesce(v_item_id::text, ''));
    end if;
    if v_item.price is null or v_item.price < 0 then perform pos_private.fail('invalid_price', v_item_id::text); end if;

    v_unit := round(v_item.price * 100)::bigint;
    insert into public.order_items(order_id, position, menu_item_id, item_name, unit_price_cents, quantity, note)
      values (v_order.id, v_position, v_item.id, v_item.name, v_unit, v_qty, v_line_note);
    v_subtotal := v_subtotal + v_unit * v_qty;
  end loop;

  update public.orders set subtotal_cents = v_subtotal where id = v_order.id returning * into v_order;
  insert into public.order_status_history(order_id, from_status, to_status, changed_by)
    values (v_order.id, null, 'new', p_actor);
  return pos_private.order_json(v_order, false);
end;
$$;

-- ── Müşteri (QR) RPC'leri: anon erişebilir ─────────────────────
create or replace function pos_private.table_by_token(p_table_token text) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_table_id uuid;
begin
  if p_table_token is null or p_table_token !~ '^[0-9a-f]{64}$' then perform pos_private.fail('invalid_table'); end if;
  select t.id into v_table_id from public.table_qr_tokens q
    join public.restaurant_tables t on t.id = q.table_id
    where q.token = p_table_token and t.is_active;
  if v_table_id is null then perform pos_private.fail('invalid_table'); end if;
  return v_table_id;
end;
$$;

create or replace function public.get_qr_table(p_table_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_table public.restaurant_tables;
begin
  select * into v_table from public.restaurant_tables where id = pos_private.table_by_token(p_table_token);
  return jsonb_build_object('table_label', v_table.label);
end;
$$;

create or replace function public.place_qr_order(
  p_table_token text, p_idempotency_key uuid, p_items jsonb,
  p_note text default null, p_client_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return pos_private.create_order(pos_private.table_by_token(p_table_token), 'qr', auth.uid(),
                                  p_idempotency_key, p_items, p_note, p_client_ref);
end;
$$;

-- Müşteri yalnızca kendi cihazında tuttuğu anahtarlarla sipariş durumunu görür.
create or replace function public.get_qr_orders(p_table_token text, p_idempotency_keys uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_table_id uuid := pos_private.table_by_token(p_table_token);
begin
  if cardinality(p_idempotency_keys) > 50 then perform pos_private.fail('too_many_keys'); end if;
  return coalesce((
    select jsonb_agg(pos_private.order_json(o, false) || jsonb_build_object('items', (
             select jsonb_agg(jsonb_build_object('name', i.item_name, 'quantity', i.quantity,
                    'line_total_cents', i.line_total_cents, 'note', i.note) order by i.position)
             from public.order_items i where i.order_id = o.id)) order by o.created_at)
    from public.orders o
    where o.table_id = v_table_id and o.idempotency_key = any(p_idempotency_keys)
  ), '[]'::jsonb);
end;
$$;

-- ── Personel RPC'leri ──────────────────────────────────────────
create or replace function public.place_staff_order(
  p_table_id uuid, p_idempotency_key uuid, p_items jsonb, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_actor uuid := pos_private.require_role(array['waiter', 'manager', 'admin']);
begin
  return pos_private.create_order(p_table_id, 'waiter', v_actor, p_idempotency_key, p_items, p_note, null);
end;
$$;

-- Personel siparişlerinde bağlantı koptuktan sonra mutabakat için.
create or replace function public.get_order_by_idempotency_key(p_idempotency_key uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_order public.orders;
begin
  perform pos_private.require_role(array['waiter', 'cashier', 'kitchen', 'manager', 'admin']);
  select * into v_order from public.orders where idempotency_key = p_idempotency_key;
  if not found then return null; end if;
  return pos_private.order_json(v_order, false);
end;
$$;

create or replace function public.open_table_session(p_table_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['waiter', 'cashier', 'manager', 'admin']);
  v_session_id uuid;
  v_bill_id uuid;
begin
  perform 1 from public.restaurant_tables where id = p_table_id and is_active for update;
  if not found then perform pos_private.fail('table_not_found'); end if;
  select id into v_session_id from public.table_sessions where table_id = p_table_id and status = 'open';
  if v_session_id is null then
    insert into public.table_sessions(table_id, opened_via, opened_by)
      values (p_table_id, 'staff', v_actor) returning id into v_session_id;
    insert into public.bills(session_id) values (v_session_id) returning id into v_bill_id;
  else
    select id into v_bill_id from public.bills where session_id = v_session_id;
  end if;
  return jsonb_build_object('session_id', v_session_id, 'bill_id', v_bill_id);
end;
$$;

create or replace function public.update_order_status(
  p_order_id uuid, p_status text, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_role  text := public.pos_current_role();
  v_actor uuid := auth.uid();
  v_order public.orders;
  v_allowed text[];
begin
  if v_role is null then perform pos_private.fail('forbidden'); end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then perform pos_private.fail('order_not_found'); end if;
  if v_order.status = p_status then return pos_private.order_json(v_order, true); end if;
  -- FOR SHARE: eşzamanlı masa kapatma ile yarışmaz; kapanış bitene kadar bekler.
  if not exists (select 1 from public.bills where id = v_order.bill_id and status = 'open' for share) then
    perform pos_private.fail('bill_closed');
  end if;

  -- Geçiş → bu geçişi yapabilen roller
  v_allowed := case v_order.status || '>' || p_status
    when 'new>preparing'      then array['kitchen', 'manager', 'admin']
    when 'preparing>ready'    then array['kitchen', 'manager', 'admin']
    when 'ready>served'       then array['waiter', 'kitchen', 'manager', 'admin']
    when 'new>cancelled'      then array['waiter', 'manager', 'admin']
    when 'preparing>cancelled' then array['manager', 'admin']
    when 'ready>cancelled'    then array['manager', 'admin']
    when 'served>cancelled'   then array['manager', 'admin']
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
  if p_status = 'cancelled' then
    insert into public.audit_log(actor, action, entity, entity_id, details)
      values (v_actor, 'order.cancel', 'orders', p_order_id::text,
              jsonb_build_object('reason', p_reason, 'subtotal_cents', v_order.subtotal_cents));
  end if;
  return pos_private.order_json(v_order, false);
end;
$$;

create or replace function public.record_payment(
  p_bill_id uuid, p_amount_cents bigint, p_method text, p_idempotency_key uuid, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['waiter', 'cashier', 'manager', 'admin']);
  v_payment public.payments;
begin
  if p_idempotency_key is null then perform pos_private.fail('idempotency_key_required'); end if;
  select * into v_payment from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if v_payment.bill_id <> p_bill_id then perform pos_private.fail('idempotency_key_conflict'); end if;
    return jsonb_build_object('payment_id', v_payment.id, 'duplicate', true,
                              'balance_cents', pos_private.bill_balance(p_bill_id));
  end if;
  perform 1 from public.bills where id = p_bill_id and status = 'open' for update;
  if not found then perform pos_private.fail('bill_closed'); end if;
  -- Aynı anahtarla eşzamanlı gelen ikinci istek kilidi bekledikten sonra kaydı bulur.
  select * into v_payment from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if v_payment.bill_id <> p_bill_id then perform pos_private.fail('idempotency_key_conflict'); end if;
    return jsonb_build_object('payment_id', v_payment.id, 'duplicate', true,
                              'balance_cents', pos_private.bill_balance(p_bill_id));
  end if;
  if p_method not in ('cash', 'card') then perform pos_private.fail('invalid_method'); end if;
  if p_amount_cents is null or p_amount_cents <= 0 then perform pos_private.fail('invalid_amount'); end if;
  if p_amount_cents > pos_private.bill_balance(p_bill_id) then perform pos_private.fail('overpayment'); end if;

  insert into public.payments(idempotency_key, bill_id, amount_cents, method, note, recorded_by)
    values (p_idempotency_key, p_bill_id, p_amount_cents, p_method, nullif(trim(p_note), ''), v_actor)
    returning * into v_payment;
  insert into public.audit_log(actor, action, entity, entity_id, details)
    values (v_actor, 'payment.record', 'bills', p_bill_id::text,
            jsonb_build_object('amount_cents', p_amount_cents, 'method', p_method));
  return jsonb_build_object('payment_id', v_payment.id, 'duplicate', false,
                            'balance_cents', pos_private.bill_balance(p_bill_id));
end;
$$;

create or replace function public.close_table_session(p_session_id uuid, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['waiter', 'cashier', 'manager', 'admin']);
  v_session public.table_sessions;
  v_bill_id uuid;
  v_balance bigint;
  v_open_orders integer;
begin
  if p_force and not public.pos_has_role(array['manager', 'admin']) then perform pos_private.fail('forbidden'); end if;
  select * into v_session from public.table_sessions where id = p_session_id;
  if not found then perform pos_private.fail('session_not_found'); end if;
  -- Sipariş oluşturma ile aynı kilit sırası: önce masa, sonra oturum.
  perform 1 from public.restaurant_tables where id = v_session.table_id for update;
  select * into v_session from public.table_sessions where id = p_session_id for update;
  if v_session.status <> 'open' then perform pos_private.fail('session_closed'); end if;

  -- Bakiye hesaplanmadan önce adisyon kilitlenir: eşzamanlı ödeme veya iptal
  -- kapanıştan sonra bakiyeyi değiştiremez.
  select id into v_bill_id from public.bills where session_id = p_session_id for update;
  v_balance := pos_private.bill_balance(v_bill_id);
  select count(*) into v_open_orders from public.orders
    where session_id = p_session_id and status in ('new', 'preparing', 'ready');
  if not p_force and v_open_orders > 0 then perform pos_private.fail('orders_in_progress'); end if;
  if not p_force and v_balance <> 0 then perform pos_private.fail('balance_due', v_balance::text); end if;

  update public.table_sessions set status = 'closed', closed_at = now(), closed_by = v_actor where id = p_session_id;
  update public.bills set status = 'closed', closed_at = now() where id = v_bill_id;
  if p_force then
    insert into public.audit_log(actor, action, entity, entity_id, details)
      values (v_actor, 'session.force_close', 'table_sessions', p_session_id::text,
              jsonb_build_object('balance_cents', v_balance, 'open_orders', v_open_orders));
  end if;
  return jsonb_build_object('session_id', p_session_id, 'bill_id', v_bill_id, 'balance_cents', v_balance);
end;
$$;

create or replace function public.rotate_table_qr_token(p_table_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['manager', 'admin']);
  v_token text;
begin
  update public.table_qr_tokens
     set token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
         rotated_at = now()
   where table_id = p_table_id returning token into v_token;
  if v_token is null then perform pos_private.fail('table_not_found'); end if;
  insert into public.audit_log(actor, action, entity, entity_id) values (v_actor, 'table.rotate_qr', 'restaurant_tables', p_table_id::text);
  return v_token;
end;
$$;

create or replace function public.upsert_staff_profile(
  p_user_id uuid, p_display_name text, p_role text, p_is_active boolean default true
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_actor uuid := pos_private.require_role(array['admin']);
begin
  insert into public.staff_profiles(user_id, display_name, role, is_active)
    values (p_user_id, trim(p_display_name), p_role, p_is_active)
  on conflict (user_id) do update set display_name = excluded.display_name, role = excluded.role,
    is_active = excluded.is_active, updated_at = now();
  insert into public.audit_log(actor, action, entity, entity_id, details)
    values (v_actor, 'staff.upsert', 'staff_profiles', p_user_id::text,
            jsonb_build_object('role', p_role, 'is_active', p_is_active));
end;
$$;

-- ── Yetkiler ve RLS ────────────────────────────────────────────
-- Supabase yeni tablolara varsayılan olarak anon/authenticated için tüm
-- yetkileri verir; burada önce hepsi geri alınır.
revoke all on public.staff_profiles, public.restaurant_tables, public.table_qr_tokens,
  public.table_sessions, public.bills, public.orders, public.order_items,
  public.order_status_history, public.payments, public.audit_log, public.bill_summaries
  from anon, authenticated;
revoke all on sequence public.pos_order_number_seq from anon, authenticated;

grant select on public.staff_profiles, public.restaurant_tables, public.table_qr_tokens,
  public.table_sessions, public.bills, public.orders, public.order_items,
  public.order_status_history, public.payments, public.audit_log, public.bill_summaries
  to authenticated;
grant insert, update on public.restaurant_tables to authenticated;

alter table public.staff_profiles enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.table_qr_tokens enable row level security;
alter table public.table_sessions enable row level security;
alter table public.bills enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.payments enable row level security;
alter table public.audit_log enable row level security;

do $$
declare
  p record;
begin
  for p in select tablename, policyname from pg_policies where schemaname = 'public' and tablename in
    ('staff_profiles', 'restaurant_tables', 'table_qr_tokens', 'table_sessions', 'bills', 'orders',
     'order_items', 'order_status_history', 'payments', 'audit_log')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy "Staff read own profile or managers read all" on public.staff_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.pos_has_role(array['manager', 'admin'])));

create policy "Staff read tables" on public.restaurant_tables for select to authenticated
  using ((select public.pos_current_role()) is not null);
create policy "Managers insert tables" on public.restaurant_tables for insert to authenticated
  with check ((select public.pos_has_role(array['manager', 'admin'])));
create policy "Managers update tables" on public.restaurant_tables for update to authenticated
  using ((select public.pos_has_role(array['manager', 'admin'])))
  with check ((select public.pos_has_role(array['manager', 'admin'])));

create policy "Managers read QR tokens" on public.table_qr_tokens for select to authenticated
  using ((select public.pos_has_role(array['manager', 'admin'])));

create policy "Staff read sessions" on public.table_sessions for select to authenticated
  using ((select public.pos_current_role()) is not null);
create policy "Staff read orders" on public.orders for select to authenticated
  using ((select public.pos_current_role()) is not null);
create policy "Staff read order items" on public.order_items for select to authenticated
  using ((select public.pos_current_role()) is not null);
create policy "Staff read order history" on public.order_status_history for select to authenticated
  using ((select public.pos_current_role()) is not null);

create policy "Billing staff read bills" on public.bills for select to authenticated
  using ((select public.pos_has_role(array['waiter', 'cashier', 'manager', 'admin'])));
create policy "Billing staff read payments" on public.payments for select to authenticated
  using ((select public.pos_has_role(array['waiter', 'cashier', 'manager', 'admin'])));
create policy "Managers read audit log" on public.audit_log for select to authenticated
  using ((select public.pos_has_role(array['manager', 'admin'])));

-- Fonksiyonlar varsayılan olarak PUBLIC'e, Supabase'de ayrıca anon/authenticated'a
-- açıktır; hepsi geri alınır, yalnızca gerekenler açılır.
revoke all on all functions in schema pos_private from public, anon, authenticated;
revoke execute on function public.pos_current_role(), public.pos_has_role(text[]) from public, anon, authenticated;
grant execute on function public.pos_current_role(), public.pos_has_role(text[]) to authenticated;

revoke execute on function public.get_qr_table(text), public.place_qr_order(text, uuid, jsonb, text, text),
  public.get_qr_orders(text, uuid[]), public.place_staff_order(uuid, uuid, jsonb, text),
  public.get_order_by_idempotency_key(uuid), public.open_table_session(uuid),
  public.update_order_status(uuid, text, text), public.record_payment(uuid, bigint, text, uuid, text),
  public.close_table_session(uuid, boolean), public.rotate_table_qr_token(uuid),
  public.upsert_staff_profile(uuid, text, text, boolean) from public, anon, authenticated;

grant execute on function public.get_qr_table(text), public.place_qr_order(text, uuid, jsonb, text, text),
  public.get_qr_orders(text, uuid[]) to anon, authenticated;
grant execute on function public.place_staff_order(uuid, uuid, jsonb, text),
  public.get_order_by_idempotency_key(uuid), public.open_table_session(uuid),
  public.update_order_status(uuid, text, text), public.record_payment(uuid, bigint, text, uuid, text),
  public.close_table_session(uuid, boolean), public.rotate_table_qr_token(uuid),
  public.upsert_staff_profile(uuid, text, text, boolean) to authenticated;

-- ── Realtime (yalnızca bildirim; asıl kaynak veritabanıdır) ─────
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders', 'order_items', 'table_sessions', 'bills', 'payments'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

commit;
