import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cartReducer, emptyCart, cartCount, quantityOf, toOrderPayloadLines, MAX_QUANTITY, MAX_LINES } from '../../src/pos/cart.js'
import { buildCatalog, filterCatalog } from '../../src/pos/catalog.js'
import { createDemoBackend } from '../../src/pos/backend/demoBackend.js'
import { createSubmission } from '../../src/pos/orderSubmission.js'
import { detectPosMode } from '../../src/pos/backend/staffAuth.js'

test('mod algılama: şema yoksa DEMO, varsa (anon yetkisiz) CANLI, ağ hatasında ulaşılamaz', async () => {
  const client = error => ({ from: () => ({ select: () => ({ limit: async () => ({ data: error ? null : [], error }) }) }) })
  assert.equal(await detectPosMode(client({ code: 'PGRST205', message: 'Could not find the table' })), 'demo')
  assert.equal(await detectPosMode(client({ code: '42501', message: 'permission denied' })), 'live')
  assert.equal(await detectPosMode(client(null)), 'live')
  assert.equal(await detectPosMode(client({ code: '', message: 'Failed to fetch' })), 'unreachable')
  assert.equal(await detectPosMode(client(null), '?demo'), 'demo')
})

const kahve = { id: 'k', name: 'Türk Kahvesi', price: 60 }
const tost = { id: 't', name: 'Kaşarlı Tost', price: 120.5 }
const reduce = (...actions) => actions.reduce(cartReducer, emptyCart)

test('sepet: ekleme aynı satırı artırır, notlu satır ayrı kalır, adet sınırlanır', () => {
  let cart = reduce({ type: 'add', item: kahve, lineId: 'a' }, { type: 'add', item: kahve, lineId: 'b' })
  assert.equal(cart.lines.length, 1)
  assert.equal(cart.lines[0].quantity, 2)

  cart = cartReducer(cart, { type: 'setLineNote', lineId: 'a', note: 'şekersiz' })
  cart = cartReducer(cart, { type: 'add', item: kahve, lineId: 'c' })
  assert.deepEqual(cart.lines.map(l => [l.lineId, l.quantity, l.note]), [['a', 2, 'şekersiz'], ['c', 1, '']])
  assert.equal(quantityOf(cart, 'k'), 3)

  cart = cartReducer(cart, { type: 'setQuantity', lineId: 'c', quantity: 99 })
  assert.equal(cart.lines[1].quantity, MAX_QUANTITY)
  cart = cartReducer(cart, { type: 'setQuantity', lineId: 'c', quantity: 0 })
  assert.equal(cart.lines.length, 1)
  assert.equal(cartCount(cart), 2)
})

test('sepet: sipariş satırları yalnızca kimlik, adet ve not içerir (fiyat gönderilmez)', () => {
  const cart = reduce({ type: 'add', item: tost, lineId: 'x' }, { type: 'setLineNote', lineId: 'x', note: '  bol kaşar ' }, { type: 'setNote', note: 'Acele' })
  assert.deepEqual(toOrderPayloadLines(cart), [{ menuItemId: 't', quantity: 1, note: 'bol kaşar' }])
  assert.equal(cart.note, 'Acele')
  assert.deepEqual(cartReducer(cart, { type: 'clear' }), emptyCart)
})

test('sepet: satır sayısı sınırı aşılmaz', () => {
  let cart = emptyCart
  for (let i = 0; i < MAX_LINES + 5; i++) cart = cartReducer(cart, { type: 'add', item: { id: `p${i}`, name: 'x', price: 1 } })
  assert.equal(cart.lines.length, MAX_LINES)
})

const rawCategories = [
  { id: 'c1', name: 'Sıcak İçecekler', sort_order: 1 },
  { id: 'c2', name: 'Yiyecekler', sort_order: 2 },
  { id: 'c3', name: 'Taze Meyve Suları', sort_order: 3 },
]
const rawItems = [
  { id: 'i1', name: 'Kaşarlı Tost', price: '120', category_id: 'c2', is_available: true },
  { id: 'i2', name: 'Türk Kahvesi', price: 60, category_id: 'c1', is_available: null },
  { id: 'i3', name: 'Portakal Suyu', price: 80, category_id: 'c3' },
  { id: 'i4', name: 'Salep', price: 70.25, category_id: 'c1', is_available: false },
]

test('katalog: gizli kategori çıkarılır, kategori sırası korunur, fiyat kuruşa çevrilir', () => {
  const catalog = buildCatalog(rawCategories, rawItems, item => `img/${item.id}`)
  assert.deepEqual(catalog.categories.map(c => c.name), ['Sıcak İçecekler', 'Yiyecekler'])
  assert.deepEqual(catalog.items.map(i => i.id), ['i2', 'i4', 'i1'])
  assert.equal(catalog.items.find(i => i.id === 'i4').priceCents, 7025)
  assert.equal(catalog.items.find(i => i.id === 'i2').available, true)
  assert.equal(catalog.items.find(i => i.id === 'i4').available, false)
  assert.equal(catalog.items[0].image, 'img/i2')
})

test('katalog: Türkçe büyük/küçük harf duyarsız arama tüm kategorilerde çalışır', () => {
  const { items } = buildCatalog(rawCategories, rawItems)
  assert.deepEqual(filterCatalog(items, { query: 'KAŞAR', categoryId: 'c1' }).map(i => i.id), ['i1'])
  assert.deepEqual(filterCatalog(items, { query: 'türk kah' }).map(i => i.id), ['i2'])
  assert.deepEqual(filterCatalog(items, { query: 'yiyecek' }).map(i => i.id), ['i1'])
  assert.deepEqual(filterCatalog(items, { categoryId: 'c1' }).map(i => i.id), ['i2', 'i4'])
})

test('demo: sipariş adisyona eklenir, fiyat katalogdan gelir, tekrar gönderim tek sipariş üretir', async () => {
  const { items } = buildCatalog(rawCategories, rawItems)
  const demo = createDemoBackend({ catalogItems: items, latencyMs: 0 })
  assert.equal(demo.mode, 'demo')
  assert.equal(await demo.getTableBill('demo-masa-1'), null)

  const submission = createSubmission({ tableId: 'demo-masa-1', lines: [{ menuItemId: 'i1', quantity: 2, note: null, price: 1 }], note: null })
  const first = await demo.submit(submission)
  const again = await demo.reconcile(submission)
  assert.equal(first.state, 'confirmed')
  assert.equal(first.order.demo, true)
  assert.equal(again.order.id, first.order.id)

  const bill = await demo.getTableBill('demo-masa-1')
  assert.equal(bill.orders.length, 1)
  assert.equal(bill.totalCents, 24000)
  const table = (await demo.listTables()).find(t => t.id === 'demo-masa-1')
  assert.deepEqual([table.occupied, table.totalCents, table.orderCount], [true, 24000, 1])
})

test('demo: mevcut olmayan ürün ve geçersiz masa reddedilir', async () => {
  const { items } = buildCatalog(rawCategories, rawItems)
  const demo = createDemoBackend({ catalogItems: items, latencyMs: 0 })
  const send = payload => demo.submit(createSubmission(payload))
  assert.deepEqual(await send({ tableId: 'demo-masa-2', lines: [{ menuItemId: 'i4', quantity: 1 }] }), { state: 'rejected', code: 'item_unavailable' })
  assert.deepEqual(await send({ tableId: 'yok', lines: [{ menuItemId: 'i1', quantity: 1 }] }), { state: 'rejected', code: 'table_not_found' })
  assert.deepEqual(await send({ tableId: 'demo-masa-2', lines: [{ menuItemId: 'i1', quantity: 21 }] }), { state: 'rejected', code: 'invalid_quantity' })
})
