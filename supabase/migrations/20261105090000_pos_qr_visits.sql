-- ================================================================
-- WAYPOINT RESTAURANT OS — Süreli masa bileti (QR ziyareti)
--
-- Sorun: masadaki QR her zaman aynı adresi açar; sayfa açık kalan veya adresi saklayan kişi masadan
-- ayrıldıktan sonra da sipariş verebiliyordu. Sunucu "yeni okutma" ile "sayfa yenileme"yi ayırt edemez.
--
-- Çözüm: masa kodu artık yalnızca bilet almak için kullanılır (start_qr_visit). Bilet:
--   * 1 saat geçerlidir; sayfa yenilemek süreyi uzatmaz (istemci kodu adresten siler, yalnızca bileti tutar);
--   * adisyonu kapanınca geçersiz olur (ödeyip çıkan müşteri o masaya sipariş veremez);
--   * masa kodu yenilenir veya masa devre dışı bırakılırsa geçersiz olur.
-- place_qr_order / get_qr_orders aynı imzayla kalır, ancak p_table_token artık BİLET'tir (qv_ + 64 hex);
-- çıplak masa kodu reddedilir (qr_visit_required). Garson, paket ve kurye akışları değişmez.
-- Bilette yalnızca SHA-256 özeti saklanır.
-- ================================================================

begin;

create table if not exists pos_private.qr_visits (
  id               uuid primary key default gen_random_uuid(),
  token_hash       text not null unique,
  table_id         uuid not null references public.restaurant_tables(id) on delete cascade,
  table_token_hash text not null,
  session_id       uuid references public.table_sessions(id) on delete set null,
  issued_at        timestamptz not null default now(),
  expires_at       timestamptz not null
);
create index if not exists qr_visits_table_idx on pos_private.qr_visits(table_id, issued_at);
create index if not exists qr_visits_expires_idx on pos_private.qr_visits(expires_at);
revoke all on pos_private.qr_visits from public, anon, authenticated;

create or replace function pos_private.sha256_hex(p_text text) returns text
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select encode(sha256(convert_to(p_text, 'UTF8')), 'hex')
$$;

-- Bileti doğrular. p_active=false: süresi dolmuş bilet de kabul edilir (müşteri verdiği siparişin durumunu görmeye devam eder).
create or replace function pos_private.qr_visit(p_visit text, p_active boolean default true) returns pos_private.qr_visits
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v pos_private.qr_visits;
begin
  if p_visit ~ '^[0-9a-f]{64}$' then perform pos_private.fail('qr_visit_required'); end if;
  if p_visit is null or p_visit !~ '^qv_[0-9a-f]{64}$' then perform pos_private.fail('qr_visit_invalid'); end if;
  select * into v from pos_private.qr_visits where token_hash = pos_private.sha256_hex(p_visit);
  if not found then perform pos_private.fail('qr_visit_invalid'); end if;
  if not p_active then return v; end if;
  if v.expires_at <= now() then perform pos_private.fail('qr_visit_expired'); end if;
  -- Masa kodu yenilendiyse ya da masa devre dışıysa eski bilet de geçersizdir.
  if not exists (select 1 from public.table_qr_tokens q join public.restaurant_tables t on t.id = q.table_id
                  where q.table_id = v.table_id and t.is_active and pos_private.sha256_hex(q.token) = v.table_token_hash) then
    perform pos_private.fail('qr_visit_expired');
  end if;
  -- Adisyon kapandıysa bilet biter. Henüz sipariş vermemiş bilet, alındıktan sonra masada kapanan herhangi bir adisyonla biter.
  if v.session_id is not null then
    if exists (select 1 from public.table_sessions where id = v.session_id and status = 'closed') then perform pos_private.fail('qr_visit_expired'); end if;
  elsif exists (select 1 from public.table_sessions where table_id = v.table_id and status = 'closed' and closed_at > v.issued_at) then
    perform pos_private.fail('qr_visit_expired');
  end if;
  return v;
end;
$$;

create or replace function pos_private.qr_visit_json(v pos_private.qr_visits) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_block text := pos_private.ordering_block();
begin
  if not (select dine_in_enabled from public.fulfillment_settings where id = 1) then perform pos_private.fail('channel_closed'); end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'table_label', (select label from public.restaurant_tables where id = v.table_id),
    'table_key', v.table_id, 'expires_at', v.expires_at, 'blocked', v_block));
end;
$$;

-- QR okutulunca çağrılır: masa kodu → yeni 1 saatlik bilet. Bilet yalnızca bu yanıtta görünür.
create or replace function public.start_qr_visit(p_table_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_table_id uuid := pos_private.table_by_token(p_table_token);
  v_visit    text := 'qv_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v          pos_private.qr_visits;
begin
  if (select count(*) from pos_private.qr_visits where table_id = v_table_id and issued_at > now() - interval '10 minutes') >= 60 then
    perform pos_private.fail('rate_limited');
  end if;
  delete from pos_private.qr_visits where expires_at < now() - interval '1 day';
  insert into pos_private.qr_visits(token_hash, table_id, table_token_hash, expires_at)
    values (pos_private.sha256_hex(v_visit), v_table_id, pos_private.sha256_hex(p_table_token), now() + interval '1 hour')
    returning * into v;
  return pos_private.qr_visit_json(v) || jsonb_build_object('visit', v_visit);
end;
$$;

-- Sayfa açılışı / yenileme: bileti doğrular, süreyi UZATMAZ.
create or replace function public.get_qr_visit(p_visit text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  return pos_private.qr_visit_json(pos_private.qr_visit(p_visit));
end;
$$;

create or replace function public.place_qr_order(
  p_table_token text, p_idempotency_key uuid, p_items jsonb,
  p_note text default null, p_client_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v       pos_private.qr_visits;
  v_block text;
  v_order jsonb;
begin
  -- Aynı anahtarla tekrar (bağlantı koptu, yanıt kayboldu): bilet bitmiş olsa da mevcut sipariş döner.
  if exists (select 1 from public.orders where idempotency_key = p_idempotency_key) then
    v := pos_private.qr_visit(p_table_token, false);
    return pos_private.create_order(v.table_id, 'qr', auth.uid(), p_idempotency_key, p_items, p_note, p_client_ref);
  end if;
  v := pos_private.qr_visit(p_table_token);
  v_block := pos_private.ordering_block();
  if v_block is not null then perform pos_private.fail(v_block); end if;
  if not (select dine_in_enabled from public.fulfillment_settings where id = 1) then perform pos_private.fail('channel_closed'); end if;
  v_order := pos_private.create_order(v.table_id, 'qr', auth.uid(), p_idempotency_key, p_items, p_note, p_client_ref);
  -- İlk sipariş bileti o adisyona bağlar; adisyon kapanınca bilet de biter.
  update pos_private.qr_visits set session_id = o.session_id
    from public.orders o where o.idempotency_key = p_idempotency_key and qr_visits.id = v.id and qr_visits.session_id is null;
  return v_order;
end;
$$;

-- Müşteri yalnızca kendi cihazındaki anahtarlarla, biletin masasındaki siparişleri görür (süresi dolmuş bilet de olur).
create or replace function public.get_qr_orders(p_table_token text, p_idempotency_keys uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_table_id uuid := (pos_private.qr_visit(p_table_token, false)).table_id;
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

revoke all on all functions in schema pos_private from public, anon, authenticated;
revoke execute on function public.start_qr_visit(text), public.get_qr_visit(text) from public;
grant execute on function public.start_qr_visit(text), public.get_qr_visit(text) to anon, authenticated;

commit;
