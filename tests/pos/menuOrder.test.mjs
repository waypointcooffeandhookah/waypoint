// Menü sıralaması: saf yardımcılar (src/admin/menuOrder.js)
import test from 'node:test'
import assert from 'node:assert/strict'
import { bySortOrder, dropIndex, groupItemsByCategory, moveItem, renumber, reorderErrorMessage, shiftFor } from '../../src/admin/menuOrder.js'

test('moveItem taşır; sınır dışı/aynı yer listeyi değiştirmez', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c'])
  const list = ['a', 'b']
  assert.equal(moveItem(list, 1, 1), list)
  assert.equal(moveItem(list, 0, 5), list)
  assert.equal(moveItem(list, -1, 0), list)
})

test('renumber 1..n verir; bySortOrder sıra, sonra eklenme zamanına bakar', () => {
  assert.deepEqual(renumber([{ id: 'x', sort_order: 9 }, { id: 'y', sort_order: 2 }]).map(e => e.sort_order), [1, 2])
  const rows = [{ id: 'b', sort_order: 1, created_at: '2026-02' }, { id: 'a', sort_order: 1, created_at: '2026-01' }, { id: 'c', sort_order: 0 }]
  assert.deepEqual([...rows].sort(bySortOrder).map(r => r.id), ['c', 'a', 'b'])
})

test('groupItemsByCategory kategori sırasına göre gruplar; kategorisizler sona', () => {
  const categories = [{ id: 'k2', name: 'İçecek', sort_order: 2 }, { id: 'k1', name: 'Kahve', sort_order: 1 }]
  const items = [
    { id: 'i3', category_id: 'k1', sort_order: 2 }, { id: 'i1', category_id: 'k1', sort_order: 1 },
    { id: 'i2', category_id: 'k2', sort_order: 1 }, { id: 'i4', category_id: null, sort_order: 1 },
  ]
  const groups = groupItemsByCategory(items, categories)
  assert.deepEqual(groups.map(g => g.id), ['k1', 'k2', null])
  assert.deepEqual(groups[0].items.map(i => i.id), ['i1', 'i3'])
  assert.deepEqual(groupItemsByCategory(items.slice(0, 3), categories).map(g => g.id), ['k1', 'k2'])
})

test('sürükleme: bırakılan sıra ve diğer satırların kayması', () => {
  const rects = [0, 70, 140, 210].map(top => ({ top, height: 60 }))
  assert.equal(dropIndex(rects, 0, 30), 0)
  assert.equal(dropIndex(rects, 0, 180), 2)
  assert.equal(dropIndex(rects, 3, 10), 0)
  assert.equal(dropIndex(rects, 1, 999), 3)
  // 0 → 2: 1 ve 2 yukarı kayar; 3 yerinde
  assert.deepEqual([0, 1, 2, 3].map(i => shiftFor(i, 0, 2, 70)), [0, -70, -70, 0])
  // 3 → 1: 1 ve 2 aşağı kayar
  assert.deepEqual([0, 1, 2, 3].map(i => shiftFor(i, 3, 1, 70)), [0, 70, 70, 0])
  assert.equal(shiftFor(1, null, null, 70), 0)
})

test('hata mesajları', () => {
  assert.match(reorderErrorMessage({ message: 'pos:stale_order' }), /başka bir cihazda/)
  assert.match(reorderErrorMessage({ message: 'pos:forbidden' }), /yönetici/)
  assert.match(reorderErrorMessage({ code: 'PGRST202' }), /kurulumu/)
  assert.match(reorderErrorMessage(null), /kaydedilemedi/)
})
