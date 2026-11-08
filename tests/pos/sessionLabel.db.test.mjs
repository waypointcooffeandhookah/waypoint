// Geçici adisyon adı (20261108090000_pos_session_label.sql)
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createDb, createUser, rpc, rpcError, as, addTable, menuItem, ANON, qrVisit } from './db-harness.mjs'

const db = await createDb()
const admin = await createUser(db, { role: 'admin', name: 'Yönetici' })
const waiter = await createUser(db, { staffRole: 'waiter', name: 'Garson' })
const kitchen = await createUser(db, { staffRole: 'kitchen', name: 'Mutfak' })
const { rows: [first] } = await db.query('select name from public.menu_items where price > 0 and is_available limit 1')
const item = await menuItem(db, first.name)
const label = (user, tableId, text) => rpc(db, user, 'set_table_session_label', { p_table_id: tableId, p_label: text })
const openSession = async tableId => (await db.query("select id, guest_label from public.table_sessions where table_id = $1 and status = 'open'", [tableId])).rows[0]

test('garson boş masaya ad verir: oturum açılır, ad temizlenir; mutfak ve müşteri ad veremez', async () => {
  const table = await addTable(db, 'Ad Masası 1')
  const result = await label(waiter, table.id, '  Ahmet\tBey  ')
  assert.equal(result.guest_label, 'Ahmet Bey')
  assert.equal((await openSession(table.id)).guest_label, 'Ahmet Bey')
  assert.match(await rpcError(db, kitchen, 'set_table_session_label', { p_table_id: table.id, p_label: 'X' }), /forbidden/)
  assert.match(await rpcError(db, ANON, 'set_table_session_label', { p_table_id: table.id, p_label: 'X' }), /permission denied|forbidden/)
  assert.match(await rpcError(db, waiter, 'set_table_session_label', { p_table_id: table.id, p_label: 'x'.repeat(41) }), /invalid_label/)
})

test('ad değiştirilir/kaldırılır; boş masada boş ad oturum açmaz', async () => {
  const table = await addTable(db, 'Ad Masası 2')
  assert.deepEqual(await label(waiter, table.id, '   '), { session_id: null, guest_label: null })
  assert.equal(await openSession(table.id), undefined, 'boş ad oturum açmadı')
  await label(waiter, table.id, 'Doğum günü')
  await label(waiter, table.id, 'Doğum günü 🎂')
  assert.equal((await openSession(table.id)).guest_label, 'Doğum günü 🎂')
  await label(waiter, table.id, '')
  assert.equal((await openSession(table.id)).guest_label, null)
})

test('sipariş aynı oturuma düşer; hesap kapanınca ad silinir; mutfak adı görür, müşteri göremez', async () => {
  const table = await addTable(db, 'Ad Masası 3')
  const { session_id } = await label(waiter, table.id, 'Loca - Selin')
  const order = await rpc(db, ANON, 'place_qr_order', { p_table_token: await qrVisit(db, table.token), p_idempotency_key: randomUUID(), p_items: JSON.stringify([{ menu_item_id: item.id, quantity: 1 }]) })
  const { rows: [placed] } = await db.query('select session_id from public.orders where id = $1', [order.order_id])
  assert.equal(placed.session_id, session_id, 'QR siparişi adlandırılmış oturuma eklendi')
  const seen = await as(db, kitchen, tx => tx.query('select o.id, s.guest_label from public.orders o join public.table_sessions s on s.id = o.session_id where o.id = $1', [order.order_id]))
  assert.equal(seen.rows[0].guest_label, 'Loca - Selin')
  const anonSeen = await as(db, null, tx => tx.query('select guest_label from public.table_sessions').then(r => r.rows.length, e => e.message))
  assert.ok(anonSeen === 0 || /permission denied/.test(anonSeen), 'müşteri oturum adını göremez')
  await rpc(db, admin, 'close_table_session', { p_session_id: session_id, p_force: true })
  const { rows: [closed] } = await db.query('select status, guest_label from public.table_sessions where id = $1', [session_id])
  assert.deepEqual(closed, { status: 'closed', guest_label: null })
})

test('migration tekrar çalıştırılabilir, DROP içermez', async () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261108090000_pos_session_label.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\bdrop\b|delete from|truncate/i)
  await db.exec(sql)
  await db.exec(sql)
})
