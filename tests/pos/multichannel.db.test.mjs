import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createDb, createUser, rpc, rpcError, as, addTable, menuItem, ANON } from './db-harness.mjs'

const db = await createDb()
const admin = await createUser(db, { role: 'admin', name: 'Yönetici' })
const cashier = await createUser(db, { staffRole: 'cashier', name: 'Kasa' })
const waiter = await createUser(db, { staffRole: 'waiter', name: 'Garson' })
const kitchen = await createUser(db, { staffRole: 'kitchen', name: 'Mutfak' })
const { rows: [firstItem] } = await db.query('select name from public.menu_items where price > 0 and is_available limit 1')
const item = await menuItem(db, firstItem.name)
const unit = Math.round(Number(item.price) * 100)
const items = (quantity = 1) => JSON.stringify([{ menu_item_id: item.id, quantity }])
let phoneSeq = 0
const customer = () => JSON.stringify({ name: 'Deneme Müşteri', phone: `0555${String(++phoneSeq).padStart(7, '0')}` })
const address = (extra = {}) => JSON.stringify({ street: 'Kurgusal Cadde No 1', district: 'Deneme', postal_code: '99001', building: '3', floor: '2', door: '5', instructions: 'Zili çalın', ...extra })
const place = (type, overrides = {}) => rpc(db, ANON, 'place_online_order', { p_fulfillment_type: type, p_idempotency_key: randomUUID(), p_items: items(type === 'delivery' ? 20 : 1), p_customer: customer(), p_address: type === 'delivery' ? address() : null, ...overrides })
const placeError = (type, overrides = {}) => rpcError(db, ANON, 'place_online_order', { p_fulfillment_type: type, p_idempotency_key: randomUUID(), p_items: items(type === 'delivery' ? 20 : 1), p_customer: customer(), p_address: type === 'delivery' ? address() : null, ...overrides })

// Seed'den önce, üretimdeki ilk durum: kanallar kapalı, bölge yok.
const closed = {
  config: await rpc(db, ANON, 'get_ordering_config', {}),
  pickup: await placeError('pickup'),
  delivery: await placeError('delivery'),
  address: await rpc(db, ANON, 'check_delivery_address', { p_postal_code: '99001', p_district: 'Deneme' }),
}

test('kanallar varsayılan kapalıdır: ücret ve bölge uydurulmaz, sipariş reddedilir', () => {
  assert.deepEqual(closed.config, { pickup: false, delivery: false })
  assert.match(closed.pickup, /channel_closed/)
  assert.match(closed.delivery, /channel_closed/)
  assert.deepEqual(closed.address, { in_area: false })
})

await db.exec(readFileSync(new URL('../../supabase/staging/04_multichannel_seed.sql', import.meta.url), 'utf8'))

test('paket: masa, oturum ve adisyon oluşmaz; numara ve takip kodu üretilir', async () => {
  const before = (await db.query('select count(*)::int n from public.bills')).rows[0].n
  const order = await place('pickup', { p_items: items(2) })
  assert.equal(order.fulfillment_type, 'pickup')
  assert.equal(order.table_label, null)
  assert.equal(Number(order.total_cents), unit * 2)
  assert.match(order.tracking_token, /^[0-9a-f]{64}$/)
  assert.equal(order.payment_status, 'unpaid')
  assert.equal((await db.query('select count(*)::int n from public.bills')).rows[0].n, before)
  const { rows: [row] } = await db.query('select table_id, session_id, bill_id from public.orders where id = $1', [order.order_id])
  assert.deepEqual(row, { table_id: null, session_id: null, bill_id: null })
})

test('kurye: ücret sunucuda bölgeden gelir, tarayıcıdan gelen fiyat yok sayılır', async () => {
  const tampered = JSON.stringify([{ menu_item_id: item.id, quantity: 20, price: 1, unit_price_cents: 1 }])
  const order = await place('delivery', { p_items: tampered, p_customer: JSON.stringify({ name: 'Deneme', phone: '05550000001', fee_cents: 0 }), p_address: address({ fee_cents: 0 }) })
  assert.equal(Number(order.delivery_fee_cents), 3000)
  assert.equal(Number(order.total_cents), unit * 20 + 3000)
})

test('kurye: alan dışı, kapalı bölge, ilçe uyuşmazlığı ve eksik adres reddedilir', async () => {
  assert.match(await placeError('delivery', { p_address: address({ postal_code: '11111' }) }), /out_of_area/)
  assert.match(await placeError('delivery', { p_address: address({ postal_code: '99099' }) }), /out_of_area/)
  assert.match(await placeError('delivery', { p_address: address({ district: 'Başka İlçe' }) }), /out_of_area/)
  assert.match(await placeError('delivery', { p_address: address({ street: 'kısa' }) }), /invalid_address/)
  assert.match(await placeError('delivery', { p_address: address({ postal_code: 'abc' }) }), /invalid_address/)
  assert.match(await placeError('delivery', { p_customer: JSON.stringify({ name: 'A', phone: '05550000002' }) }), /invalid_name/)
  assert.match(await placeError('pickup', { p_customer: JSON.stringify({ name: 'Deneme', phone: '123' }) }), /invalid_phone/)
  assert.equal((await rpc(db, ANON, 'check_delivery_address', { p_postal_code: '99001', p_district: 'ÖRNEK merkez' })).in_area, true, 'Türkçe harf ve büyük/küçük duyarsız')
})

test('kurye: asgari tutarın altı reddedilir ve yarım sipariş kalmaz', async () => {
  const before = (await db.query('select count(*)::int n from public.orders')).rows[0].n
  const small = JSON.stringify([{ menu_item_id: item.id, quantity: 1 }])
  const needed = Math.ceil(25000 / unit)
  if (needed > 1) {
    assert.match(await placeError('delivery', { p_items: small, p_address: address({ postal_code: '99010', district: 'Herhangi' }) }), /below_minimum/)
    assert.equal((await db.query('select count(*)::int n from public.orders')).rows[0].n, before)
  }
})

test('tekrar gönderim: aynı anahtar tek sipariş üretir, başka kanalla reddedilir', async () => {
  const key = randomUUID(), args = { p_idempotency_key: key, p_customer: customer() }
  const first = await place('pickup', args)
  const again = await place('pickup', args)
  assert.equal(again.order_id, first.order_id)
  assert.equal(again.duplicate, true)
  assert.equal(again.tracking_token, first.tracking_token)
  assert.match(await placeError('delivery', { p_idempotency_key: key }), /idempotency_key_conflict/)
})

test('telefon başına hız sınırı', async () => {
  const phone = JSON.stringify({ name: 'Deneme', phone: '05559999999' })
  for (let i = 0; i < 5; i++) await place('pickup', { p_customer: phone })
  assert.match(await placeError('pickup', { p_customer: phone }), /rate_limited/)
})

test('takip: kodla durum okunur, kişisel veri dönmez; geçersiz kod reddedilir', async () => {
  const order = await place('delivery', { p_customer: JSON.stringify({ name: 'Gizli Ad', phone: '05551112233' }), p_address: address({ street: 'Gizli Cadde 12' }) })
  const tracking = await rpc(db, ANON, 'get_order_tracking', { p_tracking_token: order.tracking_token })
  assert.equal(tracking.kitchen_status, 'new')
  assert.equal(tracking.fulfillment_status, 'pending')
  const raw = JSON.stringify(tracking)
  assert.ok(!raw.includes('Gizli') && !raw.includes('05551112233'), 'kişisel veri sızdı')
  assert.match(await rpcError(db, ANON, 'get_order_tracking', { p_tracking_token: 'a'.repeat(64) }), /invalid_tracking/)
  assert.match(await rpcError(db, ANON, 'get_order_tracking', { p_tracking_token: order.order_id }), /invalid_tracking/)
})

test('yetki: anonim, garson ve mutfak müşteri bilgisini okuyamaz; kasiyer okur', async () => {
  const order = await place('delivery')
  await assert.rejects(as(db, ANON, tx => tx.query('select * from public.order_fulfillments')), /permission denied/)
  await assert.rejects(as(db, ANON, tx => tx.query('select * from public.delivery_zones')), /permission denied/)
  for (const user of [waiter, kitchen]) {
    const { rows } = await as(db, user, tx => tx.query('select * from public.order_fulfillments'))
    assert.deepEqual(rows, [])
    assert.equal((await as(db, user, tx => tx.query('select id from public.orders where id = $1', [order.order_id]))).rows.length, 1, 'sipariş görünür')
  }
  const { rows } = await as(db, cashier, tx => tx.query('select street from public.order_fulfillments where order_id = $1', [order.order_id]))
  assert.equal(rows[0].street, 'Kurgusal Cadde No 1')
})

test('akış: mutfak ve teslimat durumu ayrıdır; kurye personelle işlenir, mutfak Servis yapamaz', async () => {
  const order = await place('delivery')
  const id = order.order_id
  const fulfillment = async () => (await db.query('select status, courier_name, payment_status from public.order_fulfillments where order_id = $1', [id])).rows[0]
  assert.match(await rpcError(db, cashier, 'update_fulfillment_status', { p_order_id: id, p_status: 'handed_to_courier', p_courier_name: 'Ali' }), /invalid_transition/)
  await rpc(db, kitchen, 'update_order_status', { p_order_id: id, p_status: 'preparing' })
  await rpc(db, kitchen, 'update_order_status', { p_order_id: id, p_status: 'ready' })
  assert.equal((await fulfillment()).status, 'awaiting_handoff')
  assert.match(await rpcError(db, kitchen, 'update_order_status', { p_order_id: id, p_status: 'served' }), /invalid_transition/)
  assert.match(await rpcError(db, kitchen, 'update_fulfillment_status', { p_order_id: id, p_status: 'handed_to_courier', p_courier_name: 'Ali' }), /forbidden/)
  assert.match(await rpcError(db, waiter, 'update_fulfillment_status', { p_order_id: id, p_status: 'handed_to_courier', p_courier_name: 'Ali' }), /forbidden/)
  assert.match(await rpcError(db, cashier, 'update_fulfillment_status', { p_order_id: id, p_status: 'handed_to_courier' }), /courier_required/)
  await rpc(db, cashier, 'assign_order_courier', { p_order_id: id, p_courier_name: 'Kurgusal Kurye' })
  assert.equal((await fulfillment()).status, 'awaiting_handoff', 'atama sevk değildir')
  await rpc(db, cashier, 'update_fulfillment_status', { p_order_id: id, p_status: 'handed_to_courier' })
  assert.equal((await db.query('select status from public.orders where id = $1', [id])).rows[0].status, 'served')
  assert.match(await rpcError(db, cashier, 'update_fulfillment_status', { p_order_id: id, p_status: 'collected' }), /invalid_transition/)
  await rpc(db, cashier, 'update_fulfillment_status', { p_order_id: id, p_status: 'delivered' })
  assert.equal((await rpc(db, cashier, 'update_fulfillment_status', { p_order_id: id, p_status: 'delivered' })).duplicate, true)
  assert.equal((await fulfillment()).courier_name, 'Kurgusal Kurye')
})

test('ödeme: yöntem seçmek ödeme değildir; yalnızca personel işler, tekrar işlenmez', async () => {
  const order = await place('pickup')
  const status = async () => (await rpc(db, ANON, 'get_order_tracking', { p_tracking_token: order.tracking_token })).payment_status
  assert.equal(await status(), 'unpaid')
  assert.match(await rpcError(db, kitchen, 'record_fulfillment_payment', { p_order_id: order.order_id, p_method: 'cash' }), /forbidden/)
  assert.match(await rpcError(db, ANON, 'record_fulfillment_payment', { p_order_id: order.order_id, p_method: 'cash' }), /permission denied/)
  assert.equal((await rpc(db, cashier, 'record_fulfillment_payment', { p_order_id: order.order_id, p_method: 'cash' })).duplicate, false)
  assert.equal((await rpc(db, cashier, 'record_fulfillment_payment', { p_order_id: order.order_id, p_method: 'card' })).duplicate, true)
  assert.equal(await status(), 'paid')
})

test('iptal: garson paket siparişini iptal edemez; kasiyer yeni siparişi iptal eder, hazırlanan için yönetici', async () => {
  const order = await place('pickup')
  assert.match(await rpcError(db, waiter, 'update_order_status', { p_order_id: order.order_id, p_status: 'cancelled' }), /forbidden/)
  await rpc(db, cashier, 'update_order_status', { p_order_id: order.order_id, p_status: 'cancelled' })
  assert.equal((await db.query('select status from public.order_fulfillments where order_id = $1', [order.order_id])).rows[0].status, 'cancelled')
  const preparing = await place('pickup')
  await rpc(db, kitchen, 'update_order_status', { p_order_id: preparing.order_id, p_status: 'preparing' })
  assert.match(await rpcError(db, cashier, 'update_order_status', { p_order_id: preparing.order_id, p_status: 'cancelled', p_reason: 'x' }), /forbidden/)
  assert.match(await rpcError(db, admin, 'update_order_status', { p_order_id: preparing.order_id, p_status: 'cancelled' }), /reason_required/)
  await rpc(db, admin, 'update_order_status', { p_order_id: preparing.order_id, p_status: 'cancelled', p_reason: 'test' })
})

test('masa siparişi korunur: adisyon, servis ve kapatma aynı çalışır', async () => {
  const table = await addTable(db, 'Masa Çok Kanal')
  const order = await rpc(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: items() })
  const { rows: [row] } = await db.query('select fulfillment_type, bill_id from public.orders where id = $1', [order.order_id])
  assert.equal(row.fulfillment_type, 'dine_in')
  assert.ok(row.bill_id)
  for (const status of ['preparing', 'ready']) await rpc(db, kitchen, 'update_order_status', { p_order_id: order.order_id, p_status: status })
  await rpc(db, waiter, 'update_order_status', { p_order_id: order.order_id, p_status: 'served' })
  assert.match(await rpcError(db, cashier, 'update_fulfillment_status', { p_order_id: order.order_id, p_status: 'collected' }), /order_not_found/)
  await assert.rejects(db.query("insert into public.orders(idempotency_key, fulfillment_type, source) values ($1, 'dine_in', 'qr')", [randomUUID()]), /orders_table_matches_fulfillment/)
  await assert.rejects(db.query("update public.orders set fulfillment_type = 'pickup' where id = $1", [order.order_id]), /orders_table_matches_fulfillment/)
})

test('migration tekrar çalıştırılabilir, DROP içermez, veriyi ve ayarları korur', async () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261101090000_pos_multichannel.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql.replace(/--.*$/gm, '').replace(/drop not null/gi, ''), /\b(drop|truncate)\b|delete from/i)
  const before = (await db.query('select count(*)::int n from public.orders')).rows[0].n
  await db.exec(sql)
  assert.equal((await db.query('select count(*)::int n from public.orders')).rows[0].n, before)
  assert.equal((await rpc(db, ANON, 'get_ordering_config', {})).pickup, true)
})
