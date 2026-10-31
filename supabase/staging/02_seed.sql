-- YALNIZCA STAGING: Masa 1-10 ve üretimden bağımsız örnek menü.
-- Tekrar çalıştırılabilir: var olan satırlara dokunmaz. QR kodlarını masa tetikleyicisi üretir.
insert into public.restaurant_tables(label, sort_order)
select 'Masa ' || n, n from generate_series(1, 10) as n
on conflict (label) do nothing;

insert into public.categories(id, name, sort_order) values
  ('5e000000-0000-4000-8000-000000000001', 'Kahveler', 1),
  ('5e000000-0000-4000-8000-000000000002', 'Soğuk İçecekler', 2),
  ('5e000000-0000-4000-8000-000000000003', 'Tatlılar', 3)
on conflict (id) do nothing;

insert into public.menu_items(id, category_id, name, description, price, is_available) values
  ('5e000000-0000-4000-8000-000000000101', '5e000000-0000-4000-8000-000000000001', 'Türk Kahvesi', 'Staging örnek ürünü', 90, true),
  ('5e000000-0000-4000-8000-000000000102', '5e000000-0000-4000-8000-000000000001', 'Americano', 'Staging örnek ürünü', 110, true),
  ('5e000000-0000-4000-8000-000000000103', '5e000000-0000-4000-8000-000000000001', 'Latte', 'Staging örnek ürünü', 130, true),
  -- Kuruşlu fiyat: yuvarlama ve adisyon toplamı için.
  ('5e000000-0000-4000-8000-000000000104', '5e000000-0000-4000-8000-000000000001', 'Espresso', 'Staging örnek ürünü', 87.50, true),
  ('5e000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000002', 'Limonata', 'Staging örnek ürünü', 100, true),
  ('5e000000-0000-4000-8000-000000000202', '5e000000-0000-4000-8000-000000000002', 'Ice Latte', 'Staging örnek ürünü', 140, true),
  ('5e000000-0000-4000-8000-000000000301', '5e000000-0000-4000-8000-000000000003', 'Tiramisu', 'Staging örnek ürünü', 150, true),
  -- Tükenmiş ürün: sunucunun reddettiğini doğrulamak için.
  ('5e000000-0000-4000-8000-000000000302', '5e000000-0000-4000-8000-000000000003', 'Tükenmiş Tatlı', 'Staging örnek ürünü', 120, false)
on conflict (id) do nothing;
