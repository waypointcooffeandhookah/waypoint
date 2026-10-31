import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { countActions, mapImageUrl, planCatalogImport } from './staging-menu-import.lib.mjs'

const P = 'https://prod.supabase.co', S = 'https://stag.supabase.co'
const url = name => `${P}/storage/v1/object/public/menu-images/catalog/${name}`
const production = {
  categories: [
    { id: 'c-kahve', name: 'Kahveler', image_url: null, sort_order: 4, created_at: '2026-01-01T00:00:00Z' },
    { id: 'c-tatli', name: 'Tatlı Çeşitleri', image_url: null, sort_order: 11, created_at: '2026-01-02T00:00:00Z' },
    { id: 'c-gizli', name: 'Taze Meyve Suları', image_url: null, sort_order: 6, created_at: '2026-01-03T00:00:00Z' },
  ],
  items: [
    { id: 'p-latte', category_id: 'c-kahve', name: 'Latte', description: null, price: 130, image_url: url('latte.jpg'), is_available: true, created_at: '2026-01-01T00:00:00Z' },
    { id: 'p-tira', category_id: 'c-tatli', name: 'Tiramisu', description: 'd', price: 250, image_url: url('t.jpg'), is_available: true, created_at: '2026-01-02T00:00:00Z' },
    { id: 'p-ora', category_id: 'c-kahve', name: 'Muz Oralet', description: null, price: 40, image_url: null, is_available: false, created_at: '2026-01-03T00:00:00Z' },
  ],
  promotion: [{ id: 1, product_id: 'p-latte', enabled: true }],
}
const staging = {
  categories: [{ id: 's-kahve', name: 'Kahveler', image_url: null, sort_order: 1, created_at: '2025-01-01T00:00:00Z' }, { id: 's-tatli', name: 'Tatlılar', image_url: null, sort_order: 3, created_at: '2025-01-01T00:00:00Z' }],
  items: [
    { id: 's-latte', category_id: 's-kahve', name: 'LATTE', description: 'örnek', price: 99, image_url: null, is_available: true, created_at: '2025-01-01T00:00:00Z' },
    { id: 's-fix', category_id: 's-tatli', name: 'Tükenmiş Tatlı', description: 'örnek', price: 120, image_url: null, is_available: false, created_at: '2025-01-01T00:00:00Z' },
    { id: 's-diger', category_id: 's-tatli', name: 'Bilinmeyen', description: null, price: 1, image_url: null, is_available: true, created_at: '2025-01-01T00:00:00Z' },
  ],
}
const plan = planCatalogImport({ production, staging, productionOrigin: P, stagingOrigin: S })
const item = name => plan.items.find(entry => entry.row.name === name)

test('aynı adlı staging ürünü kimliğini korur, üretim değerlerini alır; kopya oluşmaz', () => {
  assert.equal(item('Latte').row.id, 's-latte')
  assert.equal(item('Latte').action, 'update')
  assert.equal(item('Latte').row.price, 130)
  assert.equal(item('Latte').row.category_id, 's-kahve')
  assert.equal(plan.items.length, 3)
})

test('yeni ürün üretim kimliğiyle eklenir; fiyat, açıklama, stok ve tarih korunur', () => {
  assert.deepEqual(item('Tiramisu').row, { id: 'p-tira', category_id: 's-tatli', name: 'Tiramisu', description: 'd', price: 250, image_url: `${S}/storage/v1/object/public/menu-images/catalog/t.jpg`, is_available: true, created_at: '2026-01-02T00:00:00Z' })
  assert.equal(item('Tiramisu').action, 'insert')
  assert.equal(item('Muz Oralet').row.is_available, false)
})

test('görselsiz ürüne uydurma görsel atanmaz; görsel üretim adresine bağlı kalmaz', () => {
  assert.equal(item('Muz Oralet').row.image_url, null)
  assert.ok(plan.items.every(entry => !entry.row.image_url?.startsWith(P)))
  assert.throws(() => mapImageUrl('https://kotu.example/a.jpg', P, S), /Tanınmayan/)
  assert.deepEqual(plan.imagePaths.sort(), ['catalog/latte.jpg', 'catalog/t.jpg'])
})

test('örnek kategori karşılığıyla birleşir ve sıra üretimden gelir; test ürünü silinmez, gizlenir', () => {
  const dessert = plan.categories.find(entry => entry.row.name === 'Tatlı Çeşitleri')
  assert.equal(dessert.row.id, 's-tatli')
  assert.equal(dessert.row.sort_order, 11)
  assert.deepEqual(plan.fixtures, [{ id: 's-fix', name: 'Tükenmiş Tatlı', needsMove: true, category_id: 'c-gizli' }])
  assert.deepEqual(plan.unmatched, [{ id: 's-diger', name: 'Bilinmeyen' }], 'tanınmayan ürün silinmez, raporlanır')
  assert.equal(plan.promotion.product_id, 's-latte')
})

test('tekrar çalıştırma: uygulanmış durumda değişiklik ve kopya üretmez', () => {
  const applied = {
    categories: plan.categories.map(entry => entry.row),
    items: [...plan.items.map(entry => entry.row), { ...staging.items[1], category_id: 'c-gizli' }],
  }
  const second = planCatalogImport({ production, staging: applied, productionOrigin: P, stagingOrigin: S })
  assert.deepEqual(countActions(second.items), { insert: 0, update: 0, same: 3 })
  assert.deepEqual(countActions(second.categories), { insert: 0, update: 0, same: 3 })
  assert.equal(second.fixtures[0].needsMove, false)
})

test('aktarım betiği üretime yalnızca GET gönderir; silme çağrısı içermez', () => {
  const source = readFileSync(new URL('./staging-import-menu.mjs', import.meta.url), 'utf8')
  const prodCalls = source.slice(source.indexOf('async function prodGet'), source.indexOf('const prodTable'))
  assert.match(prodCalls, /method: 'GET'/)
  assert.doesNotMatch(source, /\.delete\(|\.remove\(/)
  assert.match(source, /global: \{ fetch: guardedFetch \}/, 'staging istemcisi başka adrese istek gönderemez')
})
