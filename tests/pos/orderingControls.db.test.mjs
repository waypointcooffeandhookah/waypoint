import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createDb, createUser, rpc, rpcError, as, addTable, menuItem, ANON } from './db-harness.mjs'

const db = await createDb()
await db.exec(readFileSync(new URL('../../supabase/staging/04_multichannel_seed.sql', import.meta.url), 'utf8'))
const admin = await createUser(db, { role: 'admin', name: 'Yönetici' })
const manager = await createUser(db, { staffRole: 'manager', name: 'Müdür' })
const cashier = await createUser(db, { staffRole: 'cashier', name: 'Kasa' })
const waiter = await createUser(db, { staffRole: 'waiter', name: 'Garson' })
const kitchen = await createUser(db, { staffRole: 'kitchen', name: 'Mutfak' })
const { rows: [firstItem] } = await db.query('select name from public.menu_items where price > 0 and is_available limit 1')
const item = await menuItem(db, firstItem.name)
const items = JSON.stringify([{ menu_item_id: item.id, quantity: 20 }])
const table = await addTable(db, 'Ayar Masası')
let phone = 0
const customer = () => JSON.stringify({ name: 'Deneme Kişi', phone: `0544${String(++phone).padStart(7, '0')}` })
const base = { dine_in_enabled: true, pickup_enabled: true, delivery_enabled: true, accepting_orders: true, auto_open_order_type: true, hours_enabled: false, operating_hours: {} }
const save = (settings, user = admin) => rpc(db, user, 'update_ordering_settings', { p_settings: JSON.stringify({ ...base, ...settings }) })
const placeQr = (key = randomUUID()) => rpc(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: key, p_items: items })
const placeOnline = (type = 'pickup', key = randomUUID()) => rpc(db, ANON, 'place_online_order', { p_fulfillment_type: type, p_idempotency_key: key, p_items: items, p_customer: customer(), p_address: type === 'delivery' ? JSON.stringify({ street: 'Kurgusal Cadde 1', district: 'Deneme', postal_code: '99001' }) : null })
const qrError = () => rpcError(db, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: items })
const onlineError = type => rpcError(db, ANON, 'place_online_order', { p_fulfillment_type: type, p_idempotency_key: randomUUID(), p_items: items, p_customer: customer(), p_address: type === 'delivery' ? JSON.stringify({ street: 'Kurgusal Cadde 1', district: 'Deneme', postal_code: '99001' }) : null })
const config = () => rpc(db, ANON, 'get_ordering_config', {})
const hoursAround = (openOffset, closeOffset) => {
  // Her gün aynı aralık: test gece yarısına yakın çalışsa da sonuç değişmez.
  const { fmt } = currentLocal(openOffset, closeOffset)
  return Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), fmt]))
}
function currentLocal(openOffset, closeOffset) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }))
  const at = minutes => { const d = new Date(now.getTime() + minutes * 60000); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  return { day: String(now.getDay()), fmt: { open: at(openOffset), close: at(closeOffset) } }
}

test('varsayılan: masa açık, sipariş alımı açık, saat sınırı yok; yeni kolonlar davranışı değiştirmez', async () => {
  const value = await config()
  assert.equal(value.dine_in, true)
  assert.equal(value.pickup, true)
  assert.equal(value.delivery, true)
  assert.equal(value.auto_open, true)
  assert.equal(value.blocked, null)
  assert.ok((await placeQr()).order_id)
  assert.ok((await placeOnline()).order_id)
})

test('yetki: ayarı yalnızca yönetici değiştirir; doğrudan güncelleme kapalıdır', async () => {
  for (const user of [manager, cashier, waiter, kitchen]) assert.match(await rpcError(db, user, 'update_ordering_settings', { p_settings: JSON.stringify(base) }), /forbidden/)
  assert.match(await rpcError(db, ANON, 'update_ordering_settings', { p_settings: JSON.stringify(base) }), /permission denied/)
  for (const user of [admin, manager, waiter]) {
    await assert.rejects(as(db, user, tx => tx.query('update public.fulfillment_settings set accepting_orders = false')), /permission denied/)
  }
  await assert.rejects(as(db, ANON, tx => tx.query('select * from public.fulfillment_settings')), /permission denied/)
  assert.equal((await as(db, waiter, tx => tx.query('select * from public.fulfillment_settings'))).rows.length, 0)
  assert.equal((await as(db, admin, tx => tx.query('select * from public.fulfillment_settings'))).rows.length, 1)
})

test('sunucu uygular: kapalı kanal için doğrudan istek de reddedilir', async () => {
  await save({ dine_in_enabled: false })
  assert.match(await qrError(), /channel_closed/)
  assert.match(await rpcError(db, ANON, 'get_qr_table', { p_table_token: table.token }), /channel_closed/)
  assert.equal((await config()).dine_in, false)
  await save({ pickup_enabled: false })
  assert.match(await onlineError('pickup'), /channel_closed/)
  assert.equal((await config()).pickup, false)
  await save({ delivery_enabled: false })
  assert.match(await onlineError('delivery'), /channel_closed/)
  assert.equal((await config()).delivery, false)
  await save({})
})

test('sipariş alımı kapalı: müşteri kanalları durur; garson siparişi sürer, geçmiş sipariş tekrarı döner', async () => {
  const key = randomUUID(), qrKey = randomUUID()
  const earlier = await placeOnline('pickup', key)
  const earlierQr = await placeQr(qrKey)
  await save({ accepting_orders: false })
  assert.match(await qrError(), /ordering_closed/)
  assert.match(await onlineError('pickup'), /ordering_closed/)
  assert.match(await onlineError('delivery'), /ordering_closed/)
  const value = await config()
  assert.deepEqual([value.pickup, value.delivery, value.dine_in, value.blocked], [false, false, false, 'ordering_closed'])
  // Kanal ayarları alımdan bağımsız bildirilir: arayüz sipariş türlerini ve sepeti gösterir, gönderim kapalı kalır.
  assert.deepEqual(value.channels, { pickup: true, delivery: true, dine_in: true })
  assert.equal(value.accepting, false)
  assert.deepEqual(await rpc(db, ANON, 'get_qr_table', { p_table_token: table.token }), { table_label: 'Ayar Masası', blocked: 'ordering_closed' })
  assert.equal((await placeOnline('pickup', key)).order_id, earlier.order_id, 'yanıtı kaybolan sipariş doğrulanabilmeli')
  assert.equal((await placeQr(qrKey)).order_id, earlierQr.order_id)
  const staff = await rpc(db, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items })
  assert.equal(staff.source, 'waiter')
  await save({})
})

test('çalışma saatleri: açık aralıkta sipariş alınır, dışında reddedilir; gece yarısını aşan aralık çalışır', async () => {
  await save({ hours_enabled: true, operating_hours: hoursAround(-60, 60) })
  assert.equal((await config()).blocked, null)
  assert.ok((await placeOnline()).order_id)
  await save({ hours_enabled: true, operating_hours: hoursAround(60, 120) })
  assert.equal((await config()).blocked, 'outside_hours')
  assert.match(await onlineError('pickup'), /outside_hours/)
  assert.match(await qrError(), /outside_hours/)
  await save({ hours_enabled: true, operating_hours: hoursAround(-30, -60) })
  assert.equal((await config()).blocked, null, 'kapanış açılıştan küçükse ertesi güne sarkar')
  const { day } = currentLocal(0, 0)
  const other = String((Number(day) + 3) % 7)
  await save({ hours_enabled: true, operating_hours: { [other]: { open: '00:00', close: '23:59' } } })
  assert.equal((await config()).blocked, 'outside_hours', 'tanımsız gün kapalıdır')
  await save({})
})

test('ayar doğrulama: bozuk değerler reddedilir, kayıt değişmez; değişiklik denetime yazılır', async () => {
  const bad = settings => rpcError(db, admin, 'update_ordering_settings', { p_settings: JSON.stringify({ ...base, ...settings }) })
  assert.match(await bad({ accepting_orders: 'evet' }), /invalid_settings/)
  assert.match(await bad({ operating_hours: { 9: { open: '09:00', close: '10:00' } } }), /invalid_hours/)
  assert.match(await bad({ operating_hours: { 1: { open: '25:00', close: '10:00' } } }), /invalid_hours/)
  assert.match(await bad({ operating_hours: { 1: { open: '10:00', close: '10:00' } } }), /invalid_hours/)
  assert.match(await bad({ hours_enabled: true, operating_hours: {} }), /invalid_hours/)
  assert.equal((await config()).pickup, true)
  await save({ auto_open_order_type: false })
  assert.equal((await config()).auto_open, false)
  const { rows } = await db.query("select count(*)::int n from public.audit_log where action = 'settings.ordering'")
  assert.ok(rows[0].n > 0)
  await save({})
})

test('bölge: yalnızca yönetici yazar, posta kodu biçimi sunucuda denetlenir; garson değiştiremez', async () => {
  const zone = "insert into public.delivery_zones(name, postal_codes, fee_cents) values ('Yeni', array['99100'], 100) returning id"
  const { rows: [created] } = await as(db, admin, tx => tx.query(zone))
  assert.ok(created.id)
  await assert.rejects(as(db, admin, tx => tx.query("insert into public.delivery_zones(name, postal_codes, fee_cents) values ('Kötü', array['12'], 100)")), /delivery_zones_postal_format/)
  await assert.rejects(as(db, waiter, tx => tx.query(zone)), /row-level security/)
  await assert.rejects(as(db, kitchen, tx => tx.query(zone)), /row-level security/)
  const { rows } = await as(db, waiter, tx => tx.query('update public.delivery_zones set fee_cents = 0 returning id'))
  assert.deepEqual(rows, [])
  await assert.rejects(as(db, admin, tx => tx.query('delete from public.delivery_zones')), /permission denied/)
})

test('migration tekrar çalıştırılabilir, DROP içermez, ayarları korur', async () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261101120000_pos_ordering_controls.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(drop|truncate)\b|delete from/i)
  await save({ accepting_orders: false })
  await db.exec(sql)
  assert.equal((await config()).blocked, 'ordering_closed')
  // Sonraki migration okuma RPC'lerini yeniler; gerçek sıradaki gibi yeniden uygulanır.
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261102120000_pos_ordering_config_channels.sql', import.meta.url), 'utf8'))
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261102150000_pos_ordering_window.sql', import.meta.url), 'utf8'))
  await save({})
})

test('alım kapalıyken kanal ayrımı: yöneticinin kapattığı kanal açık görünmez; gönderim her kanalda sunucuda reddedilir', async () => {
  await save({ accepting_orders: false, pickup_enabled: false })
  let value = await config()
  assert.deepEqual(value.channels, { pickup: false, delivery: true, dine_in: true }, 'kapalı paket kanalı açılmamalı')
  assert.deepEqual([value.pickup, value.delivery, value.dine_in, value.accepting], [false, false, false, false])
  assert.match(await onlineError('pickup'), /ordering_closed|channel_closed/)
  assert.match(await onlineError('delivery'), /ordering_closed/)
  assert.match(await qrError(), /ordering_closed/)
  await save({ accepting_orders: false, dine_in_enabled: false })
  assert.equal((await config()).channels.dine_in, false)
  assert.match(await rpcError(db, ANON, 'get_qr_table', { p_table_token: table.token }), /channel_closed/, 'kapalı masa kanalı masa doğrulamasıyla açılmaz')
  assert.match(await rpcError(db, ANON, 'get_qr_table', { p_table_token: 'f'.repeat(64) }), /invalid_table/)
  await save({ accepting_orders: false })
  assert.match(await rpcError(db, ANON, 'get_qr_table', { p_table_token: 'f'.repeat(64) }), /invalid_table/, 'alım kapalıyken de geçersiz kod reddedilir')
  await save({ hours_enabled: true, operating_hours: hoursAround(60, 120) })
  value = await config()
  assert.deepEqual([value.blocked, value.accepting, value.channels.pickup], ['outside_hours', false, true])
  assert.equal((await rpc(db, ANON, 'get_qr_table', { p_table_token: table.token })).blocked, 'outside_hours')
  await save({})
  value = await config()
  assert.deepEqual([value.pickup, value.accepting, value.blocked], [true, true, null])
  assert.deepEqual(await rpc(db, ANON, 'get_qr_table', { p_table_token: table.token }), { table_label: 'Ayar Masası' })
})

test('kanal migration: tekrar çalıştırılabilir, DROP içermez, gönderim RPC tanımlarına dokunmaz', async () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261102120000_pos_ordering_config_channels.sql', import.meta.url), 'utf8')
  const code = sql.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\b(drop|truncate|update|insert)\b|delete from/i)
  assert.doesNotMatch(code, /place_qr_order|place_online_order|place_staff_order/)
  await save({ accepting_orders: false })
  await db.exec(sql)
  assert.equal((await config()).blocked, 'ordering_closed')
  assert.match(await qrError(), /ordering_closed/)
  await save({})
})
