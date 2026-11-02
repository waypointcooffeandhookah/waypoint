-- ================================================================
-- WAYPOINT RESTAURANT OS — Sipariş alımı ile kanal ayarları ayrı bildirilir
--
-- Eklemelidir: tablo/kolon/satır silmez, DROP içermez; yalnızca iki okuma RPC'si yenilenir.
-- Sorun: accepting_orders kapalıyken get_ordering_config tüm kanalları false döndürüyor,
-- get_qr_table masayı reddediyordu; müşteri sipariş türlerini ve sepeti hiç göremiyordu.
-- Yeni davranış:
--   * get_ordering_config: eski anahtarlar (pickup/delivery/dine_in = şu an sipariş verilebilir mi)
--     aynen kalır; ek olarak "channels" (yöneticinin açtığı kanallar, alım durumundan bağımsız)
--     ve "accepting" (alım açık mı) döner. Kapalı kanal asla açık gösterilmez.
--   * get_qr_table: masa kanalı yöneticice kapalıysa eskisi gibi channel_closed. Yalnızca alım
--     kapalı / saat dışıysa masa doğrulanır ve "blocked" ile döner; arayüz uyarı gösterir.
-- Gönderim DEĞİŞMEZ: place_qr_order ve place_online_order ordering_block() denetimini sürdürür.
-- ================================================================

begin;

create or replace function public.get_ordering_config() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_settings public.fulfillment_settings;
  v_block    text := pos_private.ordering_block();
  v_pickup   boolean;
  v_delivery boolean;
begin
  select * into v_settings from public.fulfillment_settings where id = 1;
  v_pickup := v_settings.pickup_enabled and v_settings.allow_pay_at_pickup;
  v_delivery := v_settings.delivery_enabled and v_settings.allow_cash_on_delivery and exists (select 1 from public.delivery_zones z where z.is_active);
  return jsonb_build_object(
    'pickup', v_block is null and v_pickup,
    'delivery', v_block is null and v_delivery,
    'dine_in', v_block is null and v_settings.dine_in_enabled,
    'channels', jsonb_build_object('pickup', v_pickup, 'delivery', v_delivery, 'dine_in', v_settings.dine_in_enabled),
    'accepting', v_block is null,
    'auto_open', v_settings.auto_open_order_type,
    'blocked', v_block);
end;
$$;

create or replace function public.get_qr_table(p_table_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_table public.restaurant_tables;
  v_block text;
begin
  select * into v_table from public.restaurant_tables where id = pos_private.table_by_token(p_table_token);
  if not (select dine_in_enabled from public.fulfillment_settings where id = 1) then perform pos_private.fail('channel_closed'); end if;
  v_block := pos_private.ordering_block();
  if v_block is null then return jsonb_build_object('table_label', v_table.label); end if;
  return jsonb_build_object('table_label', v_table.label, 'blocked', v_block);
end;
$$;

revoke execute on function public.get_ordering_config(), public.get_qr_table(text) from public;
grant execute on function public.get_ordering_config(), public.get_qr_table(text) to anon, authenticated;

commit;
