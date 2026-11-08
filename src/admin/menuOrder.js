// Menü sıralaması: saf yardımcılar (test edilir). Kayıt reorder_menu RPC'siyle tek işlemde yapılır.

export const bySortOrder = (a, b) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id))

// Listeden from sıradaki öğeyi to sırasına taşır (yeni dizi döner).
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

// Yeni sırayı uygular: listedeki öğelere 1..n sort_order verir.
export const renumber = list => list.map((entry, index) => ({ ...entry, sort_order: index + 1 }))

// Ürünleri kategori sırasıyla gruplar; her grubun ürünleri kendi sırasındadır. Kategorisiz ürünler sona.
export function groupItemsByCategory(items, categories) {
  const groups = [...categories].sort(bySortOrder).map(category => ({ id: category.id, name: category.name, items: [] }))
  const byId = new Map(groups.map(group => [group.id, group]))
  const loose = { id: null, name: 'Kategorisiz', items: [] }
  for (const item of items) (byId.get(item.category_id) ?? loose).items.push(item)
  for (const group of groups) group.items.sort(bySortOrder)
  loose.items.sort(bySortOrder)
  return loose.items.length ? [...groups, loose] : groups
}

// Sürüklenen satırın ortası hangi sıraya düşüyor: diğer satırların (başlangıçtaki) orta noktalarına göre.
export function dropIndex(rects, from, centerY) {
  let index = 0
  rects.forEach((rect, i) => { if (i !== from && rect.top + rect.height / 2 < centerY) index++ })
  return index
}

// Sürükleme sırasında diğer satırların kayma miktarı (px).
export function shiftFor(index, from, over, step) {
  if (from == null || over == null || index === from) return 0
  if (from < over && index > from && index <= over) return -step
  if (from > over && index >= over && index < from) return step
  return 0
}

export function reorderErrorMessage(error) {
  const text = `${error?.message ?? ''}`
  if (text.includes('stale_order')) return 'Liste başka bir cihazda değişmiş; güncel sıra yüklendi, tekrar deneyin.'
  if (text.includes('forbidden')) return 'Sıralamak için yönetici yetkisi gerekli.'
  if (error?.code === 'PGRST202') return 'Sıralama kurulumu henüz veritabanında yok.'
  return 'Sıra kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin.'
}
