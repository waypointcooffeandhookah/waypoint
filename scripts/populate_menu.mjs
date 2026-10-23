import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vuqypdluduvqklickadn.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1cXlwZGx1ZHV2cWtsaWNrYWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNDM4MDYsImV4cCI6MjEwNzYxOTgwNn0.nZnOenXLrsPubBn3ZBGLPLhc4kd1uhPXiYJQ-UW_8RM'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Kategoriler ──────────────────────────────────────────────
const CATEGORIES = [
  { name: 'Soğuk İçecekler',   sort_order: 1  },
  { name: 'Sıcak İçecekler',   sort_order: 2  },
  { name: 'Kahveler',           sort_order: 3  },
  { name: 'Soğuk Kahveler',     sort_order: 4  },
  { name: 'Taze Meyve Suları',  sort_order: 5  },
  { name: 'Refresher & Frozen', sort_order: 6  },
  { name: 'Milkshake',          sort_order: 7  },
  { name: 'Smoothie',           sort_order: 8  },
  { name: 'Yiyecekler',         sort_order: 9  },
  { name: 'Tatlı Çeşitleri',    sort_order: 10 },
  { name: 'Nargile Çeşitleri',  sort_order: 11 },
]

// ── Menü Ürünleri ─────────────────────────────────────────────
const ITEMS = {
  'Soğuk İçecekler': [
    'Teneke Kola', 'Şişe Kola', 'Yedigün', 'Uludağ Gazoz',
    'Burn', 'Redbull', 'Şalgam', 'Ayran', 'Limonata',
    'Sade Soda', 'Limonlu Soda', 'Karpuz-Çilek Soda',
    'Narlı Soda', 'Kiwili Soda', 'Karadutlu Soda',
    'Elmalı Soda', 'Ahududulu Soda', 'Bisküvi-Portakal-Elma Soda',
  ],
  'Sıcak İçecekler': [
    'Çay', 'Sıcak Çikolata', 'Marshmallowlu Sıcak Çikolata', 'Salep',
    'Böğürtlen Çayı', 'Ihlamur', 'Nane-Limon', 'Papatya', 'Kuşburnu Çayı',
  ],
  'Kahveler': [
    'Türk Kahvesi', 'Menengiç', 'Damla Sakızlı Türk Kahvesi',
    'Osmanlı Kahvesi', 'Dibek', "Nescafé 3'ü 1 Arada", 'Nescafé Gold',
    'Espresso', 'Americano', 'Mocha', 'Latte',
    'Karamel Latte', 'Vanilya Latte', 'White Chocolate Mocha',
  ],
  'Soğuk Kahveler': [
    'Ice Americano', 'Ice Latte', 'Ice Karamel Latte',
    'Ice Vanilya Latte', 'Ice Mocha', 'Ice White Chocolate Mocha',
  ],
  'Taze Meyve Suları': [
    'Çilek', 'Muz', 'Karadut', 'Kiwi', 'Portakal', 'Limon', 'Kuşburnu',
  ],
  'Refresher & Frozen': [
    'Frambuazlı Frozen', 'Limonlu Frozen', 'Yaban Mersinli Frozen',
    'Orman Meyveleri Frozen', 'Çilek-Fesleğenli Frozen',
    'Kavunlu Frozen', 'Karpuzlu Frozen', 'Turunç Frozen',
    'Çilekli Frozen', 'Cool Lime', 'Berry Hibiscus',
  ],
  'Milkshake': [
    'Çilek Milkshake', 'Vanilya Milkshake', 'Çikolata Milkshake',
  ],
  'Smoothie': [
    'Orman Meyveli Smoothie', 'Frambuazlı Smoothie', 'Yaban Mersini Smoothie',
  ],
  'Yiyecekler': [
    'Köfte', 'Köfte Porsiyon', 'Patates Porsiyon', 'Kumru',
    'Hamburger', 'Döner', 'Patso', 'Kaşarlı Tost', 'Karışık Tost',
  ],
  'Tatlı Çeşitleri': [
    'San Sebastian Cheesecake', 'Sufle', 'Mono Latte',
    'İncirli-Cevizli Mono', 'Çikolata-Frambuaz Mono',
    'Lotus Cup', 'Orman Meyveli Cup', 'Tiramisu', 'Waffle',
    'Cedric Mango', 'Cedric Kahveli', 'Cedric Antep Fıstıklı',
  ],
  'Nargile Çeşitleri': [
    'Lady Killer', 'Enjoy', 'Siyah Üzüm - Yeşil Üzüm', 'Nane',
    'Pinkman', 'Tatlı Şeytan', 'Colombiere', 'Marbella',
    'Love 66', 'Cadı', 'Moskov', 'Dominic',
  ],
}

async function main() {
  console.log('🗑️  Mevcut veriler temizleniyor...')
  const { error: delItems } = await supabase.from('menu_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (delItems) { console.error('menu_items silinemedi:', delItems); process.exit(1) }
  const { error: delCats } = await supabase.from('categories').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (delCats) { console.error('categories silinemedi:', delCats); process.exit(1) }
  console.log('✅ Temizlendi.\n')

  console.log('📂 Kategoriler ekleniyor...')
  const { data: insertedCats, error: catErr } = await supabase
    .from('categories')
    .insert(CATEGORIES)
    .select()
  if (catErr) { console.error('Kategori hatası:', catErr); process.exit(1) }

  const catMap = {}
  for (const c of insertedCats) catMap[c.name] = c.id
  console.log(`✅ ${insertedCats.length} kategori eklendi.\n`)

  console.log('🍽️  Ürünler ekleniyor...')
  let total = 0
  for (const [catName, itemNames] of Object.entries(ITEMS)) {
    const catId = catMap[catName]
    if (!catId) { console.warn(`⚠️  Kategori bulunamadı: ${catName}`); continue }

    const rows = itemNames.map((name, idx) => ({
      name,
      category_id: catId,
      available: true,
      sort_order: idx + 1,
    }))

    const { error: itemErr } = await supabase.from('menu_items').insert(rows)
    if (itemErr) { console.error(`${catName} hata:`, itemErr); continue }
    console.log(`  ✅ ${catName}: ${rows.length} ürün`)
    total += rows.length
  }

  console.log(`\n🎉 Tamamlandı! Toplam ${total} ürün eklendi.`)
}

main()
