// Üretim kataloğunu staging'e aktarma planı (saf mantık, testli). Silme yapmaz, ürün uydurmaz.
// Staging'de aynı adlı satır varsa onun kimliği korunur: siparişler ve ürün testleri bu kimliğe bağlıdır.
export const PRODUCTION_STORAGE_PREFIX = '/storage/v1/object/public/menu-images/'
const trKey = value => (value ?? '').toLocaleLowerCase('tr-TR').trim()

// Staging'in örnek kategorisi, üretimdeki karşılığıyla birleşir; boş kategori bırakmaz.
export const CATEGORY_ALIASES = { 'tatlılar': 'tatlı çeşitleri' }
// Üretimde olmayan test ürünü: müşteri menüsünden gizli kategoriye alınır, silinmez ("tükenmiş ürün reddi" testi kullanır).
export const FIXTURE_ITEM_NAMES = ['tükenmiş tatlı']
const HIDDEN_CATEGORY = 'taze meyve suları'

export function storagePath(url, productionOrigin) {
  if (!url) return null
  const parsed = new URL(url)
  if (parsed.origin !== productionOrigin || !parsed.pathname.startsWith(PRODUCTION_STORAGE_PREFIX)) return null
  return decodeURIComponent(parsed.pathname.slice(PRODUCTION_STORAGE_PREFIX.length))
}

export function mapImageUrl(url, productionOrigin, stagingOrigin) {
  if (!url) return null
  const path = storagePath(url, productionOrigin)
  if (path === null) throw new Error(`Tanınmayan görsel adresi: ${url}`)
  return `${stagingOrigin}${PRODUCTION_STORAGE_PREFIX}${path.split('/').map(encodeURIComponent).join('/')}`
}

const same = (a, b) => a === b || (a ?? null) === (b ?? null) || (typeof a === 'string' && Date.parse(a) === Date.parse(b))
const changedFields = (current, next, fields) => fields.filter(field => {
  if (field === 'price') return Number(current[field]) !== Number(next[field])
  return !same(current[field], next[field])
})

export function planCatalogImport({ production, staging, productionOrigin, stagingOrigin }) {
  const stagingCatById = new Map(staging.categories.map(cat => [cat.id, cat]))
  const stagingCatByName = new Map(staging.categories.map(cat => [trKey(cat.name), cat]))
  for (const [alias, target] of Object.entries(CATEGORY_ALIASES)) {
    const row = stagingCatByName.get(alias)
    if (row && !stagingCatByName.has(target)) stagingCatByName.set(target, row)
  }

  const categoryIds = new Map()
  const categories = production.categories.map(cat => {
    const current = stagingCatById.get(cat.id) ?? stagingCatByName.get(trKey(cat.name))
    const id = current?.id ?? cat.id
    categoryIds.set(cat.id, id)
    const row = { id, name: cat.name, image_url: cat.image_url ? mapImageUrl(cat.image_url, productionOrigin, stagingOrigin) : null, sort_order: cat.sort_order, created_at: cat.created_at }
    const changes = current ? changedFields(current, row, ['name', 'image_url', 'sort_order', 'created_at']) : ['yeni']
    return { row, action: !current ? 'insert' : changes.length ? 'update' : 'same', changes, productionName: cat.name }
  })

  const stagingItemById = new Map(staging.items.map(item => [item.id, item]))
  const stagingItemByName = new Map()
  for (const item of staging.items) if (!stagingItemByName.has(trKey(item.name))) stagingItemByName.set(trKey(item.name), item)

  const itemIds = new Map()
  const seen = new Set()
  const items = production.items.map(item => {
    const current = stagingItemById.get(item.id) ?? stagingItemByName.get(trKey(item.name))
    if (current && seen.has(current.id)) throw new Error(`Aynı satıra iki üretim ürünü eşlendi: ${item.name}`)
    if (current) seen.add(current.id)
    const id = current?.id ?? item.id
    itemIds.set(item.id, id)
    const categoryId = categoryIds.get(item.category_id)
    if (!categoryId) throw new Error(`Kategorisi bulunamadı: ${item.name}`)
    const row = {
      id, category_id: categoryId, name: item.name, description: item.description, price: item.price,
      image_url: mapImageUrl(item.image_url, productionOrigin, stagingOrigin), is_available: item.is_available, created_at: item.created_at,
    }
    const changes = current ? changedFields(current, row, ['category_id', 'name', 'description', 'price', 'image_url', 'is_available', 'created_at']) : ['yeni']
    return { row, action: !current ? 'insert' : changes.length ? 'update' : 'same', changes }
  })

  // Üretimde karşılığı olmayan staging satırları: test ürünü gizlenir, başkası varsa rapor edilir, silinmez.
  const hiddenId = categories.find(cat => trKey(cat.row.name) === HIDDEN_CATEGORY)?.row.id
  const fixtures = [], unmatched = []
  for (const item of staging.items) {
    if (seen.has(item.id)) continue
    if (FIXTURE_ITEM_NAMES.includes(trKey(item.name))) {
      fixtures.push({ id: item.id, name: item.name, needsMove: Boolean(hiddenId) && item.category_id !== hiddenId, category_id: hiddenId })
    } else {
      unmatched.push({ id: item.id, name: item.name })
    }
  }

  const promotion = production.promotion?.[0]
  return {
    categories, items, fixtures, unmatched,
    promotion: promotion ? { id: 1, product_id: promotion.product_id ? itemIds.get(promotion.product_id) ?? null : null, enabled: promotion.enabled } : null,
    imagePaths: [...new Set([...production.items, ...production.categories].map(row => storagePath(row.image_url, productionOrigin)).filter(Boolean))],
  }
}

export const countActions = rows => rows.reduce((counts, row) => ({ ...counts, [row.action]: (counts[row.action] ?? 0) + 1 }), { insert: 0, update: 0, same: 0 })
