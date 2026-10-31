import test from 'node:test'
import assert from 'node:assert/strict'
import {
  browserNotificationStatus, loadNotificationState, mapNotificationRow, notificationLines, notificationTitle,
  reconcileNotifications, saveNotificationState, showBrowserNotification, unreadCount,
} from '../../src/pos/waiter/notifications.js'
import { createDemoBackend } from '../../src/pos/backend/demoBackend.js'

const row = (id, status = 'ready') => ({ id, status })
const fresh = { initialized: false, seen: [], read: [] }
const memory = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) } }

test('bildirim satırı: masa, ürün sırası ve saat doğru eşlenir', () => {
  const item = mapNotificationRow({
    id: 12, order_id: 'o1', changed_at: '2026-10-31T10:00:00Z',
    orders: { order_number: 7, status: 'ready', source: 'waiter', table_id: 't5', restaurant_tables: { label: 'Masa 5' },
      order_items: [{ position: 2, item_name: 'Latte', quantity: 1 }, { position: 1, item_name: 'Türk Kahvesi', quantity: 2 }] },
  })
  assert.equal(item.id, '12')
  assert.equal(notificationTitle(item), 'Masa 5 — Siparişiniz Hazır!')
  assert.deepEqual(notificationLines(item), ['2 × Türk Kahvesi', '1 × Latte'])
  assert.equal(item.at, Date.parse('2026-10-31T10:00:00Z'))
})

test('ilk açılış: eski kayıtlar uyarı vermez ama okunmamış sayılır', () => {
  const { state, fresh: alerts } = reconcileNotifications(fresh, [row('1'), row('2', 'served')])
  assert.deepEqual(alerts, [])
  assert.equal(state.initialized, true)
  assert.equal(unreadCount([row('1'), row('2', 'served')], state.read), 1)
})

test('yeni olay yalnızca bir kez uyarır; yeniden okuma ve yeniden bağlanma çoğaltmaz', () => {
  let { state } = reconcileNotifications(fresh, [row('1')])
  const second = reconcileNotifications(state, [row('2'), row('1')])
  assert.deepEqual(second.fresh.map(r => r.id), ['2'])
  state = second.state
  const again = reconcileNotifications(state, [row('2'), row('1')])
  assert.deepEqual(again.fresh, [])
})

test('kopukken kaçırılan: hâlâ hazırsa uyarır, servis edildiyse uyarmaz', () => {
  const { state } = reconcileNotifications(fresh, [])
  const { fresh: alerts } = reconcileNotifications(state, [row('3'), row('4', 'served'), row('5', 'cancelled')])
  assert.deepEqual(alerts.map(r => r.id), ['3'])
})

test('sayfa yenilense de aynı olay tekrar uyarmaz, okundu bilgisi korunur', () => {
  const storage = memory()
  const { state } = reconcileNotifications(fresh, [row('1')])
  saveNotificationState('k', { ...state, read: ['1'] }, storage)
  const restored = loadNotificationState('k', storage)
  assert.deepEqual(reconcileNotifications(restored, [row('1')]).fresh, [])
  assert.equal(unreadCount([row('1')], restored.read), 0)
})

test('bozuk kayıt: yeni başlar, uyarı seli oluşturmaz', () => {
  const storage = memory()
  storage.setItem('k', '{bozuk')
  assert.deepEqual(reconcileNotifications(loadNotificationState('k', storage), [row('1')]).fresh, [])
})

test('sayaç: başka cihazda servis edilen sipariş okunmamıştan düşer', () => {
  assert.equal(unreadCount([row('1'), row('2')], []), 2)
  assert.equal(unreadCount([row('1', 'served'), row('2')], []), 1)
  assert.equal(unreadCount([row('2')], ['2']), 0)
})

test('tarayıcı bildirimi: HTTPS yoksa kapalı; yalnızca izinli ve arka plandayken gösterilir', () => {
  assert.equal(browserNotificationStatus({ isSecureContext: false, Notification: { permission: 'granted' } }), 'insecure')
  assert.equal(browserNotificationStatus({ isSecureContext: true }), 'unsupported')
  const shown = []
  class FakeNotification { static permission = 'granted'; constructor(title, options) { shown.push({ title, options }) } }
  const win = { isSecureContext: true, Notification: FakeNotification, document: { hidden: true }, focus() {} }
  const item = { id: '9', tableLabel: 'Masa 5', items: [{ name: 'Latte', quantity: 2 }] }
  assert.equal(showBrowserNotification(item, win), true)
  assert.equal(shown[0].title, 'Masa 5 — Siparişiniz Hazır!')
  assert.equal(shown[0].options.tag, 'waypoint-ready-9')
  assert.equal(showBrowserNotification(item, { ...win, document: { hidden: false } }), false)
  FakeNotification.permission = 'denied'
  assert.equal(showBrowserNotification(item, win), false)
})

test('tarayıcı bildirimi: Android gibi kurucu hata verirse uygulama bozulmaz', () => {
  class Throws { static permission = 'granted'; constructor() { throw new TypeError('Illegal constructor') } }
  const win = { isSecureContext: true, Notification: Throws, document: { hidden: true }, focus() {} }
  assert.equal(showBrowserNotification({ id: '1', tableLabel: 'Masa 1', items: [] }, win), false)
})

test('demo: hazır olan sipariş geçmişe bir kez düşer, servis edilince durumu güncellenir', async () => {
  const backend = createDemoBackend({ latencyMs: 0, catalogItems: [{ id: 'a', name: 'Latte', priceCents: 100, available: true }] })
  const order = (await backend.submit({ key: 'k', payload: { tableId: 'demo-masa-5', lines: [{ menuItemId: 'a', quantity: 2 }] } })).order
  await backend.setOrderStatus(order.id, 'preparing')
  assert.deepEqual(await backend.listReadyNotifications(), [])
  await backend.setOrderStatus(order.id, 'ready')
  const [item] = await backend.listReadyNotifications()
  assert.equal(item.tableLabel, 'Masa 5')
  assert.deepEqual(item.items, [{ name: 'Latte', quantity: 2 }])
  await backend.setOrderStatus(order.id, 'served')
  assert.equal((await backend.listReadyNotifications())[0].status, 'served')
})
