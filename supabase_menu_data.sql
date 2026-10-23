-- ================================================================
-- WAYPOINT DİJİTAL MENÜ — TAM VERİ YÜKLEME SCRIPT'İ
-- Supabase SQL Editor'de çalıştırın:
-- https://supabase.com/dashboard/project/vuqypdluduvqklickadn/sql/new
-- ================================================================

-- 1) Mevcut verileri temizle
DELETE FROM menu_items;
DELETE FROM categories;

-- 2) Kategorileri ekle
INSERT INTO categories (name, sort_order) VALUES
  ('Soğuk İçecekler',   1),
  ('Sıcak İçecekler',   2),
  ('Kahveler',           3),
  ('Soğuk Kahveler',     4),
  ('Taze Meyve Suları',  5),
  ('Refresher & Frozen', 6),
  ('Milkshake',          7),
  ('Smoothie',           8),
  ('Yiyecekler',         9),
  ('Tatlı Çeşitleri',   10),
  ('Nargile Çeşitleri', 11);

-- 3) Ürünleri ekle ─ Soğuk İçecekler
INSERT INTO menu_items (name, category_id, is_available) VALUES
  ('Teneke Kola',                (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Şişe Kola',                  (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Yedigün',                    (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Uludağ Gazoz',               (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Burn',                       (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Redbull',                    (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Şalgam',                     (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Ayran',                      (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Limonata',                   (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Sade Soda',                  (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Limonlu Soda',               (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Karpuz-Çilek Soda',         (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Narlı Soda',                 (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Kiwili Soda',                (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Karadutlu Soda',             (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Elmalı Soda',                (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Ahududulu Soda',             (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true),
  ('Bisküvi-Portakal-Elma Soda', (SELECT id FROM categories WHERE name='Soğuk İçecekler'), true);

-- 4) Ürünleri ekle ─ Sıcak İçecekler
INSERT INTO menu_items (name, category_id, is_available) VALUES
  ('Çay',                          (SELECT id FROM categories WHERE name='Sıcak İçecekler'), true),
  ('Sıcak Çikolata',               (SELECT id FROM categories WHERE name='Sıcak İçecekler'), true),
  ('Marshmallowlu Sıcak Çikolata', (SELECT id FROM categories WHERE name='Sıcak İçecekler'), true),
  ('Salep',                        (SELECT id FROM categories WHERE name='Sıcak İçecekler'), true),
  ('Böğürtlen Çayı',               (SELECT id FROM categories WHERE name='Sıcak İçecekler'), true),
  ('Ihlamur',                      (SELECT id FROM categories WHERE name='Sıcak İçecekler'), true),
  ('Nane-Limon',                   (SELECT id FROM categories WHERE name='Sıcak İçecekler'), true),
  ('Papatya',                      (SELECT id FROM categories WHERE name='Sıcak İçecekler'), true),
  ('Kuşburnu Çayı',                (SELECT id FROM categories WHERE name='Sıcak İçecekler'), true);

-- 5) Ürünleri ekle ─ Kahveler
INSERT INTO menu_items (name, category_id, is_available) VALUES
  ('Türk Kahvesi',               (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Menengiç',                   (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Damla Sakızlı Türk Kahvesi', (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Osmanlı Kahvesi',            (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Dibek',                      (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Nescafé 3''ü 1 Arada',       (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Nescafé Gold',               (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Espresso',                   (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Americano',                  (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Mocha',                      (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Latte',                      (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Karamel Latte',              (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('Vanilya Latte',              (SELECT id FROM categories WHERE name='Kahveler'), true),
  ('White Chocolate Mocha',      (SELECT id FROM categories WHERE name='Kahveler'), true);

-- 6) Ürünleri ekle ─ Soğuk Kahveler
INSERT INTO menu_items (name, category_id, is_available) VALUES
  ('Ice Americano',            (SELECT id FROM categories WHERE name='Soğuk Kahveler'), true),
  ('Ice Latte',                (SELECT id FROM categories WHERE name='Soğuk Kahveler'), true),
  ('Ice Karamel Latte',        (SELECT id FROM categories WHERE name='Soğuk Kahveler'), true),
  ('Ice Vanilya Latte',        (SELECT id FROM categories WHERE name='Soğuk Kahveler'), true),
  ('Ice Mocha',                (SELECT id FROM categories WHERE name='Soğuk Kahveler'), true),
  ('Ice White Chocolate Mocha',(SELECT id FROM categories WHERE name='Soğuk Kahveler'), true);

-- 7) Ürünleri ekle ─ Taze Meyve Suları
INSERT INTO menu_items (name, category_id, is_available) VALUES
  ('Çilek',    (SELECT id FROM categories WHERE name='Taze Meyve Suları'), true),
  ('Muz',      (SELECT id FROM categories WHERE name='Taze Meyve Suları'), true),
  ('Karadut',  (SELECT id FROM categories WHERE name='Taze Meyve Suları'), true),
  ('Kiwi',     (SELECT id FROM categories WHERE name='Taze Meyve Suları'), true),
  ('Portakal', (SELECT id FROM categories WHERE name='Taze Meyve Suları'), true),
  ('Limon',    (SELECT id FROM categories WHERE name='Taze Meyve Suları'), true),
  ('Kuşburnu', (SELECT id FROM categories WHERE name='Taze Meyve Suları'), true);

-- 8) Ürünleri ekle ─ Refresher & Frozen
INSERT INTO menu_items (name, category_id, is_available) VALUES
  ('Frambuazlı Frozen',       (SELECT id FROM categories WHERE name='Refresher & Frozen'), true),
  ('Limonlu Frozen',          (SELECT id FROM categories WHERE name='Refresher & Frozen'), true),
  ('Yaban Mersinli Frozen',   (SELECT id FROM categories WHERE name='Refresher & Frozen'), true),
  ('Orman Meyveleri Frozen',  (SELECT id FROM categories WHERE name='Refresher & Frozen'), true),
  ('Çilek-Fesleğenli Frozen', (SELECT id FROM categories WHERE name='Refresher & Frozen'), true),
  ('Kavunlu Frozen',          (SELECT id FROM categories WHERE name='Refresher & Frozen'), true),
  ('Karpuzlu Frozen',         (SELECT id FROM categories WHERE name='Refresher & Frozen'), true),
  ('Turunç Frozen',           (SELECT id FROM categories WHERE name='Refresher & Frozen'), true),
  ('Çilekli Frozen',          (SELECT id FROM categories WHERE name='Refresher & Frozen'), true),
  ('Cool Lime',               (SELECT id FROM categories WHERE name='Refresher & Frozen'), true),
  ('Berry Hibiscus',          (SELECT id FROM categories WHERE name='Refresher & Frozen'), true);

-- 9) Ürünleri ekle ─ Milkshake
INSERT INTO menu_items (name, category_id, is_available) VALUES
  ('Çilek Milkshake',    (SELECT id FROM categories WHERE name='Milkshake'), true),
  ('Vanilya Milkshake',  (SELECT id FROM categories WHERE name='Milkshake'), true),
  ('Çikolata Milkshake', (SELECT id FROM categories WHERE name='Milkshake'), true);

-- 10) Ürünleri ekle ─ Smoothie
INSERT INTO menu_items (name, category_id, is_available) VALUES
  ('Orman Meyveli Smoothie', (SELECT id FROM categories WHERE name='Smoothie'), true),
  ('Frambuazlı Smoothie',    (SELECT id FROM categories WHERE name='Smoothie'), true),
  ('Yaban Mersini Smoothie', (SELECT id FROM categories WHERE name='Smoothie'), true);

-- 11) Ürünleri ekle ─ Yiyecekler
INSERT INTO menu_items (name, category_id, is_available) VALUES
  ('Köfte',           (SELECT id FROM categories WHERE name='Yiyecekler'), true),
  ('Köfte Porsiyon',  (SELECT id FROM categories WHERE name='Yiyecekler'), true),
  ('Patates Porsiyon',(SELECT id FROM categories WHERE name='Yiyecekler'), true),
  ('Kumru',           (SELECT id FROM categories WHERE name='Yiyecekler'), true),
  ('Hamburger',       (SELECT id FROM categories WHERE name='Yiyecekler'), true),
  ('Döner',           (SELECT id FROM categories WHERE name='Yiyecekler'), true),
  ('Patso',           (SELECT id FROM categories WHERE name='Yiyecekler'), true),
  ('Kaşarlı Tost',    (SELECT id FROM categories WHERE name='Yiyecekler'), true),
  ('Karışık Tost',    (SELECT id FROM categories WHERE name='Yiyecekler'), true);

-- 12) Ürünleri ekle ─ Tatlı Çeşitleri
INSERT INTO menu_items (name, category_id, is_available) VALUES
  ('San Sebastian Cheesecake', (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true),
  ('Sufle',                    (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true),
  ('Mono Latte',               (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true),
  ('İncirli-Cevizli Mono',     (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true),
  ('Çikolata-Frambuaz Mono',   (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true),
  ('Lotus Cup',                (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true),
  ('Orman Meyveli Cup',        (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true),
  ('Tiramisu',                 (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true),
  ('Waffle',                   (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true),
  ('Cedric Mango',             (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true),
  ('Cedric Kahveli',           (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true),
  ('Cedric Antep Fıstıklı',    (SELECT id FROM categories WHERE name='Tatlı Çeşitleri'), true);

-- 13) Ürünleri ekle ─ Nargile Çeşitleri
INSERT INTO menu_items (name, category_id, is_available) VALUES
  ('Lady Killer',              (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true),
  ('Enjoy',                    (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true),
  ('Siyah Üzüm - Yeşil Üzüm', (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true),
  ('Nane',                     (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true),
  ('Pinkman',                  (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true),
  ('Tatlı Şeytan',             (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true),
  ('Colombiere',               (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true),
  ('Marbella',                 (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true),
  ('Love 66',                  (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true),
  ('Cadı',                     (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true),
  ('Moskov',                   (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true),
  ('Dominic',                  (SELECT id FROM categories WHERE name='Nargile Çeşitleri'), true);

-- ✅ Kontrol sorgusu — kaç ürün eklendi?
SELECT c.name AS kategori, COUNT(m.id) AS urun_sayisi
FROM categories c
LEFT JOIN menu_items m ON m.category_id = c.id
GROUP BY c.name, c.sort_order
ORDER BY c.sort_order;
