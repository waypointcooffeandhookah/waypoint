-- YALNIZCA STAGING: paket ve kurye kanallarını kurgusal bölgelerle açar. Gerçek ücret veya kapsam değildir.
update public.fulfillment_settings
   set pickup_enabled = true, delivery_enabled = true, allow_pay_at_pickup = true, allow_cash_on_delivery = true, updated_at = now()
 where id = 1;

insert into public.delivery_zones(id, name, postal_codes, districts, fee_cents, min_order_cents, is_active) values
  ('5e000000-0000-4000-8000-000000000401', 'Test Bölgesi Merkez', array['99001', '99002'], array['Deneme', 'Örnek Merkez'], 3000, 10000, true),
  ('5e000000-0000-4000-8000-000000000402', 'Test Bölgesi Uzak', array['99010'], array[]::text[], 7500, 25000, true),
  ('5e000000-0000-4000-8000-000000000403', 'Test Bölgesi Kapalı', array['99099'], array[]::text[], 1000, 0, false)
on conflict (id) do nothing;
