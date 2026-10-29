import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDb, createUser, rpc, rpcError, as, addTable, menuItem, readMigration, ANON } from './db-harness.mjs'

let db, admin, waiter, kitchen, cashier, outsider, kofte, kunefe, corba
before(async () => {
  db = await createDb()
  admin = await createUser(db, { role: 'admin' })
  waiter = await createUser(db, { staffRole: 'waiter', name: 'Garson' })
  kitchen = await createUser(db, { staffRole: 'kitchen', name: 'Mutfak' })
  cashier = await createUser(db, { staffRole: 'cashier', name: 'Kasa' })
  outsider = await createUser(db)
  kofte = await menuItem(db, 'Izgara Köfte')
  kunefe = await menuItem(db, 'Künefe')
  corba = await menuItem(db, 'Mercimek Çorbası')
})

const items = (...lines) => JSON.stringify(lines.map(([item, quantity, note]) => ({ menu_item_id: item.id, quantity, note })))
const bill = async tableId => (await db.query(
  `select bs.* from public.bill_summaries bs join public.table_sessions s on s.id = bs.session_id
   where s.table_id = $1 and s.status = 'open'`, [tableId])).rows

test('garson siparişi oluşur, mutfak görür ve masa adisyonu otomatik güncellenir', async () => {
  const table = await addTable(db, 'Masa 5')
  const order = await rpc(db, waiter, 'place_staff_order', {
    p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items([kofte, 2, 'az pişmiş']),
  })
  assert.equal(order.source, 'waiter')
  assert.equal(order.status, 'new')
  assert.equal(order.subtotal_cents, 44000)
  assert.equal(order.table_label, 'Masa 5')

  const seen = await as(db, kitchen, tx => tx.query(
    `select o.order_number, i.item_name, i.quantity, i.note from public.orders o
     join public.order_items i on i.order_id = o.id where o.id = $1`, [order.order_id]))
  assert.deepEqual(seen.rows.map(r => [r.item_name, r.quantity, r.note]), [['Izgara Köfte', 2, 'az pişmiş']])

  const [summary] = await bill(table.id)
  assert.equal(Number(summary.total_cents), 44000)
  assert.equal(summary.order_count, 1)
})

test('aynı masadan müşteri siparişi aynı mutfak akışına ve aynı adisyona düşer', async () => {
  const table = await addTable(db, 'Masa 6')
  await rpc(db, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items([corba, 1]) })
  const qr = await rpc(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: items([kunefe, 1]) })
  assert.equal(qr.source, 'qr')

  const { rows } = await as(db, kitchen, tx => tx.query('select source, bill_id from public.orders where table_id = $1', [table.id]))
  assert.deepEqual(rows.map(r => r.source).sort(), ['qr', 'waiter'])
  assert.equal(new Set(rows.map(r => r.bill_id)).size, 1)
  const [summary] = await bill(table.id)
  assert.equal(Number(summary.total_cents), 7500 + 14000)
})

test('dört müşteri aynı anda sipariş verir: dört ayrı sipariş, tek oturum, tek adisyon', async () => {
  const table = await addTable(db, 'Masa 7')
  const carts = [items([corba, 2]), items([kofte, 1]), items([kunefe, 1]), items([corba, 2])]
  const results = await Promise.all(carts.map(cart =>
    rpc(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: cart })))

  assert.equal(new Set(results.map(r => r.order_id)).size, 4)
  assert.equal(new Set(results.map(r => r.order_number)).size, 4)
  const sessions = await db.query('select count(*)::int as n from public.table_sessions where table_id = $1', [table.id])
  assert.equal(sessions.rows[0].n, 1)
  const [summary] = await bill(table.id)
  assert.equal(summary.order_count, 4)
  assert.equal(Number(summary.total_cents), 15000 + 22000 + 14000 + 15000)
})

test('çift tıklama / tekrar gönderim yalnızca bir sipariş oluşturur', async () => {
  const table = await addTable(db, 'Masa 8')
  const args = { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: items([kunefe, 1]) }
  const [a, b] = await Promise.all([rpc(db, ANON, 'place_qr_order', args), rpc(db, ANON, 'place_qr_order', args)])
  assert.equal(a.order_id, b.order_id)
  assert.deepEqual([a.duplicate, b.duplicate].sort(), [false, true])
  const retry = await rpc(db, ANON, 'place_qr_order', args)
  assert.equal(retry.order_id, a.order_id)
  const { rows } = await db.query('select count(*)::int as n from public.orders where table_id = $1', [table.id])
  assert.equal(rows[0].n, 1)
})

test('aynı anahtar başka masada kullanılamaz', async () => {
  const t1 = await addTable(db, 'Masa 9')
  const t2 = await addTable(db, 'Masa 10')
  const key = randomUUID()
  await rpc(db, ANON, 'place_qr_order', { p_table_token: t1.token, p_idempotency_key: key, p_items: items([corba, 1]) })
  assert.match(await rpcError(db, ANON, 'place_qr_order', { p_table_token: t2.token, p_idempotency_key: key, p_items: items([corba, 1]) }), /idempotency_key_conflict/)
})

test('bağlantı koptuktan sonra müşteri siparişini anahtarıyla doğrular', async () => {
  const table = await addTable(db, 'Masa 11')
  const key = randomUUID()
  assert.deepEqual(await rpc(db, ANON, 'get_qr_orders', { p_table_token: table.token, p_idempotency_keys: [key] }), [])
  await rpc(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: key, p_items: items([kofte, 1, 'soğansız']) })
  const [found] = await rpc(db, ANON, 'get_qr_orders', { p_table_token: table.token, p_idempotency_keys: [key, randomUUID()] })
  assert.equal(found.idempotency_key, key)
  assert.deepEqual(found.items, [{ name: 'Izgara Köfte', quantity: 1, line_total_cents: 22000, note: 'soğansız' }])
  const staffView = await rpc(db, waiter, 'get_order_by_idempotency_key', { p_idempotency_key: key })
  assert.equal(staffView.order_id, found.order_id)
})

test('tarayıcıdan gelen fiyat, toplam ve masa bilgisi yok sayılır', async () => {
  const table = await addTable(db, 'Masa 12')
  const tampered = JSON.stringify([{ menu_item_id: kofte.id, quantity: 1, price: 1, unit_price_cents: 1, table_id: randomUUID() }])
  const order = await rpc(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: tampered })
  assert.equal(order.subtotal_cents, 22000)
  assert.equal(order.table_label, 'Masa 12')
})

test('geçersiz ürün, adet ve masa anahtarı reddedilir; hiçbir kayıt yarım kalmaz', async () => {
  const table = await addTable(db, 'Masa 13')
  const call = p_items => rpcError(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items })
  assert.match(await call(JSON.stringify([{ menu_item_id: randomUUID(), quantity: 1 }])), /item_unavailable/)
  assert.match(await call(JSON.stringify([{ menu_item_id: 'drop table', quantity: 1 }])), /invalid_line/)
  assert.match(await call(items([kofte, 0])), /invalid_quantity/)
  assert.match(await call(items([kofte, 21])), /invalid_quantity/)
  assert.match(await call(items([kofte, 1.5])), /invalid_line|invalid_quantity/)
  assert.match(await call('[]'), /empty_order/)
  assert.match(await rpcError(db, ANON, 'place_qr_order', { p_table_token: 'a'.repeat(64), p_idempotency_key: randomUUID(), p_items: items([kofte, 1]) }), /invalid_table/)

  await db.query('update public.menu_items set is_available = false where id = $1', [kunefe.id])
  assert.match(await call(items([corba, 1], [kunefe, 1])), /item_unavailable/)
  await db.query('update public.menu_items set is_available = true where id = $1', [kunefe.id])

  const { rows } = await db.query('select count(*)::int as n from public.orders where table_id = $1', [table.id])
  assert.equal(rows[0].n, 0)
  const sessions = await db.query('select count(*)::int as n from public.table_sessions where table_id = $1', [table.id])
  assert.equal(sessions.rows[0].n, 0)
})

test('QR sipariş hız sınırı uygulanır', async () => {
  const table = await addTable(db, 'Masa 14')
  for (let i = 0; i < 12; i++) {
    await rpc(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: items([corba, 1]) })
  }
  assert.match(await rpcError(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: items([corba, 1]) }), /rate_limited/)
  // Garson siparişi müşteri hız sınırından etkilenmez.
  await rpc(db, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items([corba, 1]) })
})

test('yetkisiz kullanıcılar personel ve finans verisine erişemez', async () => {
  const table = await addTable(db, 'Masa 15')
  await rpc(db, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items([kofte, 1]) })

  for (const user of [ANON, outsider]) {
    for (const relation of ['orders', 'order_items', 'bills', 'payments', 'table_sessions', 'staff_profiles', 'table_qr_tokens', 'audit_log', 'bill_summaries']) {
      const count = await as(db, user, tx => tx.query(`select count(*)::int as n from public.${relation}`)).then(r => r.rows[0].n, () => 0)
      assert.equal(count, 0, `${user ? 'outsider' : 'anon'} ${relation} okuyabildi`)
    }
    assert.match(await rpcError(db, user, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items([kofte, 1]) }), /forbidden|permission denied/)
  }
  // Doğrudan yazma kapalı: sipariş yalnızca RPC ile oluşturulur.
  await assert.rejects(as(db, waiter, tx => tx.query(
    "insert into public.orders(idempotency_key, table_id, session_id, bill_id, source) select gen_random_uuid(), table_id, session_id, bill_id, 'waiter' from public.orders limit 1")), /permission denied/)
  await assert.rejects(as(db, waiter, tx => tx.query('update public.orders set subtotal_cents = 1')), /permission denied/)
  // Mutfak finans verisini, garson QR anahtarlarını göremez.
  assert.equal((await as(db, kitchen, tx => tx.query('select count(*)::int as n from public.bills'))).rows[0].n, 0)
  assert.equal((await as(db, waiter, tx => tx.query('select count(*)::int as n from public.table_qr_tokens'))).rows[0].n, 0)
  assert.ok((await as(db, admin, tx => tx.query('select count(*)::int as n from public.table_qr_tokens'))).rows[0].n > 0)
  // Pasif personel yetkisini kaybeder.
  await db.query('update public.staff_profiles set is_active = false where user_id = $1', [cashier.id])
  assert.equal((await as(db, cashier, tx => tx.query('select count(*)::int as n from public.orders'))).rows[0].n, 0)
  await db.query('update public.staff_profiles set is_active = true where user_id = $1', [cashier.id])
})

test('durum geçişleri rol kurallarına uyar ve geçmişe yazılır', async () => {
  const table = await addTable(db, 'Masa 16')
  const order = await rpc(db, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items([kofte, 1]) })
  const move = (user, p_status, p_reason = null) => rpc(db, user, 'update_order_status', { p_order_id: order.order_id, p_status, p_reason })
  const moveError = (user, p_status) => rpcError(db, user, 'update_order_status', { p_order_id: order.order_id, p_status })

  assert.match(await moveError(waiter, 'preparing'), /forbidden/)
  assert.match(await moveError(kitchen, 'served'), /invalid_transition/)
  assert.equal((await move(kitchen, 'preparing')).status, 'preparing')
  assert.match(await moveError(waiter, 'cancelled'), /forbidden/)
  assert.equal((await move(kitchen, 'ready')).status, 'ready')
  assert.equal((await move(waiter, 'served')).status, 'served')
  assert.match(await moveError(ANON, 'cancelled'), /forbidden|permission denied/)

  const { rows } = await db.query('select from_status, to_status from public.order_status_history where order_id = $1 order by id', [order.order_id])
  assert.deepEqual(rows.map(r => `${r.from_status}>${r.to_status}`), ['null>new', 'new>preparing', 'preparing>ready', 'ready>served'])
})

test('iptal edilen sipariş adisyondan düşer ve denetim kaydı oluşur', async () => {
  const table = await addTable(db, 'Masa 17')
  const keep = await rpc(db, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items([kofte, 1]) })
  const drop = await rpc(db, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items([kunefe, 2]) })
  assert.equal(Number((await bill(table.id))[0].total_cents), 22000 + 28000)

  assert.equal((await rpc(db, waiter, 'update_order_status', { p_order_id: drop.order_id, p_status: 'cancelled' })).status, 'cancelled')
  const [summary] = await bill(table.id)
  assert.equal(Number(summary.total_cents), 22000)
  assert.equal(summary.order_count, 1)
  const audit = await db.query("select actor from public.audit_log where action = 'order.cancel' and entity_id = $1", [drop.order_id])
  assert.equal(audit.rows[0].actor, waiter.id)

  // Hazırlanan siparişi yalnızca yönetici, gerekçe ile iptal edebilir.
  await rpc(db, kitchen, 'update_order_status', { p_order_id: keep.order_id, p_status: 'preparing' })
  assert.match(await rpcError(db, admin, 'update_order_status', { p_order_id: keep.order_id, p_status: 'cancelled' }), /reason_required/)
  await rpc(db, admin, 'update_order_status', { p_order_id: keep.order_id, p_status: 'cancelled', p_reason: 'müşteri vazgeçti' })
  assert.equal(Number((await bill(table.id))[0].total_cents), 0)
})

test('ödeme kaydı, fazla ödeme engeli ve masa kapatma', async () => {
  const table = await addTable(db, 'Masa 18')
  const order = await rpc(db, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items([kofte, 1], [corba, 2]) })
  const [{ bill_id, session_id }] = await bill(table.id)
  const pay = (amount, key = randomUUID(), method = 'cash') => rpc(db, cashier, 'record_payment', { p_bill_id: bill_id, p_amount_cents: amount, p_method: method, p_idempotency_key: key })

  assert.match(await rpcError(db, cashier, 'close_table_session', { p_session_id: session_id }), /orders_in_progress/)
  for (const status of ['preparing', 'ready', 'served']) {
    await rpc(db, status === 'served' ? waiter : kitchen, 'update_order_status', { p_order_id: order.order_id, p_status: status })
  }
  assert.match(await rpcError(db, cashier, 'close_table_session', { p_session_id: session_id }), /balance_due/)
  assert.match(await rpcError(db, kitchen, 'record_payment', { p_bill_id: bill_id, p_amount_cents: 100, p_method: 'cash', p_idempotency_key: randomUUID() }), /forbidden/)

  const key = randomUUID()
  assert.equal((await pay(20000, key)).balance_cents, 17000)
  assert.equal((await pay(20000, key)).duplicate, true)
  assert.match(await rpcError(db, cashier, 'record_payment', { p_bill_id: bill_id, p_amount_cents: 17001, p_method: 'card', p_idempotency_key: randomUUID() }), /overpayment/)
  assert.equal((await pay(17000, randomUUID(), 'card')).balance_cents, 0)

  await rpc(db, cashier, 'close_table_session', { p_session_id: session_id })
  assert.equal((await bill(table.id)).length, 0)
  assert.match(await rpcError(db, waiter, 'update_order_status', { p_order_id: order.order_id, p_status: 'cancelled' }), /bill_closed|invalid_transition|forbidden/)

  // Sonraki müşteri siparişi yeni oturum ve yeni adisyon açar.
  await rpc(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: items([corba, 1]) })
  const [next] = await bill(table.id)
  assert.notEqual(next.bill_id, bill_id)
  assert.equal(Number(next.total_cents), 7500)
})

test('zorla kapatma yalnızca yöneticiye açıktır; QR anahtarı yenilenince eskisi geçersizdir', async () => {
  const table = await addTable(db, 'Masa 19')
  await rpc(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: items([corba, 1]) })
  const [{ session_id }] = await bill(table.id)
  assert.match(await rpcError(db, waiter, 'close_table_session', { p_session_id: session_id, p_force: true }), /forbidden/)
  await rpc(db, admin, 'close_table_session', { p_session_id: session_id, p_force: true })
  assert.equal((await db.query("select count(*)::int as n from public.audit_log where action = 'session.force_close'")).rows[0].n, 1)

  assert.match(await rpcError(db, waiter, 'rotate_table_qr_token', { p_table_id: table.id }), /forbidden/)
  const fresh = await rpc(db, admin, 'rotate_table_qr_token', { p_table_id: table.id })
  assert.match(fresh, /^[0-9a-f]{64}$/)
  assert.match(await rpcError(db, ANON, 'get_qr_table', { p_table_token: table.token }), /invalid_table/)
  assert.deepEqual(await rpc(db, ANON, 'get_qr_table', { p_table_token: fresh }), { table_label: 'Masa 19' })
})

test('Supabase varsayılan yetkilerine rağmen anon personel fonksiyonlarını çalıştıramaz', async () => {
  for (const [name, args] of [
    ['place_staff_order', { p_table_id: randomUUID(), p_idempotency_key: randomUUID(), p_items: '[]' }],
    ['record_payment', { p_bill_id: randomUUID(), p_amount_cents: 1, p_method: 'cash', p_idempotency_key: randomUUID() }],
    ['upsert_staff_profile', { p_user_id: randomUUID(), p_display_name: 'x', p_role: 'admin' }],
  ]) {
    assert.match(await rpcError(db, ANON, name, args), /permission denied/)
  }
  await assert.rejects(as(db, ANON, tx => tx.query("select nextval('public.pos_order_number_seq')")), /permission denied/)
})

test('yönetici RLS üzerinden masa ekler ve QR anahtarı otomatik oluşur; garson ekleyemez', async () => {
  const manager = await createUser(db, { staffRole: 'manager', name: 'Müdür' })
  const { rows: [table] } = await as(db, manager, tx => tx.query("insert into public.restaurant_tables(label) values ('Bahçe 1') returning id"))
  const { rows } = await as(db, manager, tx => tx.query('select token from public.table_qr_tokens where table_id = $1', [table.id]))
  assert.match(rows[0].token, /^[0-9a-f]{64}$/)
  await assert.rejects(as(db, waiter, tx => tx.query("insert into public.restaurant_tables(label) values ('Bahçe 2')")), /row-level security/)
})

test('migration tekrar çalıştırılabilir ve veriyi korur', async () => {
  const before = (await db.query('select count(*)::int as n from public.orders')).rows[0].n
  await db.exec(readMigration())
  assert.equal((await db.query('select count(*)::int as n from public.orders')).rows[0].n, before)
  const table = await addTable(db, 'Masa 99')
  await rpc(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: items([corba, 1]) })
})

test('personel profili yalnızca yönetici tarafından atanır', async () => {
  const user = await createUser(db)
  assert.match(await rpcError(db, waiter, 'upsert_staff_profile', { p_user_id: user.id, p_display_name: 'X', p_role: 'admin' }), /forbidden/)
  await rpc(db, admin, 'upsert_staff_profile', { p_user_id: user.id, p_display_name: 'Yeni Garson', p_role: 'waiter' })
  const { rows } = await as(db, user, tx => tx.query('select role from public.staff_profiles'))
  assert.deepEqual(rows, [{ role: 'waiter' }])
})
