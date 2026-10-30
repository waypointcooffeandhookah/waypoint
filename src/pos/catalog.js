// Personel ekranları için ortak ürün kataloğu: mevcut menü tablolarını (salt okunur) kullanır.
// Görsel çözümleyici dışarıdan verilir (QR menüdeki getItemImage), böylece modül saf kalır.
import { priceToCents } from './money.js'

const lower = s => (s || '').toLocaleLowerCase('tr-TR')

// QR menüde de gizlenen eski kategori.
const HIDDEN_CATEGORIES = ['taze meyve suları']

export function buildCatalog(rawCategories, rawItems, imageOf = () => null) {
  const categories = rawCategories
    .filter(cat => !HIDDEN_CATEGORIES.includes(lower(cat.name).trim()))
    .map(cat => ({ id: cat.id, name: cat.name }))
  const order = new Map(categories.map((cat, index) => [cat.id, index]))
  const items = rawItems
    .filter(item => order.has(item.category_id))
    .map(item => {
      const categoryName = categories[order.get(item.category_id)].name
      return {
        id: item.id,
        name: item.name,
        price: Number(item.price) || 0,
        priceCents: priceToCents(item.price) ?? 0,
        categoryId: item.category_id,
        categoryName,
        image: imageOf(item),
        available: item.is_available !== false,
        searchText: lower(`${item.name} ${categoryName}`),
      }
    })
    .sort((a, b) => order.get(a.categoryId) - order.get(b.categoryId))
  return { categories, items }
}

// Arama tüm kategorilerde yapılır; arama yoksa seçili kategori gösterilir.
export function filterCatalog(items, { query = '', categoryId = null } = {}) {
  const terms = lower(query).trim().split(/\s+/).filter(Boolean)
  return items.filter(item =>
    terms.length ? terms.every(term => item.searchText.includes(term)) : !categoryId || item.categoryId === categoryId)
}

export async function loadCatalog(supabase, imageOf) {
  const [cats, items] = await Promise.all([
    supabase.from('categories').select('id, name, sort_order').order('sort_order'),
    supabase.from('menu_items').select('id, name, price, image_url, is_available, category_id, created_at').order('created_at'),
  ])
  if (cats.error) throw cats.error
  if (items.error) throw items.error
  return buildCatalog(cats.data ?? [], items.data ?? [], imageOf)
}
