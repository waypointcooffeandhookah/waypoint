// Canlı veri kaynağının sorgu ve yetki varsayımlarını gerçek şemaya karşı doğrular (PGlite).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDb, createUser, rpc, as, addTable, menuItem } from './db-harness.mjs'

let db, waiter, kitchen, cashier, kofte
before(async () => {
  db = await createDb()
  waiter = await createUser(db, { staffRole: 'waiter', name: 'Garson' })
  kitchen = await createUser(db, { staffRole: 'kitchen', name: 'Mutfak' })
  cashier = await createUser(db, { staffRole: 'cashier', name: 'Kasa' })
  kofte = await menuItem(db, 'Izgara Köfte')
})

const place = (tableId, quantity) => rpc(db, waiter, 'place_staff_order', {
  p_table_id: tableId, p_idempotency_key: randomUUID(),
  p_items: JSON.stringify([{ menu_item_id: kofte.id, quantity, note: null }]),
})

test('mutfak hesabı masa etiketiyle siparişleri okur, adisyonu okuyamaz; garson adisyonu görür', async () => {
  const table = await addTable(db, 'Masa 5')
  const first = await place(table.id, 2)
  const second = await place(table.id, 1)
  assert.equal(first.bill_id ?? second.bill_id, second.bill_id)

  // liveBackend.listKitchenOrders sorgusunun SQL karşılığı
  const { rows } = await as(db, kitchen, tx => tx.query(
    `select o.order_number, o.status, t.label, json_agg(i.item_name) as items from public.orders o
     join public.restaurant_tables t on t.id = o.table_id join public.order_items i on i.order_id = o.id
     where o.status in ('new','preparing','ready') and o.table_id = $1 group by o.id, t.label order by o.created_at`, [table.id]))
  assert.deepEqual(rows.map(r => [r.label, r.status, r.items]), [['Masa 5', 'new', ['Izgara Köfte']], ['Masa 5', 'new', ['Izgara Köfte']]])

  const kitchenBills = await as(db, kitchen, tx => tx.query('select * from public.bill_summaries where table_id = $1', [table.id]))
  assert.equal(kitchenBills.rows.length, 0)
  const waiterBills = await as(db, waiter, tx => tx.query("select total_cents, order_count from public.bill_summaries where table_id = $1 and status = 'open'", [table.id]))
  assert.deepEqual([Number(waiterBills.rows[0].total_cents), waiterBills.rows[0].order_count], [66000, 2])
})

test('uç uca durum akışı: mutfak hazırlar, garson hazır siparişi görür ve servis eder; yetkisiz rol değiştiremez', async () => {
  const table = await addTable(db, 'Masa 6')
  const { order_id: id } = await place(table.id, 1)
  const move = (user, status) => rpc(db, user, 'update_order_status', { p_order_id: id, p_status: status })

  await assert.rejects(move(cashier, 'preparing'), /forbidden/)
  await assert.rejects(move(waiter, 'preparing'), /forbidden/)
  assert.equal((await move(kitchen, 'preparing')).status, 'preparing')
  assert.equal((await move(kitchen, 'ready')).status, 'ready')

  // liveBackend.listTables içindeki "hazır" sayımı garson yetkisiyle çalışır.
  const ready = await as(db, waiter, tx => tx.query("select table_id from public.orders where status = 'ready' and table_id = $1", [table.id]))
  assert.equal(ready.rows.length, 1)

  assert.equal((await move(waiter, 'served')).status, 'served')
  assert.equal((await move(waiter, 'served')).duplicate, true)
})
