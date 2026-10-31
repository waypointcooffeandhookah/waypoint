// Müşteri RPC'lerinin canlı istemcide kullanılan davranışı, gerçek şemaya karşı (PGlite).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDb, createUser, rpc, rpcError, as, addTable, menuItem, ANON } from './db-harness.mjs'

let db, waiter, kitchen, kofte
before(async () => {
  db = await createDb()
  waiter = await createUser(db, { staffRole: 'waiter', name: 'Garson' })
  kitchen = await createUser(db, { staffRole: 'kitchen', name: 'Mutfak' })
  kofte = await menuItem(db, 'Izgara Köfte')
})

const items = (quantity, extra = {}) => JSON.stringify([{ menu_item_id: kofte.id, quantity, note: null, ...extra }])
const place = (token, key = randomUUID(), quantity = 1, extra) => rpc(db, ANON, 'place_qr_order', { p_table_token: token, p_idempotency_key: key, p_items: items(quantity, extra) })

test('anonim müşteri masa kodu ile sipariş verir; mutfakta QR, adisyonda garsonla birlikte', async () => {
  const table = await addTable(db, 'Masa 5')
  assert.equal((await rpc(db, ANON, 'get_qr_table', { p_table_token: table.token })).table_label, 'Masa 5')

  const order = await place(table.token, randomUUID(), 2, { price: 1, unit_price_cents: 1 })
  assert.deepEqual([order.source, order.status, Number(order.subtotal_cents)], ['qr', 'new', 44000])
  await rpc(db, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items(1) })

  const seen = await as(db, kitchen, tx => tx.query('select source from public.orders where table_id = $1 order by created_at', [table.id]))
  assert.deepEqual(seen.rows.map(r => r.source).sort(), ['qr', 'waiter'])
  const bill = await as(db, waiter, tx => tx.query("select total_cents, order_count from public.bill_summaries where table_id = $1 and status = 'open'", [table.id]))
  assert.deepEqual([Number(bill.rows[0].total_cents), bill.rows[0].order_count], [66000, 2])
})

test('müşteri yalnızca kendi anahtarının ve masasının siparişini görür, tablolara doğrudan erişemez', async () => {
  const a = await addTable(db, 'Masa A'), b = await addTable(db, 'Masa B')
  const key = randomUUID(), other = randomUUID()
  await place(a.token, key)
  await place(a.token, other)

  const mine = await rpc(db, ANON, 'get_qr_orders', { p_table_token: a.token, p_idempotency_keys: [key] })
  assert.deepEqual(mine.map(o => o.idempotency_key), [key])
  assert.equal(mine[0].items[0].quantity, 1)
  assert.deepEqual(await rpc(db, ANON, 'get_qr_orders', { p_table_token: b.token, p_idempotency_keys: [key] }), [])
  await assert.rejects(as(db, ANON, tx => tx.query('select * from public.orders')), /permission denied/)

  assert.match(await rpcError(db, ANON, 'get_qr_table', { p_table_token: 'f'.repeat(64) }), /invalid_table/)
  assert.match(await rpcError(db, ANON, 'get_qr_table', { p_table_token: 'demo-5' }), /invalid_table/)
})

test('canlıda çift gönderim tek sipariş, kod yenilenince eski kod çalışmaz', async () => {
  const table = await addTable(db, 'Masa C')
  const key = randomUUID()
  const first = await place(table.token, key)
  const again = await place(table.token, key)
  assert.equal(first.order_id, again.order_id)
  assert.equal(again.duplicate, true)

  const admin = await createUser(db, { role: 'admin' })
  await rpc(db, admin, 'rotate_table_qr_token', { p_table_id: table.id })
  assert.match(await rpcError(db, ANON, 'get_qr_table', { p_table_token: table.token }), /invalid_table/)
})
