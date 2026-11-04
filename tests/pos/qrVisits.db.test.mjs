// Süreli masa bileti (20261105090000_pos_qr_visits.sql): masa kodu yalnızca bilet verir; sipariş biletle verilir.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDb, createUser, rpc, rpcError, as, addTable, menuItem, ANON, qrVisit } from './db-harness.mjs'

const db = await createDb()
const admin = await createUser(db, { role: 'admin', name: 'Yönetici' })
const { rows: [firstItem] } = await db.query('select name from public.menu_items where price > 0 and is_available limit 1')
const item = await menuItem(db, firstItem.name)
const items = JSON.stringify([{ menu_item_id: item.id, quantity: 1 }])
const start = token => rpc(db, ANON, 'start_qr_visit', { p_table_token: token })
const place = (visit, key = randomUUID()) => rpc(db, ANON, 'place_qr_order', { p_table_token: visit, p_idempotency_key: key, p_items: items })
const placeError = visit => rpcError(db, ANON, 'place_qr_order', { p_table_token: visit, p_idempotency_key: randomUUID(), p_items: items })
const openSession = async tableId => (await db.query("select id from public.table_sessions where table_id = $1 and status = 'open'", [tableId])).rows[0]?.id
const closeTable = async tableId => rpc(db, admin, 'close_table_session', { p_session_id: await openSession(tableId), p_force: true })

test('QR okutma: masa kodu 1 saatlik bilet verir; çıplak masa kodu ve uydurma bilet sipariş veremez', async () => {
  const table = await addTable(db, 'Bilet Masası 1')
  const before = Date.now()
  const started = await start(table.token)
  assert.match(started.visit, /^qv_[0-9a-f]{64}$/)
  assert.equal(started.table_label, 'Bilet Masası 1')
  assert.equal(started.table_key, table.id)
  const expires = Date.parse(started.expires_at)
  assert.ok(expires > before + 59 * 60000 && expires < Date.now() + 61 * 60000, 'süre 1 saat')

  assert.match(await placeError(table.token), /qr_visit_required/, 'basılı QR adresi doğrudan sipariş vermez')
  assert.match(await placeError(`qv_${'0'.repeat(64)}`), /qr_visit_invalid/)
  assert.match(await placeError('rastgele'), /qr_visit_invalid/)
  assert.match(await rpcError(db, ANON, 'start_qr_visit', { p_table_token: 'f'.repeat(64) }), /invalid_table/)
  assert.ok((await place(started.visit)).order_id)

  const { rows } = await db.query('select token_hash from pos_private.qr_visits where table_id = $1', [table.id])
  assert.ok(rows.length === 1 && rows[0].token_hash !== started.visit && !rows[0].token_hash.includes(started.visit.slice(3)), 'yalnızca özet saklanır')
  assert.match(await as(db, null, tx => tx.query('select * from pos_private.qr_visits').then(() => 'okundu', e => e.message)), /permission denied/)
})

test('sayfa yenileme süreyi uzatmaz; süre dolunca sipariş reddedilir ama verilen siparişin durumu görünür', async () => {
  const table = await addTable(db, 'Bilet Masası 2')
  const started = await start(table.token)
  const again = await rpc(db, ANON, 'get_qr_visit', { p_visit: started.visit })
  assert.equal(again.expires_at, started.expires_at, 'yenileme süreyi uzatmaz')
  assert.equal(again.table_label, 'Bilet Masası 2')

  const old = await qrVisit(db, table.token, { issuedAt: "now() - interval '61 minutes'" })
  assert.match(await rpcError(db, ANON, 'get_qr_visit', { p_visit: old }), /qr_visit_expired/)
  assert.match(await placeError(old), /qr_visit_expired/)

  // Süresi dolmadan verilen sipariş: bilet bitince de durum sorgulanır, aynı anahtarlı tekrar yeni sipariş açmaz.
  const key = randomUUID()
  const visit = await qrVisit(db, table.token)
  const first = await place(visit, key)
  await db.query("update pos_private.qr_visits set expires_at = now() - interval '1 second' where token_hash = pos_private.sha256_hex($1)", [visit])
  assert.match(await placeError(visit), /qr_visit_expired/)
  const retry = await place(visit, key)
  assert.equal(retry.order_id, first.order_id)
  assert.equal(retry.duplicate, true)
  const [seen] = await rpc(db, ANON, 'get_qr_orders', { p_table_token: visit, p_idempotency_keys: [key] })
  assert.equal(seen.order_id, first.order_id)
})

test('adisyon kapanınca bilet biter: ödeyip çıkan müşteri sayfa açık kalsa da sipariş veremez', async () => {
  const table = await addTable(db, 'Bilet Masası 3')
  const leaving = (await start(table.token)).visit
  const browsing = (await start(table.token)).visit // okuttu ama sipariş vermedi
  await place(leaving)
  await closeTable(table.id)
  assert.match(await placeError(leaving), /qr_visit_expired/, 'kapanan adisyonun bileti')
  assert.match(await placeError(browsing), /qr_visit_expired/, 'kapanıştan önce alınmış, sipariş vermemiş bilet')

  const next = (await start(table.token)).visit
  assert.ok((await place(next)).order_id, 'yeni müşteri QR okutup yeni adisyon açar')
  const other = (await start(table.token)).visit
  assert.ok((await place(other)).order_id, 'aynı masadaki ikinci kişi aynı adisyona ekler')
  assert.equal((await db.query("select count(*)::int n from public.table_sessions where table_id = $1 and status = 'open'", [table.id])).rows[0].n, 1)
})

test('masa kodu yenilenince veya masa kapatılınca eski biletler biter', async () => {
  const table = await addTable(db, 'Bilet Masası 4')
  const visit = (await start(table.token)).visit
  await rpc(db, admin, 'rotate_table_qr_token', { p_table_id: table.id })
  assert.match(await placeError(visit), /qr_visit_expired/)
  const { rows: [fresh] } = await db.query('select token from public.table_qr_tokens where table_id = $1', [table.id])
  const renewed = (await start(fresh.token)).visit
  assert.ok((await place(renewed)).order_id)
  await db.query('update public.restaurant_tables set is_active = false where id = $1', [table.id])
  assert.match(await placeError(renewed), /qr_visit_expired/)
})

test('alım kapalıyken bilet alınır (menü ve sepet açık), gönderim reddedilir; masa kanalı kapalıysa bilet verilmez', async () => {
  const table = await addTable(db, 'Bilet Masası 5')
  const base = { dine_in_enabled: true, pickup_enabled: true, delivery_enabled: true, accepting_orders: false, auto_open_order_type: true, hours_enabled: false, operating_hours: {} }
  await rpc(db, admin, 'update_ordering_settings', { p_settings: base })
  const started = await start(table.token)
  assert.equal(started.blocked, 'ordering_closed')
  assert.match(await placeError(started.visit), /ordering_closed/)
  await rpc(db, admin, 'update_ordering_settings', { p_settings: { ...base, dine_in_enabled: false } })
  assert.match(await rpcError(db, ANON, 'start_qr_visit', { p_table_token: table.token }), /channel_closed/)
  await rpc(db, admin, 'update_ordering_settings', { p_settings: { ...base, accepting_orders: true } })
  assert.equal((await rpc(db, ANON, 'get_qr_visit', { p_visit: started.visit })).blocked, undefined)
})

test('bilet alma masa başına hız sınırlıdır', async () => {
  const table = await addTable(db, 'Bilet Masası 6')
  await db.query(`insert into pos_private.qr_visits(token_hash, table_id, table_token_hash, expires_at)
    select md5(g::text), $1, 'x', now() + interval '1 hour' from generate_series(1, 60) g`, [table.id])
  assert.match(await rpcError(db, ANON, 'start_qr_visit', { p_table_token: table.token }), /rate_limited/)
})

test('geri alma betiği masa koduyla siparişe döner, veri kaybolmaz; migration tekrar uygulanabilir', async () => {
  const { readFileSync } = await import('node:fs')
  const { reapplyQrVisits } = await import('./db-harness.mjs')
  const table = await addTable(db, 'Bilet Masası 7')
  await place((await start(table.token)).visit)
  const count = async () => (await db.query('select count(*)::int n from public.orders')).rows[0].n
  const before = await count()
  await db.exec(readFileSync(new URL('../../supabase/staging/rollback_qr_visits.sql', import.meta.url), 'utf8'))
  assert.equal(await count(), before)
  assert.ok((await place(table.token)).order_id, 'geri almadan sonra masa kodu çalışır')
  await reapplyQrVisits(db)
  await reapplyQrVisits(db)
  assert.match(await placeError(table.token), /qr_visit_required/)
  assert.ok((await place((await start(table.token)).visit)).order_id)
})
