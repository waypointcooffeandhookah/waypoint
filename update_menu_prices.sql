-- 23 Ekim 2026: Kullanıcının f1/f2/f3 fiyat listelerindeki yiyecek ve içecekler.
-- Nargile ürünlerinde değişiklik yapmaz. Fiyatlar TL.

with prices(category, name, price) as (values
('Soğuk İçecekler', 'Teneke Kola', 80),
('Soğuk İçecekler', 'Şişe Kola', 50),
('Soğuk İçecekler', 'Yedigün', 80),
('Soğuk İçecekler', 'Uludağ Gazoz', 50),
('Soğuk İçecekler', 'Burn', 100),
('Soğuk İçecekler', 'Redbull', 100),
('Soğuk İçecekler', 'Şalgam', 50),
('Soğuk İçecekler', 'Ayran', 20),
('Soğuk İçecekler', 'Limonata', 50),
('Soğuk İçecekler', 'Sade Soda', 40),
('Soğuk İçecekler', 'Limonlu Soda', 40),
('Soğuk İçecekler', 'Karpuz-Çilek Soda', 40),
('Soğuk İçecekler', 'Narlı Soda', 40),
('Soğuk İçecekler', 'Kiwili Soda', 40),
('Soğuk İçecekler', 'Karadutlu Soda', 40),
('Soğuk İçecekler', 'Elmalı Soda', 40),
('Soğuk İçecekler', 'Ahududulu Soda', 40),
('Soğuk İçecekler', 'Bisküvi-Portakal-Elma Soda', 40),
('Sıcak İçecekler', 'Çay', 20),
('Sıcak İçecekler', 'Sıcak Çikolata', 100),
('Sıcak İçecekler', 'Marshmallowlu Sıcak Çikolata', 120),
('Sıcak İçecekler', 'Salep', 100),
('Sıcak İçecekler', 'Böğürtlen Çayı', 80),
('Sıcak İçecekler', 'Ihlamur', 80),
('Sıcak İçecekler', 'Nane-Limon', 80),
('Sıcak İçecekler', 'Papatya', 80),
('Sıcak İçecekler', 'Kuşburnu Çayı', 80),
('Kahveler', 'Türk Kahvesi', 80),
('Kahveler', 'Menengiç', 80),
('Kahveler', 'Damla Sakızlı Türk Kahvesi', 80),
('Kahveler', 'Osmanlı Kahvesi', 80),
('Kahveler', 'Dibek', 80),
('Kahveler', 'Nescafe 3u1 Arada', 80),
('Kahveler', 'Nescafe Gold', 80),
('Kahveler', 'Espresso', 100),
('Kahveler', 'Americano', 130),
('Kahveler', 'Mocha', 130),
('Kahveler', 'Latte', 130),
('Kahveler', 'Karamel Latte', 130),
('Kahveler', 'Vanilya Latte', 130),
('Kahveler', 'White Chocolate Mocha', 130),
('Soğuk Kahveler', 'Ice Americano', 150),
('Soğuk Kahveler', 'Ice Latte', 150),
('Soğuk Kahveler', 'Ice Karamel Latte', 150),
('Soğuk Kahveler', 'Ice Vanilya Latte', 150),
('Soğuk Kahveler', 'Ice Mocha', 150),
('Soğuk Kahveler', 'Ice White Chocolate Mocha', 150),
('Refresher and Frozen', 'Frambuazlı Frozen', 150),
('Refresher and Frozen', 'Limonlu Frozen', 150),
('Refresher and Frozen', 'Yaban Mersinli Frozen', 150),
('Refresher and Frozen', 'Orman Meyveleri Frozen', 150),
('Refresher and Frozen', 'Çilek-Fesleğenli Frozen', 150),
('Refresher and Frozen', 'Kavunlu Frozen', 150),
('Refresher and Frozen', 'Karpuzlu Frozen', 150),
('Refresher and Frozen', 'Turunç Frozen', 150),
('Refresher and Frozen', 'Çilekli Frozen', 150),
('Refresher and Frozen', 'Cool Lime', 120),
('Refresher and Frozen', 'Berry Hibiscus', 120),
('Milkshake', 'Çilek Milkshake', 150),
('Milkshake', 'Vanilya Milkshake', 150),
('Milkshake', 'Çikolata Milkshake', 150),
('Smoothie', 'Orman Meyveli Smoothie', 150),
('Smoothie', 'Frambuazlı Smoothie', 150),
('Smoothie', 'Yaban Mersini Smoothie', 150),
('Yiyecekler', 'Köfte', 200),
('Yiyecekler', 'Köfte Porsiyon', 300),
('Yiyecekler', 'Patates Porsiyon', 100),
('Yiyecekler', 'Kumru', 200),
('Yiyecekler', 'Hamburger', 250),
('Yiyecekler', 'Döner', 150),
('Yiyecekler', 'Patso', 150),
('Yiyecekler', 'Kaşarlı Tost', 130),
('Yiyecekler', 'Karışık Tost', 130),
('Tatlı Çeşitleri', 'San Sebastian Cheesecake', 250),
('Tatlı Çeşitleri', 'Mono Latte', 250),
('Tatlı Çeşitleri', 'İncirli-Cevizli Mono', 250),
('Tatlı Çeşitleri', 'Çikolata-Frambuaz Mono', 250),
('Tatlı Çeşitleri', 'Lotus Cup', 250),
('Tatlı Çeşitleri', 'Orman Meyveli Cup', 250),
('Tatlı Çeşitleri', 'Tiramisu', 250),
('Tatlı Çeşitleri', 'Waffle', 250),
('Tatlı Çeşitleri', 'Cedric Mango', 250),
('Tatlı Çeşitleri', 'Cedric Kahveli', 250),
('Tatlı Çeşitleri', 'Cedric Antep Fıstıklı', 250),
('Tatlı Çeşitleri', 'Sufle', 200))
update public.menu_items m set price = p.price
from prices p, public.categories c
where m.category_id = c.id and c.name = p.category and m.name = p.name;
-- Eski meyve suyu kayıtları aslında Oralet aromalarıydı; kimlikleri korunur.
update public.menu_items m set name = (case m.name when 'Kiwi' then 'Kivi' else m.name end) || ' Oralet',
 price = 40, category_id = hot.id
from public.categories old, public.categories hot
where m.category_id = old.id and old.name = 'Taze Meyve Suları'
 and hot.name = 'Sıcak İçecekler' and m.name in ('Çilek','Muz','Karadut','Kiwi','Kivi','Portakal','Limon','Kuşburnu');
update public.menu_items m set price = 40
from public.categories c where m.category_id=c.id and c.name='Sıcak İçecekler'
and m.name in ('Çilek Oralet','Muz Oralet','Karadut Oralet','Kivi Oralet','Portakal Oralet','Limon Oralet','Kuşburnu Oralet');

-- Sonuçları kontrol edin:
select c.name as kategori, m.name as urun, m.price as fiyat
from public.menu_items m join public.categories c on c.id=m.category_id
where c.name <> 'Nargile Çeşitleri' order by c.sort_order,m.name;
