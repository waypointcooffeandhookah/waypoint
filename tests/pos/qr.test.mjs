import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDemoBackend } from '../../src/pos/backend/demoBackend.js'
import { createDemoStore } from '../../src/pos/backend/demoStore.js'
import { createSubmission, reconcileOrder, submitOrder } from '../../src/pos/orderSubmission.js'
import { cartReducer, emptyCart, toOrderPayloadLines } from '../../src/pos/cart.js'
import { classifyTable, demoTableIdOf, isFreshPending, isLiveToken, loadQrState, mapQrOrder, saveQrState, MAX_AGE_MS, RECONCILE_MAX_AGE_MS } from '../../src/pos/customer/qrOrders.js'

const catalogItems = [
  { id: 'kahve', name: 'Türk Kahvesi', price: 60, priceCents: 6000, available: true },
  { id: 'tost', name: 'Kaşarlı Tost', price: 120, priceCents: 12000, available: true },
  { id: 'bitti', name: 'Salep', price: 70, priceCents: 7000, available: false },
]
const setup = (options = {}) => {
  const store = createDemoStore()
  const staff = createDemoBackend({ catalogItems, latencyMs: 0, store, ...options })
  return { store, staff, qr: staff.qr('demo-5') }
}
const line = (menuItemId, quantity, note = null) => ({ menuItemId, quantity, note })
const qrOrder = (lines, note = null) => createSubmission({ tableToken: 'demo-5', lines, note })

test('müşteri siparişi mutfakta QR olarak, doğru masada ve kalem kalem görünür', async () => {
  const { staff, qr } = setup()
  assert.deepEqual(await qr.getTable(), { state: 'ready', label: 'Masa 5' })
  const { state, order } = await qr.submit(qrOrder([line('kahve', 2, 'az şekerli')]))
  assert.equal(state, 'confirmed')
  const seen = (await staff.listKitchenOrders()).find(o => o.id === order.id)
  assert.deepEqual([seen.source, seen.tableLabel, seen.status], ['qr', 'Masa 5', 'new'])
  assert.deepEqual(seen.items.map(i => [i.name, i.quantity, i.note]), [['Türk Kahvesi', 2, 'az şekerli']])
})

test('fiyat ve toplam sunucudan gelir; tarayıcının gönderdiği fiyat yok sayılır', async () => {
  const { qr, staff } = setup()
  const { order } = await qr.submit(qrOrder([{ ...line('kahve', 2), price: 1, priceCents: 1, lineTotalCents: 1 }]))
  assert.equal(order.subtotalCents, 12000)
  assert.equal((await staff.getTableBill('demo-masa-5')).totalCents, 12000)
})

test('QR ve garson siparişleri aynı adisyonda birlikte durur, önceki kayıtlar korunur', async () => {
  const { qr, staff } = setup()
  await qr.submit(qrOrder([line('kahve', 2)]))
  await staff.submit(createSubmission({ tableId: 'demo-masa-5', lines: [line('tost', 1)] }))
  await qr.submit(qrOrder([line('kahve', 1)]))

  const bill = await staff.getTableBill('demo-masa-5')
  assert.deepEqual(bill.orders.map(o => o.source), ['qr', 'waiter', 'qr'])
  assert.equal(bill.totalCents, 12000 + 12000 + 6000)
  assert.equal(new Set(bill.orders.map(o => o.id)).size, 3)
  assert.equal(await staff.getTableBill('demo-masa-6'), null)
})

test('aynı masadan farklı müşteriler: siparişler ayrı, her müşteri yalnızca kendininkini görür', async () => {
  const { store, staff } = setup()
  const alice = createDemoBackend({ catalogItems, latencyMs: 0, store }).qr('demo-5')
  const ayse = createDemoBackend({ catalogItems, latencyMs: 0, store }).qr('demo-5')
  const [a, b] = await Promise.all([alice.submit(qrOrder([line('kahve', 1)])), ayse.submit(qrOrder([line('tost', 1)]))])
  assert.notEqual(a.order.id, b.order.id)
  assert.equal((await staff.getTableBill('demo-masa-5')).orders.length, 2)
  assert.deepEqual((await alice.listOrders([a.order.key])).map(o => o.id), [a.order.id])
  assert.deepEqual((await ayse.listOrders([b.order.key])).map(o => o.id), [b.order.id])
})

test('müşteri durumu mutfak değişikliğini görür; başka masanın anahtarıyla sipariş görünmez', async () => {
  const { qr, staff } = setup()
  const { order } = await qr.submit(qrOrder([line('kahve', 1)]))
  await staff.setOrderStatus(order.id, 'preparing')
  assert.equal((await qr.listOrders([order.key]))[0].status, 'preparing')
  assert.deepEqual(await staff.qr('demo-6').listOrders([order.key]), [])
})

test('çift gönderim tek sipariş üretir; anahtar başka masada kullanılamaz', async () => {
  const { qr, staff } = setup()
  const submission = qrOrder([line('kahve', 1)])
  const [a, b] = await Promise.all([qr.submit(submission), qr.reconcile(submission)])
  assert.equal(a.order.id, b.order.id)
  assert.equal((await staff.getTableBill('demo-masa-5')).orders.length, 1)
  assert.deepEqual(await staff.qr('demo-6').submit(submission), { state: 'rejected', code: 'idempotency_key_conflict' })
})

test('hız sınırı, tükenen ürün, geçersiz masa ve geçersiz adet reddedilir; adisyon değişmez', async () => {
  const { qr, staff } = setup()
  assert.deepEqual(await qr.submit(qrOrder([line('bitti', 1)])), { state: 'rejected', code: 'item_unavailable' })
  assert.deepEqual(await qr.submit(qrOrder([line('yok', 1)])), { state: 'rejected', code: 'item_unavailable' })
  assert.deepEqual(await qr.submit(qrOrder([line('kahve', 21)])), { state: 'rejected', code: 'invalid_quantity' })
  assert.deepEqual(await qr.submit(qrOrder([])), { state: 'rejected', code: 'empty_order' })
  assert.deepEqual(await staff.qr('demo-99').submit(qrOrder([line('kahve', 1)])), { state: 'rejected', code: 'invalid_table' })
  assert.equal(await staff.getTableBill('demo-masa-5'), null)
  assert.deepEqual(await staff.qr('demo-99').getTable(), { state: 'invalid' })

  for (let i = 0; i < 12; i++) assert.equal((await qr.submit(qrOrder([line('kahve', 1)]))).state, 'confirmed')
  assert.deepEqual(await qr.submit(qrOrder([line('kahve', 1)])), { state: 'rejected', code: 'rate_limited' })
  // Garson sınırdan etkilenmez.
  assert.equal((await staff.submit(createSubmission({ tableId: 'demo-masa-5', lines: [line('kahve', 1)] }))).state, 'confirmed')
})

test('başarısız yazım başarı sayılmaz; aynı anahtarla doğrulama tek sipariş üretir', async () => {
  let broken = true
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (broken) throw new Error('kota'); values.set(key, value) },
  }
  const staff = createDemoBackend({ catalogItems, latencyMs: 0, store: createDemoStore({ storage }) })
  const qr = staff.qr('demo-5')
  const submission = qrOrder([line('kahve', 1)])
  assert.equal((await qr.submit(submission)).state, 'uncertain')
  broken = false
  assert.equal((await qr.reconcile(submission)).state, 'confirmed')
  assert.equal((await qr.reconcile(submission)).order.duplicate, true)
  assert.equal((await staff.getTableBill('demo-masa-5')).orders.length, 1)
})

test('canlı akış: ağ hatası belirsizdir, önce sorgulanır; kayıt varsa yeniden gönderilmez', async () => {
  const row = { order_id: 'o1', order_number: 9, idempotency_key: 'k', status: 'new', source: 'qr', created_at: '2026-10-31T10:00:00Z', subtotal_cents: '12000', items: [{ name: 'Kahve', quantity: 2, line_total_cents: '12000', note: null }] }
  let sends = 0
  const transport = found => ({
    send: async () => { sends++; return { data: row, error: null } },
    lookup: async () => ({ data: found ? row : null, error: null }),
  })
  const sub = { key: 'k', payload: {} }
  const lost = await submitOrder(sub, { send: async () => { throw new Error('ağ') } })
  assert.equal(lost.state, 'uncertain')

  assert.equal((await reconcileOrder(sub, transport(true))).state, 'confirmed')
  assert.equal(sends, 0)
  assert.equal((await reconcileOrder(sub, transport(false))).state, 'confirmed')
  assert.equal(sends, 1)

  const rejected = await submitOrder(sub, { send: async () => ({ data: null, error: { code: 'P0001', message: 'pos:rate_limited' } }) })
  assert.deepEqual([rejected.state, rejected.code], ['rejected', 'rate_limited'])

  const mapped = mapQrOrder(row)
  assert.deepEqual([mapped.id, mapped.orderNumber, mapped.key, mapped.subtotalCents, mapped.items[0].lineTotalCents], ['o1', 9, 'k', 12000, 12000])
})

test('masa kodu: canlı biçim sıkıdır, demo kodu canlı sayılmaz, hatalar ayrışır', () => {
  assert.equal(isLiveToken('a'.repeat(64)), true)
  for (const bad of ['a'.repeat(63), 'A'.repeat(64), 'demo-5', "'; drop table", '', null]) assert.equal(isLiveToken(bad), false)
  assert.equal(demoTableIdOf('demo-5'), 'demo-masa-5')
  for (const bad of ['demo-0', 'demo-x', 'demo-5/..', 'a'.repeat(64), null]) assert.equal(demoTableIdOf(bad), null)

  assert.deepEqual(classifyTable({ data: { table_label: 'Masa 2' }, error: null }), { state: 'ready', label: 'Masa 2' })
  assert.equal(classifyTable({ error: { code: 'P0001', message: 'pos:invalid_table' } }).state, 'invalid')
  assert.equal(classifyTable({ error: { code: 'PGRST202', message: 'not found' } }).state, 'unavailable')
  assert.equal(classifyTable({ error: { code: '', message: 'Failed to fetch' } }).state, 'unreachable')
})

test('müşteri sepeti: adet, not ve katalog eşitleme; fiyat gönderilen satıra girmez', () => {
  let cart = emptyCart
  cart = cartReducer(cart, { type: 'add', item: { id: 'kahve', name: 'K', price: 50 }, lineId: 'a' })
  cart = cartReducer(cart, { type: 'add', item: { id: 'kahve', name: 'K', price: 50 }, lineId: 'b' })
  cart = cartReducer(cart, { type: 'add', item: { id: 'bitti', name: 'S', price: 70 }, lineId: 'c' })
  cart = cartReducer(cart, { type: 'setLineNote', lineId: 'a', note: 'sade' })
  cart = cartReducer(cart, { type: 'syncCatalog', items: catalogItems })
  assert.deepEqual(cart.lines.map(l => [l.lineId, l.quantity, l.price]), [['a', 2, 60]])
  assert.deepEqual(toOrderPayloadLines(cart), [{ menuItemId: 'kahve', quantity: 2, note: 'sade' }])
})

test('cihaz kaydı: sepet ve anahtarlar saklanır, süresi geçen silinir, bozuk veri düşürmez', () => {
  const values = new Map()
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }
  const now = 1e12
  const cart = { lines: [{ lineId: 'a' }], note: '' }
  saveQrState('t', { cart, submissions: [{ key: 'eski', createdAt: now - MAX_AGE_MS - 1 }, { key: 'yeni', createdAt: now }] }, now, storage)
  const loaded = loadQrState('t', now, storage)
  assert.deepEqual(loaded.cart, cart)
  assert.deepEqual(loaded.submissions.map(s => s.key), ['yeni'])
  assert.equal(loadQrState('t', now + MAX_AGE_MS + 1, storage).cart, null)
  assert.deepEqual(loadQrState('başka', now, storage), { cart: null, submissions: [] })
  values.set('waypoint-qr-v1:t', '{bozuk')
  assert.deepEqual(loadQrState('t', now, storage), { cart: null, submissions: [] })

  assert.ok(isFreshPending({ pending: true, createdAt: now }, now))
  assert.ok(!isFreshPending({ pending: true, createdAt: now - RECONCILE_MAX_AGE_MS }, now))
  assert.ok(!isFreshPending({ createdAt: now }, now))
})

test('normal menü: sipariş kodu ana pakete girmez, /masa/ ayrı yüklenir', () => {
  const menu = readFileSync(new URL('../../src/pages/MenuPage.jsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(menu, /from '\.\.\/pos\//)
  assert.match(app, /lazy\(\(\) => import\('\.\/pos\/customer\/QrOrderRoute'\)\)/)
  // Genel menü sipariş kodunu yalnızca kanal açıksa yükler.
  const route = readFileSync(new URL('../../src/pages/GeneralMenuRoute.jsx', import.meta.url), 'utf8')
  assert.match(app, /path="\/" element=\{<GeneralMenuRoute \/>\}/)
  assert.doesNotMatch(route, /^import .* from '\.\.\/pos\//m)
  assert.match(route, /lazy\(\(\) => import\('\.\.\/pos\/customer\/OnlineOrderingController'\)\)/)
})
