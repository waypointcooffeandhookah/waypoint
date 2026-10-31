import test from 'node:test'
import assert from 'node:assert/strict'
import { checkoutSummary, emptyForm, loadOnlineState, saveOnlineState, toOnlinePayload, trackingSteps, validateCheckout, mapTracking } from '../../src/pos/customer/onlineOrders.js'
import { canCancel, columnOf, groupFulfillment, nextFulfillmentStep } from '../../src/pos/fulfillment/fulfillmentOrders.js'
import { FULFILLMENT_LABELS, mapKitchenOrder } from '../../src/pos/kitchen/kitchenOrders.js'

const memory = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) } }
const valid = { ...emptyForm, name: 'Deneme Kişi', phone: '0555 000 00 00', street: 'Kurgusal Cadde 1', district: 'Deneme', postalCode: '99001' }

test('form: paket adres istemez, kurye adres ister', () => {
  assert.deepEqual(validateCheckout('pickup', { ...emptyForm, name: 'Ad Soyad', phone: '05550000000' }), {})
  assert.deepEqual(Object.keys(validateCheckout('pickup', emptyForm)).sort(), ['name', 'phone'])
  assert.deepEqual(validateCheckout('delivery', valid), {})
  assert.deepEqual(Object.keys(validateCheckout('delivery', { ...valid, street: 'x', district: '', postalCode: '1' })).sort(), ['district', 'postalCode', 'street'])
})

test('gönderim: paket adres taşımaz; fiyat ve ücret alanı yoktur', () => {
  assert.equal(toOnlinePayload('pickup', valid).address, null)
  const payload = toOnlinePayload('delivery', { ...valid, floor: ' ' })
  assert.equal(payload.address.floor, null)
  assert.ok(!/fee|price|total/.test(JSON.stringify(payload)))
})

test('toplam: kurye ücreti bilinmeden toplam gösterilmez ve gönderilemez', () => {
  assert.deepEqual(checkoutSummary('pickup', 500, null), { ready: true, feeCents: 0, totalCents: 500, problem: null })
  assert.equal(checkoutSummary('delivery', 500, null).ready, false)
  assert.equal(checkoutSummary('delivery', 500, null).totalCents, null)
  assert.equal(checkoutSummary('delivery', 500, { state: 'out' }).problem, 'out_of_area')
  assert.equal(checkoutSummary('delivery', 500, { state: 'error' }).problem, 'quote_error')
  const quote = { state: 'ok', feeCents: 3000, minOrderCents: 10000 }
  assert.deepEqual(checkoutSummary('delivery', 20000, quote), { ready: true, feeCents: 3000, totalCents: 23000, problem: null })
  const low = checkoutSummary('delivery', 5000, quote)
  assert.equal(low.problem, 'below_minimum')
  assert.equal(low.ready, false)
})

test('takip adımları: mutfak ve teslimat aynı çizgide, sırayla', () => {
  const current = order => trackingSteps(order).find(step => step.state === 'current').key
  assert.equal(current({ fulfillmentType: 'pickup', kitchenStatus: 'new', fulfillmentStatus: 'pending' }), 'new')
  assert.equal(current({ fulfillmentType: 'pickup', kitchenStatus: 'preparing', fulfillmentStatus: 'pending' }), 'preparing')
  assert.equal(current({ fulfillmentType: 'pickup', kitchenStatus: 'ready', fulfillmentStatus: 'awaiting_handoff' }), 'awaiting_handoff')
  assert.equal(current({ fulfillmentType: 'delivery', kitchenStatus: 'served', fulfillmentStatus: 'handed_to_courier' }), 'handed_to_courier')
  assert.ok(!trackingSteps({ fulfillmentType: 'pickup', kitchenStatus: 'new', fulfillmentStatus: 'pending' }).some(step => step.key === 'handed_to_courier'))
})

test('takip eşleme: kişisel alan taşımaz', () => {
  const mapped = mapTracking({ order_number: 1, fulfillment_type: 'pickup', kitchen_status: 'new', fulfillment_status: 'pending', payment_method: 'pay_at_pickup', payment_status: 'unpaid', subtotal_cents: 100, delivery_fee_cents: 0, total_cents: 100, created_at: '2026-10-31T10:00:00Z', items: null, customer_name: 'Gizli' })
  assert.ok(!JSON.stringify(mapped).includes('Gizli'))
})

test('saklama: bekleyen gönderim süresi dolunca silinir; bozuk kayıt güvenli', () => {
  const storage = memory(), now = 1_000_000_000
  const token = 'a'.repeat(64)
  saveOnlineState({ channel: 'delivery', cart: null, orders: [{ token, number: 1 }, { token: 'kotu' }], pending: { key: 'k', createdAt: now } }, storage)
  assert.equal(loadOnlineState(now + 60_000, storage).pending.key, 'k')
  assert.equal(loadOnlineState(now + 11 * 60_000, storage).pending, null)
  assert.deepEqual(loadOnlineState(now, storage).orders.map(o => o.token), [token])
  storage.setItem('waypoint-online-order-v1', '{bozuk')
  assert.equal(loadOnlineState(now, storage).channel, null)
})

test('yönetim: sütun ve sıradaki adım mutfaktan ayrıdır; hazır olmadan teslim açılmaz', () => {
  const order = extra => ({ type: 'delivery', kitchenStatus: 'new', status: 'pending', ...extra })
  assert.equal(columnOf(order()), 'incoming')
  assert.equal(columnOf(order({ kitchenStatus: 'preparing' })), 'preparing')
  assert.equal(nextFulfillmentStep(order({ kitchenStatus: 'preparing' })), null)
  assert.equal(nextFulfillmentStep(order({ status: 'awaiting_handoff' })).needsCourier, true)
  assert.equal(nextFulfillmentStep(order({ status: 'handed_to_courier' })).status, 'delivered')
  assert.equal(nextFulfillmentStep({ type: 'pickup', status: 'awaiting_handoff' }).status, 'collected')
  assert.equal(columnOf(order({ status: 'delivered' })), 'done')
  const groups = groupFulfillment([{ ...order(), id: 'yeni' }, { ...order(), id: 'eski' }])
  assert.deepEqual(groups.incoming.map(o => o.id), ['eski', 'yeni'], 'en eski üstte')
  assert.equal(canCancel(order({ kitchenStatus: 'preparing' }), 'cashier'), false)
  assert.equal(canCancel(order({ kitchenStatus: 'preparing' }), 'admin'), true)
  assert.equal(canCancel(order({ status: 'handed_to_courier' }), 'admin'), false)
})

test('mutfak: etiket kanaldan gelir; masa siparişi aynı kalır; kişisel alan eşlenmez', () => {
  const row = { id: '1', order_number: 1, source: 'qr', status: 'new', created_at: '2026-10-31T10:00:00Z', updated_at: '2026-10-31T10:00:00Z', order_items: [] }
  assert.equal(mapKitchenOrder({ ...row, fulfillment_type: 'pickup' }).tableLabel, FULFILLMENT_LABELS.pickup)
  assert.equal(mapKitchenOrder({ ...row, fulfillment_type: 'delivery' }).tableLabel, 'KURYE / TESLİMAT')
  assert.equal(mapKitchenOrder({ ...row, fulfillment_type: 'dine_in', restaurant_tables: { label: 'Masa 5' } }).tableLabel, 'Masa 5')
  assert.equal(mapKitchenOrder({ ...row, restaurant_tables: { label: 'Masa 5' } }).fulfillmentType, 'dine_in')
})
