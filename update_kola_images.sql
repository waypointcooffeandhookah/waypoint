-- ================================================================
-- WAYPOINT QR MENÜ — KOLA RESİMLERİ VE AÇIKLAMALARI GÜNCELLEME
-- Supabase SQL Editor'de çalıştırabilirsiniz.
-- ================================================================

-- Cam Şişe Kola güncelleme
UPDATE menu_items
SET 
  image_url = 'images/cam-kola.jpg',
  description = 'Buz gibi ferahlatıcı klasik cam şişe kola (250ml)'
WHERE name = 'Şişe Kola' OR name = 'Cam Kola' OR name = 'Cam Şişe Kola';

-- Teneke Kutu Kola güncelleme
UPDATE menu_items
SET 
  image_url = 'images/teneke-kola.jpg',
  description = 'Soğuk servis edilen ferahlatıcı kutu teneke kola (330ml)'
WHERE name = 'Teneke Kola' OR name = 'Kutu Kola';
