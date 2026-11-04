-- ================================================================
-- YALNIZCA STAGING — Süreli masa bileti kurulumunu geri alma (20261105090000_pos_qr_visits.sql)
--
-- place_qr_order ve get_qr_orders önceki hâline (masa kodu kabul eden) döner; bilet tablosu ve RPC'leri kaldırılır.
-- Sipariş, adisyon ve ödeme verisine dokunmaz. Ön yüz de önceki sürüme alınmalıdır (aksi hâlde QR
-- menüsü bilet alamaz ve "QR ile sipariş şu anda kapalı" gösterir). Supabase SQL Editor'da çalıştırın.
-- ================================================================
begin;

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

drop function if exists public.get_qr_visit(text);
drop function if exists public.start_qr_visit(text);
drop function if exists pos_private.qr_visit_json(pos_private.qr_visits);
drop function if exists pos_private.qr_visit(text, boolean);
drop table if exists pos_private.qr_visits;
drop function if exists pos_private.sha256_hex(text);

commit;
