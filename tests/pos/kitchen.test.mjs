import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDemoBackend } from '../../src/pos/backend/demoBackend.js'
import { createDemoStore } from '../../src/pos/backend/demoStore.js'
import { createSubmission } from '../../src/pos/orderSubmission.js'
import { startOrderSync } from '../../src/pos/orderSync.js'
import { statusResult } from '../../src/pos/orderStatus.js'
import { findNewArrivals, groupByStatus, isLate, mapKitchenOrder } from '../../src/pos/kitchen/kitchenOrders.js'
import { orderErrorMessage, statusErrorMessage } from '../../src/pos/messages.js'

const catalogItems = [
  { id: 'kofte', name: 'Izgara Köfte', priceCents: 22000, available: true },
  { id: 'cay', name: 'Çay', priceCents: 2000, available: true },
]
const newStore = () => createDemoStore()
const tab = store => createDemoBackend({ catalogItems, latencyMs: 0, store })
const order = (tableId, lines, note = null) => createSubmission({ tableId, lines, note })
const kofte = (quantity, note = null) => ({ menuItemId: 'kofte', quantity, note })
const cay = quantity => ({ menuItemId: 'cay', quantity, note: null })

test('garson siparişi mutfakta doğru masa, adet ve notla görünür', async () => {
  const store = newStore()
  const result = await tab(store).submit(order('demo-masa-5', [kofte(2, 'az pişmiş')], 'Acele'))
  assert.equal(result.state, 'confirmed')

  const [seen] = await tab(store).listKitchenOrders()
  assert.equal(seen.id, result.order.id)
  assert.deepEqual([seen.tableId, seen.tableLabel, seen.source, seen.status, seen.note], ['demo-masa-5', 'Masa 5', 'waiter', 'new', 'Acele'])
  assert.deepEqual(seen.items.map(i => [i.name, i.quantity, i.note]), [['Izgara Köfte', 2, 'az pişmiş']])
  assert.equal(typeof seen.createdAt, 'number')
})

test('aynı masaya ek sipariş öncekini ezmez, adisyon toplamı güncellenir', async () => {
  const demo = tab(newStore())
  await demo.submit(order('demo-masa-5', [kofte(2)]))
  await demo.submit(order('demo-masa-5', [cay(3)]))
  await demo.submit(order('demo-masa-6', [cay(1)]))

  const bill = await demo.getTableBill('demo-masa-5')
  assert.equal(bill.orders.length, 2)
  assert.equal(bill.orderCount, 2)
  assert.equal(bill.totalCents, 2 * 22000 + 3 * 2000)
  assert.equal(bill.balanceCents, bill.totalCents)
  const table = (await demo.listTables()).find(t => t.id === 'demo-masa-5')
  assert.deepEqual([table.occupied, table.totalCents, table.orderCount], [true, bill.totalCents, 2])
  assert.equal((await demo.getTableBill('demo-masa-6')).totalCents, 2000)
})

test('mutfak durumu ileri taşır; garson adisyonu ve masa kartı güncel durumu görür', async () => {
  const store = newStore()
  const waiter = tab(store), kitchen = tab(store)
  const { order: { id } } = await waiter.submit(order('demo-masa-5', [kofte(1)]))

  assert.equal((await kitchen.setOrderStatus(id, 'preparing')).order.status, 'preparing')
  assert.equal((await waiter.getTableBill('demo-masa-5')).orders[0].status, 'preparing')
  assert.equal((await kitchen.setOrderStatus(id, 'ready')).order.status, 'ready')
  assert.equal((await waiter.listTables()).find(t => t.id === 'demo-masa-5').readyCount, 1)
  assert.equal((await waiter.setOrderStatus(id, 'served')).order.status, 'served')
  assert.equal((await waiter.listTables()).find(t => t.id === 'demo-masa-5').readyCount, 0)
  // Servis edilen sipariş adisyonda kalır, toplam değişmez.
  assert.equal((await waiter.getTableBill('demo-masa-5')).totalCents, 22000)
})

test('geçersiz durum geçişi reddedilir, aynı duruma ikinci dokunuş zararsızdır', async () => {
  const demo = tab(newStore())
  const { order: { id } } = await demo.submit(order('demo-masa-5', [kofte(1)]))
  assert.deepEqual(await demo.setOrderStatus(id, 'served'), { state: 'rejected', code: 'invalid_transition' })
  assert.deepEqual(await demo.setOrderStatus('yok', 'ready'), { state: 'rejected', code: 'order_not_found' })
  await demo.setOrderStatus(id, 'preparing')
  const again = await demo.setOrderStatus(id, 'preparing')
  assert.deepEqual([again.state, again.order.duplicate], ['confirmed', true])
  assert.deepEqual(await demo.setOrderStatus(id, 'new'), { state: 'rejected', code: 'invalid_transition' })
})

test('çift gönderim, eşzamanlı olsa bile tek sipariş üretir', async () => {
  const store = newStore()
  const submission = order('demo-masa-5', [kofte(1)])
  const [a, b] = await Promise.all([tab(store).submit(submission), tab(store).reconcile(submission)])
  assert.equal(a.order.id, b.order.id)
  assert.equal((await tab(store).getTableBill('demo-masa-5')).orders.length, 1)
  assert.equal((await tab(store).listKitchenOrders()).length, 1)
})

test('eşzamanlı farklı siparişler birbirini ezmez ve numaraları tekildir', async () => {
  const store = newStore()
  const results = await Promise.all(Array.from({ length: 5 }, () => tab(store).submit(order('demo-masa-5', [cay(1)]))))
  assert.equal(new Set(results.map(r => r.order.orderNumber)).size, 5)
  assert.equal((await tab(store).getTableBill('demo-masa-5')).orders.length, 5)
})

test('sekmeler arası: storage olayı diğer sekmeyi uyarır, aynı veriyi okur', async () => {
  const values = new Map()
  const events = new EventTarget()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { values.set(key, value); queueMicrotask(() => events.dispatchEvent(Object.assign(new Event('storage'), { key }))) },
  }
  const kitchenStore = createDemoStore({ storage, target: events })
  const waiter = tab(createDemoStore({ storage }))
  const kitchen = tab(kitchenStore)

  let notified = 0
  const unsubscribe = kitchen.subscribe(() => { notified++ }, () => {})
  const { order: { id } } = await waiter.submit(order('demo-masa-5', [kofte(1)]))
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(notified >= 1)
  assert.ok((await kitchen.listKitchenOrders()).some(o => o.id === id))

  unsubscribe()
  const seen = notified
  await waiter.submit(order('demo-masa-5', [cay(1)]))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(notified, seen)
})

test('bozuk demo verisi uygulamayı düşürmez, sıfırlama başlangıca döner', async () => {
  const values = new Map([['waypoint-pos-demo-v1', '{bozuk']])
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const demo = tab(createDemoStore({ storage }))
  assert.equal(await demo.getTableBill('demo-masa-5'), null)
  await demo.submit(order('demo-masa-5', [cay(1)]))
  await demo.resetDemo()
  assert.equal(await demo.getTableBill('demo-masa-5'), null)
})

test('demo veri kaynağı Supabase\'e bağlanamaz', () => {
  for (const file of ['demoBackend.js', 'demoStore.js']) {
    assert.doesNotMatch(readFileSync(new URL(`../../src/pos/backend/${file}`, import.meta.url), 'utf8'), /supabase|posApi/i)
  }
})

function fakeSync(refresh) {
  const events = new EventTarget()
  const channel = { }
  const stop = startOrderSync({
    subscribe(onChange, onConnection) { channel.onChange = onChange; channel.onConnection = onConnection; return () => { channel.closed = true } },
    refresh, pollMs: 1e6, target: events, doc: null,
  })
  return { events, channel, ...stop }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('yeniden bağlanma: kaçırılan siparişler kalıcı kayıttan yeniden okunur', async () => {
  let reads = 0
  const sync = fakeSync(async () => { reads++ })
  await tick()
  assert.equal(reads, 1)

  sync.channel.onConnection('connected')
  await tick()
  assert.equal(reads, 2) // İlk abonelik: açılışla abonelik arası boşluk kapanır.

  sync.channel.onConnection('disconnected')
  await tick()
  assert.equal(reads, 2)
  sync.channel.onConnection('connected')
  await tick()
  assert.equal(reads, 3)

  sync.events.dispatchEvent(new Event('online'))
  await tick()
  assert.equal(reads, 4)
  sync.events.dispatchEvent(new Event('focus'))
  await tick()
  assert.equal(reads, 5)
  sync.channel.onChange()
  await tick()
  assert.equal(reads, 6)

  sync.stop()
  assert.equal(sync.channel.closed, true)
  sync.events.dispatchEvent(new Event('online'))
  await tick()
  assert.equal(reads, 6)
})

test('yenileme: bildirim kaybolsa da düzenli okuma çalışır; üst üste okumalar birleşir, hata döngüyü bozmaz', async () => {
  let reads = 0
  const release = []
  const sync = fakeSync(() => { reads++; return new Promise(resolve => release.push(resolve)) })
  sync.channel.onChange(); sync.channel.onChange(); sync.channel.onChange()
  assert.equal(reads, 1)
  release.shift()()
  await tick()
  assert.equal(reads, 2) // Bekleyen tüm sinyaller tek okumada toplandı.
  release.shift()()
  await tick()
  assert.equal(reads, 2)
  sync.stop()

  let polled = 0
  const polling = startOrderSync({ subscribe: () => () => {}, refresh: async () => { polled++; throw new Error('ağ') }, pollMs: 5, target: null, doc: null })
  await new Promise(resolve => setTimeout(resolve, 30))
  polling.stop()
  assert.ok(polled >= 2)
})

test('mutfak mantığı: gruplama, yeni sipariş uyarısı, gecikme', () => {
  const o = (id, status, createdAt = 0) => ({ id, status, createdAt })
  const groups = groupByStatus([o('a', 'new'), o('b', 'new'), o('c', 'served'), o('d', 'served'), o('e', 'cancelled')])
  assert.deepEqual(groups.new.map(x => x.id), ['a', 'b'])
  assert.deepEqual(groups.served.map(x => x.id), ['d', 'c'])

  assert.deepEqual(findNewArrivals(null, [o('a', 'new')]), [])
  assert.deepEqual(findNewArrivals(new Set(['a']), [o('a', 'new'), o('b', 'new'), o('c', 'ready')]).map(x => x.id), ['b'])

  assert.equal(isLate(o('a', 'new', 0), 15 * 60000), true)
  assert.equal(isLate(o('a', 'new', 0), 14 * 60000), false)
  assert.equal(isLate(o('a', 'served', 0), 60 * 60000), false)
})

test('canlı eşleme: satır sırası korunur, sunucu hataları doğru sınıflanır', () => {
  const mapped = mapKitchenOrder({
    id: 'x', order_number: 7, source: 'qr', status: 'new', created_at: '2026-10-31T10:00:00Z', updated_at: '2026-10-31T10:00:00Z', note: null, table_id: 't',
    restaurant_tables: { label: 'Masa 5' }, order_items: [{ position: 2, item_name: 'B', quantity: 1, note: null }, { position: 1, item_name: 'A', quantity: 2, note: 'n' }],
  })
  assert.equal(mapped.tableLabel, 'Masa 5')
  assert.deepEqual(mapped.items.map(i => i.name), ['A', 'B'])

  assert.equal(statusResult({ data: { status: 'ready' }, error: null }).state, 'confirmed')
  assert.deepEqual(statusResult({ error: { code: 'P0001', message: 'pos:invalid_transition' } }), { state: 'rejected', code: 'invalid_transition' })
  assert.deepEqual(statusResult({ error: { code: '', message: 'Failed to fetch' } }), { state: 'error' })
  assert.match(statusErrorMessage('invalid_transition'), /yenilendi/)
  assert.match(statusErrorMessage(undefined), /Bağlantınızı/)
  assert.ok(orderErrorMessage('bill_closed'))
})

test('rotalar: QR menü, yönetici, garson ve mutfak birlikte tanımlı', () => {
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')
  for (const route of ['path="/" element={<GeneralMenuRoute />}', 'path="/admin/login"', 'path="/admin"', 'path="/garson/*"', 'path="/mutfak"']) assert.ok(app.includes(route), route)
})
