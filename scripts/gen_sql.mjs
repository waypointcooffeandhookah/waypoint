import fs from 'fs'

function toU(str) {
  let out = ''
  for (const ch of str) {
    const code = ch.codePointAt(0)
    if (code > 127) {
      out += '\\' + code.toString(16).toUpperCase().padStart(4, '0')
    } else if (ch === "'") {
      out += "''"
    } else {
      out += ch
    }
  }
  return out
}

const cats = [
  'Soğuk İçecekler','Sıcak İçecekler','Kahveler','Soğuk Kahveler',
  'Taze Meyve Suları','Refresher and Frozen','Milkshake','Smoothie',
  'Yiyecekler','Tatlı Çeşitleri','Nargile Çeşitleri'
]

const items = {
  'Soğuk İçecekler': [
    'Teneke Kola','Şişe Kola','Yedigün','Uludağ Gazoz','Burn','Redbull',
    'Şalgam','Ayran','Limonata','Sade Soda','Limonlu Soda',
    'Karpuz-Çilek Soda','Narlı Soda','Kiwili Soda','Karadutlu Soda',
    'Elmalı Soda','Ahududulu Soda','Bisküvi-Portakal-Elma Soda',
  ],
  'Sıcak İçecekler': [
    'Çay','Sıcak Çikolata','Marshmallowlu Sıcak Çikolata','Salep',
    'Böğürtlen Çayı','Ihlamur','Nane-Limon','Papatya','Kuşburnu Çayı',
  ],
  'Kahveler': [
    'Türk Kahvesi','Menengiç','Damla Sakızlı Türk Kahvesi','Osmanlı Kahvesi',
    'Dibek','Nescafe 3u1 Arada','Nescafe Gold','Espresso','Americano',
    'Mocha','Latte','Karamel Latte','Vanilya Latte','White Chocolate Mocha',
  ],
  'Soğuk Kahveler': [
    'Ice Americano','Ice Latte','Ice Karamel Latte',
    'Ice Vanilya Latte','Ice Mocha','Ice White Chocolate Mocha',
  ],
  'Taze Meyve Suları': [
    'Çilek','Muz','Karadut','Kiwi','Portakal','Limon','Kuşburnu',
  ],
  'Refresher and Frozen': [
    'Frambuazlı Frozen','Limonlu Frozen','Yaban Mersinli Frozen',
    'Orman Meyveleri Frozen','Çilek-Fesleğenli Frozen',
    'Kavunlu Frozen','Karpuzlu Frozen','Turunç Frozen',
    'Çilekli Frozen','Cool Lime','Berry Hibiscus',
  ],
  'Milkshake': [
    'Çilek Milkshake','Vanilya Milkshake','Çikolata Milkshake',
  ],
  'Smoothie': [
    'Orman Meyveli Smoothie','Frambuazlı Smoothie','Yaban Mersini Smoothie',
  ],
  'Yiyecekler': [
    'Köfte','Köfte Porsiyon','Patates Porsiyon','Kumru','Hamburger',
    'Döner','Patso','Kaşarlı Tost','Karışık Tost',
  ],
  'Tatlı Çeşitleri': [
    'San Sebastian Cheesecake','Sufle','Mono Latte',
    'İncirli-Cevizli Mono','Çikolata-Frambuaz Mono',
    'Lotus Cup','Orman Meyveli Cup','Tiramisu','Waffle',
    'Cedric Mango','Cedric Kahveli','Cedric Antep Fıstıklı',
  ],
  'Nargile Çeşitleri': [
    'Lady Killer','Enjoy','Siyah Üzüm - Yeşil Üzüm','Nane',
    'Pinkman','Tatlı Şeytan','Colombiere','Marbella',
    'Love 66','Cadı','Moskov','Dominic',
  ],
}

let sql = `-- ================================================================
-- WAYPOINT MENU DATA - UNICODE SAFE SQL
-- ================================================================

DELETE FROM menu_items;
DELETE FROM categories;

-- Kategoriler
INSERT INTO categories (name, sort_order) VALUES
`
sql += cats.map((c, i) => `  (U&'${toU(c)}', ${i + 1})`).join(',\n')
sql += ';\n\n'

for (const [cat, list] of Object.entries(items)) {
  sql += `-- ${cat.replace(/[^\x00-\x7F]/g, '?')}\n`
  sql += 'INSERT INTO menu_items (name, category_id, is_available) VALUES\n'
  sql += list.map(item =>
    `  (U&'${toU(item)}', (SELECT id FROM categories WHERE name=U&'${toU(cat)}'), true)`
  ).join(',\n')
  sql += ';\n\n'
}

sql += `-- Kontrol
SELECT c.name, COUNT(m.id) urun_sayisi
FROM categories c LEFT JOIN menu_items m ON m.category_id=c.id
GROUP BY c.name, c.sort_order ORDER BY c.sort_order;
`

fs.writeFileSync('supabase_menu_fixed.sql', sql, 'ascii')
console.log('OK - supabase_menu_fixed.sql yazildi:', fs.statSync('supabase_menu_fixed.sql').size, 'bytes')
