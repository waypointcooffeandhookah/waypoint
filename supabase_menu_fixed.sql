-- ================================================================
-- WAYPOINT MENU DATA - UNICODE SAFE SQL
-- ================================================================

DELETE FROM menu_items;
DELETE FROM categories;

-- Kategoriler
INSERT INTO categories (name, sort_order) VALUES
  (U&'So\011Fuk \0130\00E7ecekler', 1),
  (U&'S\0131cak \0130\00E7ecekler', 2),
  (U&'Kahveler', 3),
  (U&'So\011Fuk Kahveler', 4),
  (U&'Taze Meyve Sular\0131', 5),
  (U&'Refresher and Frozen', 6),
  (U&'Milkshake', 7),
  (U&'Smoothie', 8),
  (U&'Yiyecekler', 9),
  (U&'Tatl\0131 \00C7e\015Fitleri', 10),
  (U&'Nargile \00C7e\015Fitleri', 11);

-- So?uk ??ecekler
INSERT INTO menu_items (name, category_id, is_available) VALUES
  (U&'Teneke Kola', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'\015Ei\015Fe Kola', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Yedig\00FCn', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Uluda\011F Gazoz', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Burn', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Redbull', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'\015Ealgam', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Ayran', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Limonata', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Sade Soda', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Limonlu Soda', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Karpuz-\00C7ilek Soda', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Narl\0131 Soda', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Kiwili Soda', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Karadutlu Soda', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Elmal\0131 Soda', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Ahududulu Soda', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true),
  (U&'Bisk\00FCvi-Portakal-Elma Soda', (SELECT id FROM categories WHERE name=U&'So\011Fuk \0130\00E7ecekler'), true);

-- S?cak ??ecekler
INSERT INTO menu_items (name, category_id, is_available) VALUES
  (U&'\00C7ay', (SELECT id FROM categories WHERE name=U&'S\0131cak \0130\00E7ecekler'), true),
  (U&'S\0131cak \00C7ikolata', (SELECT id FROM categories WHERE name=U&'S\0131cak \0130\00E7ecekler'), true),
  (U&'Marshmallowlu S\0131cak \00C7ikolata', (SELECT id FROM categories WHERE name=U&'S\0131cak \0130\00E7ecekler'), true),
  (U&'Salep', (SELECT id FROM categories WHERE name=U&'S\0131cak \0130\00E7ecekler'), true),
  (U&'B\00F6\011F\00FCrtlen \00C7ay\0131', (SELECT id FROM categories WHERE name=U&'S\0131cak \0130\00E7ecekler'), true),
  (U&'Ihlamur', (SELECT id FROM categories WHERE name=U&'S\0131cak \0130\00E7ecekler'), true),
  (U&'Nane-Limon', (SELECT id FROM categories WHERE name=U&'S\0131cak \0130\00E7ecekler'), true),
  (U&'Papatya', (SELECT id FROM categories WHERE name=U&'S\0131cak \0130\00E7ecekler'), true),
  (U&'Ku\015Fburnu \00C7ay\0131', (SELECT id FROM categories WHERE name=U&'S\0131cak \0130\00E7ecekler'), true);

-- Kahveler
INSERT INTO menu_items (name, category_id, is_available) VALUES
  (U&'T\00FCrk Kahvesi', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Menengi\00E7', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Damla Sak\0131zl\0131 T\00FCrk Kahvesi', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Osmanl\0131 Kahvesi', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Dibek', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Nescafe 3u1 Arada', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Nescafe Gold', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Espresso', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Americano', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Mocha', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Latte', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Karamel Latte', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'Vanilya Latte', (SELECT id FROM categories WHERE name=U&'Kahveler'), true),
  (U&'White Chocolate Mocha', (SELECT id FROM categories WHERE name=U&'Kahveler'), true);

-- So?uk Kahveler
INSERT INTO menu_items (name, category_id, is_available) VALUES
  (U&'Ice Americano', (SELECT id FROM categories WHERE name=U&'So\011Fuk Kahveler'), true),
  (U&'Ice Latte', (SELECT id FROM categories WHERE name=U&'So\011Fuk Kahveler'), true),
  (U&'Ice Karamel Latte', (SELECT id FROM categories WHERE name=U&'So\011Fuk Kahveler'), true),
  (U&'Ice Vanilya Latte', (SELECT id FROM categories WHERE name=U&'So\011Fuk Kahveler'), true),
  (U&'Ice Mocha', (SELECT id FROM categories WHERE name=U&'So\011Fuk Kahveler'), true),
  (U&'Ice White Chocolate Mocha', (SELECT id FROM categories WHERE name=U&'So\011Fuk Kahveler'), true);

-- Taze Meyve Sular?
INSERT INTO menu_items (name, category_id, is_available) VALUES
  (U&'\00C7ilek', (SELECT id FROM categories WHERE name=U&'Taze Meyve Sular\0131'), true),
  (U&'Muz', (SELECT id FROM categories WHERE name=U&'Taze Meyve Sular\0131'), true),
  (U&'Karadut', (SELECT id FROM categories WHERE name=U&'Taze Meyve Sular\0131'), true),
  (U&'Kiwi', (SELECT id FROM categories WHERE name=U&'Taze Meyve Sular\0131'), true),
  (U&'Portakal', (SELECT id FROM categories WHERE name=U&'Taze Meyve Sular\0131'), true),
  (U&'Limon', (SELECT id FROM categories WHERE name=U&'Taze Meyve Sular\0131'), true),
  (U&'Ku\015Fburnu', (SELECT id FROM categories WHERE name=U&'Taze Meyve Sular\0131'), true);

-- Refresher and Frozen
INSERT INTO menu_items (name, category_id, is_available) VALUES
  (U&'Frambuazl\0131 Frozen', (SELECT id FROM categories WHERE name=U&'Refresher and Frozen'), true),
  (U&'Limonlu Frozen', (SELECT id FROM categories WHERE name=U&'Refresher and Frozen'), true),
  (U&'Yaban Mersinli Frozen', (SELECT id FROM categories WHERE name=U&'Refresher and Frozen'), true),
  (U&'Orman Meyveleri Frozen', (SELECT id FROM categories WHERE name=U&'Refresher and Frozen'), true),
  (U&'\00C7ilek-Fesle\011Fenli Frozen', (SELECT id FROM categories WHERE name=U&'Refresher and Frozen'), true),
  (U&'Kavunlu Frozen', (SELECT id FROM categories WHERE name=U&'Refresher and Frozen'), true),
  (U&'Karpuzlu Frozen', (SELECT id FROM categories WHERE name=U&'Refresher and Frozen'), true),
  (U&'Turun\00E7 Frozen', (SELECT id FROM categories WHERE name=U&'Refresher and Frozen'), true),
  (U&'\00C7ilekli Frozen', (SELECT id FROM categories WHERE name=U&'Refresher and Frozen'), true),
  (U&'Cool Lime', (SELECT id FROM categories WHERE name=U&'Refresher and Frozen'), true),
  (U&'Berry Hibiscus', (SELECT id FROM categories WHERE name=U&'Refresher and Frozen'), true);

-- Milkshake
INSERT INTO menu_items (name, category_id, is_available) VALUES
  (U&'\00C7ilek Milkshake', (SELECT id FROM categories WHERE name=U&'Milkshake'), true),
  (U&'Vanilya Milkshake', (SELECT id FROM categories WHERE name=U&'Milkshake'), true),
  (U&'\00C7ikolata Milkshake', (SELECT id FROM categories WHERE name=U&'Milkshake'), true);

-- Smoothie
INSERT INTO menu_items (name, category_id, is_available) VALUES
  (U&'Orman Meyveli Smoothie', (SELECT id FROM categories WHERE name=U&'Smoothie'), true),
  (U&'Frambuazl\0131 Smoothie', (SELECT id FROM categories WHERE name=U&'Smoothie'), true),
  (U&'Yaban Mersini Smoothie', (SELECT id FROM categories WHERE name=U&'Smoothie'), true);

-- Yiyecekler
INSERT INTO menu_items (name, category_id, is_available) VALUES
  (U&'K\00F6fte', (SELECT id FROM categories WHERE name=U&'Yiyecekler'), true),
  (U&'K\00F6fte Porsiyon', (SELECT id FROM categories WHERE name=U&'Yiyecekler'), true),
  (U&'Patates Porsiyon', (SELECT id FROM categories WHERE name=U&'Yiyecekler'), true),
  (U&'Kumru', (SELECT id FROM categories WHERE name=U&'Yiyecekler'), true),
  (U&'Hamburger', (SELECT id FROM categories WHERE name=U&'Yiyecekler'), true),
  (U&'D\00F6ner', (SELECT id FROM categories WHERE name=U&'Yiyecekler'), true),
  (U&'Patso', (SELECT id FROM categories WHERE name=U&'Yiyecekler'), true),
  (U&'Ka\015Farl\0131 Tost', (SELECT id FROM categories WHERE name=U&'Yiyecekler'), true),
  (U&'Kar\0131\015F\0131k Tost', (SELECT id FROM categories WHERE name=U&'Yiyecekler'), true);

-- Tatl? ?e?itleri
INSERT INTO menu_items (name, category_id, is_available) VALUES
  (U&'San Sebastian Cheesecake', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true),
  (U&'Sufle', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true),
  (U&'Mono Latte', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true),
  (U&'\0130ncirli-Cevizli Mono', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true),
  (U&'\00C7ikolata-Frambuaz Mono', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true),
  (U&'Lotus Cup', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true),
  (U&'Orman Meyveli Cup', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true),
  (U&'Tiramisu', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true),
  (U&'Waffle', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true),
  (U&'Cedric Mango', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true),
  (U&'Cedric Kahveli', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true),
  (U&'Cedric Antep F\0131st\0131kl\0131', (SELECT id FROM categories WHERE name=U&'Tatl\0131 \00C7e\015Fitleri'), true);

-- Nargile ?e?itleri
INSERT INTO menu_items (name, category_id, is_available) VALUES
  (U&'Lady Killer', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true),
  (U&'Enjoy', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true),
  (U&'Siyah \00DCz\00FCm - Ye\015Fil \00DCz\00FCm', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true),
  (U&'Nane', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true),
  (U&'Pinkman', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true),
  (U&'Tatl\0131 \015Eeytan', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true),
  (U&'Colombiere', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true),
  (U&'Marbella', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true),
  (U&'Love 66', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true),
  (U&'Cad\0131', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true),
  (U&'Moskov', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true),
  (U&'Dominic', (SELECT id FROM categories WHERE name=U&'Nargile \00C7e\015Fitleri'), true);

-- Kontrol
SELECT c.name, COUNT(m.id) urun_sayisi
FROM categories c LEFT JOIN menu_items m ON m.category_id=c.id
GROUP BY c.name, c.sort_order ORDER BY c.sort_order;
