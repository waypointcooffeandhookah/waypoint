-- YALNIZCA STAGING: testlerden kalan açık siparişleri iptal eder ve masaları kapatır.
-- Veri silmez: siparişler 'cancelled', oturumlar 'closed' olur; geçmiş ve denetim kaydı kalır.
-- Mevcut RPC'leri yönetici JWT'si taklidiyle çağırır (kimlik yok: changed_by/closed_by boş kalır).
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"admin"}}', true);
select count(public.update_order_status(o.id, 'cancelled', 'staging test temizliği')) as cancelled
  from public.orders o join public.bills b on b.id = o.bill_id
  where b.status = 'open' and o.status <> 'cancelled';
select count(public.close_table_session(s.id, true)) as closed
  from public.table_sessions s where s.status = 'open';
commit;
