// Süreli sipariş alım penceresi: herkese açık staging sitesinde kontrollü test için.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createDb, createUser, rpc, rpcError, as, addTable, menuItem, ANON, qrVisit } from './db-harness.mjs'

const db = await createDb()
await db.exec(readFileSync(new URL('../../supabase/staging/04_multichannel_seed.sql', import.meta.url), 'utf8'))
const admin = await createUser(db, { role: 'admin', name: 'Yönetici' })
const manager = await createUser(db, { staffRole: 'manager', name: 'Müdür' })
const waiter = await createUser(db, { staffRole: 'waiter', name: 'Garson' })
const { rows: [firstItem] } = await db.query('select name from public.menu_items where price > 0 and is_available limit 1')
const item = await menuItem(db, firstItem.name)
const items = JSON.stringify([{ menu_item_id: item.id, quantity: 20 }])
const table = await addTable(db, 'Pencere Masası')
let phone = 0
const base = { dine_in_enabled: true, pickup_enabled: true, delivery_enabled: true, accepting_orders: true, auto_open_order_type: true, hours_enabled: false, operating_hours: {} }
const save = settings => rpc(db, admin, 'update_ordering_settings', { p_settings: JSON.stringify({ ...base, ...settings }) })
const config = () => rpc(db, ANON, 'get_ordering_config', {})
const qr = async () => rpc(db, ANON, 'place_qr_order', { p_table_token: await qrVisit(db, table.token), p_idempotency_key: randomUUID(), p_items: items })
const qrError = async () => rpcError(db, ANON, 'place_qr_order', { p_table_token: await qrVisit(db, table.token), p_idempotency_key: randomUUID(), p_items: items })
const online = type => ['place_online_order', { p_fulfillment_type: type, p_idempotency_key: randomUUID(), p_items: items,
  p_customer: JSON.stringify({ name: 'Pencere Test', phone: `0545${String(++phone).padStart(7, '0')}` }),
  p_address: type === 'delivery' ? JSON.stringify({ street: 'Kurgusal Cadde 1', district: 'Deneme', postal_code: '99001' }) : null }]
const settingsRow = async () => (await db.query('select accepting_orders, accepting_orders_until from public.fulfillment_settings where id = 1')).rows[0]
const expireWindow = () => db.query("update public.fulfillment_settings set accepting_orders_until = now() - interval '1 second' where id = 1")

test('kapalıyken pencere açılır: üç kanal sipariş alır; süre dolunca sunucu kendiliğinden reddeder', async () => {
  await save({ accepting_orders: false })
  assert.match(await qrError(), /ordering_closed/)
  const opened = await rpc(db, admin, 'open_ordering_window', { p_minutes: 10 })
  assert.equal(opened.accepting_orders, true)
  const until = Date.parse(opened.until)
  assert.ok(until > Date.now() + 9 * 60000 && until < Date.now() + 11 * 60000, 'bitiş ~10 dk sonra')
  assert.equal((await config()).accepting, true)
  assert.ok((await qr()).order_id)
  assert.ok((await rpc(db, ANON, ...online('pickup'))).order_id)
  assert.ok((await rpc(db, ANON, ...online('delivery'))).order_id)

  await expireWindow()
  const value = await config()
  assert.deepEqual([value.accepting, value.blocked, value.channels.pickup], [false, 'ordering_closed', true])
  assert.match(await qrError(), /ordering_closed/)
  assert.match(await rpcError(db, ANON, ...online('pickup')), /ordering_closed/)
  assert.match(await rpcError(db, ANON, ...online('delivery')), /ordering_closed/)
  assert.equal((await rpc(db, ANON, 'get_qr_table', { p_table_token: table.token })).blocked, 'ordering_closed')
  // Personel siparişi pencereden bağımsızdır.
  assert.ok((await rpc(db, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items })).order_id)
})

test('close_ordering_now: hemen kapatır ve pencereyi siler; denetim kaydı yazılır', async () => {
  await rpc(db, admin, 'open_ordering_window', { p_minutes: 30 })
  assert.equal((await config()).accepting, true)
  assert.deepEqual(await rpc(db, admin, 'close_ordering_now', {}), { accepting_orders: false })
  assert.deepEqual(await settingsRow(), { accepting_orders: false, accepting_orders_until: null })
  assert.match(await qrError(), /ordering_closed/)
  const { rows } = await db.query("select action, details from public.audit_log where action in ('settings.ordering_window', 'settings.ordering_close') order by id")
  assert.ok(rows.some(row => row.action === 'settings.ordering_window' && row.details.minutes === 30))
  assert.ok(rows.some(row => row.action === 'settings.ordering_close'))
})

test('yetki ve sınırlar: yalnızca yönetici; 1–120 dakika; doğrudan tablo yazımı kapalı', async () => {
  for (const user of [manager, waiter]) {
    assert.match(await rpcError(db, user, 'open_ordering_window', { p_minutes: 5 }), /forbidden/)
    assert.match(await rpcError(db, user, 'close_ordering_now', {}), /forbidden/)
  }
  assert.match(await rpcError(db, ANON, 'open_ordering_window', { p_minutes: 5 }), /permission denied/)
  assert.match(await rpcError(db, ANON, 'close_ordering_now', {}), /permission denied/)
  for (const minutes of [0, -5, 121, null]) assert.match(await rpcError(db, admin, 'open_ordering_window', { p_minutes: minutes }), /invalid_window/, String(minutes))
  await assert.rejects(as(db, admin, tx => tx.query("update public.fulfillment_settings set accepting_orders_until = now() + interval '1 day'")), /permission denied/)
  assert.equal((await settingsRow()).accepting_orders, false, 'reddedilen istekler alımı açmadı')
})

test('ayarlar ekranı: alımı süresiz açmak pencereyi siler (eski davranış); kapatmak da siler', async () => {
  await rpc(db, admin, 'open_ordering_window', { p_minutes: 5 })
  await save({ accepting_orders: false })
  assert.deepEqual(await settingsRow(), { accepting_orders: false, accepting_orders_until: null })
  await rpc(db, admin, 'open_ordering_window', { p_minutes: 5 })
  await expireWindow()
  assert.equal((await config()).accepting, false)
  await save({ accepting_orders: false })
  await save({ accepting_orders: true })
  assert.deepEqual(await settingsRow(), { accepting_orders: true, accepting_orders_until: null })
  assert.equal((await config()).accepting, true)
  // Kanal ayarı değiştirmek (alım değişmeden) pencereyi silmez.
  await save({ accepting_orders: false })
  const { until } = await rpc(db, admin, 'open_ordering_window', { p_minutes: 5 })
  await save({ pickup_enabled: false })
  assert.equal(Math.floor(new Date((await settingsRow()).accepting_orders_until).getTime() / 1000), Math.floor(Date.parse(until) / 1000))
  await rpc(db, admin, 'close_ordering_now', {})
})

test('migration tekrar çalıştırılabilir, DROP içermez, gönderim RPC tanımlarına dokunmaz', async () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261102150000_pos_ordering_window.sql', import.meta.url), 'utf8')
  const code = sql.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\b(drop|truncate|insert into public\.(orders|order_items))\b|delete from/i)
  assert.doesNotMatch(code, /function public\.place_/)
  await rpc(db, admin, 'open_ordering_window', { p_minutes: 5 })
  await db.exec(sql)
  assert.equal((await config()).accepting, true, 'yeniden çalıştırma açık pencereyi bozmaz')
  const { rows } = await db.query("select count(*)::int n from pg_trigger where tgname = 'fulfillment_settings_clear_window'")
  assert.equal(rows[0].n, 1)
  await rpc(db, admin, 'close_ordering_now', {})
})
