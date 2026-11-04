// Sunucuda doğrulanan geçici test yetkisi (supabase/staging/06_test_order_grants.sql):
// alım KAPALI kalırken yalnızca sırrı bilen istek sipariş verebilir; herkes için kapalıdır.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createDb, createUser, rpc, rpcError, as, addTable, menuItem, ANON } from './db-harness.mjs'

const GRANT_SQL = readFileSync(new URL('../../supabase/staging/06_test_order_grants.sql', import.meta.url), 'utf8')
const db = await createDb()
await db.exec(readFileSync(new URL('../../supabase/staging/04_multichannel_seed.sql', import.meta.url), 'utf8'))
await db.exec(GRANT_SQL)
const admin = await createUser(db, { role: 'admin', name: 'Yönetici' })
const manager = await createUser(db, { staffRole: 'manager', name: 'Müdür' })
const waiter = await createUser(db, { staffRole: 'waiter', name: 'Garson' })
const { rows: [firstItem] } = await db.query('select name from public.menu_items where price > 0 and is_available limit 1')
const item = await menuItem(db, firstItem.name)
const items = JSON.stringify([{ menu_item_id: item.id, quantity: 20 }])
const table = await addTable(db, 'Test Yetkisi Masası')
const { rows: [zone] } = await db.query('select postal_codes[1] pc, districts[1] d from public.delivery_zones where is_active limit 1')
let phone = 0
const base = { dine_in_enabled: true, pickup_enabled: true, delivery_enabled: true, accepting_orders: false, auto_open_order_type: true, hours_enabled: false, operating_hours: {} }
await rpc(db, admin, 'update_ordering_settings', { p_settings: JSON.stringify(base) })

const newSecret = () => randomBytes(32).toString('base64url')
const hash = secret => createHash('sha256').update(secret).digest('hex')
// PostgREST istek başlıklarını request.headers ayarına JSON olarak koyar; burada aynısı yapılır.
async function rpcWith(secret, user, name, args) {
  const keys = Object.keys(args)
  const params = keys.map((key, i) => `${key} => $${i + 1}`).join(', ')
  return as(db, user, async tx => {
    if (secret !== undefined) await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify({ 'x-waypoint-test-grant': secret, 'user-agent': 'test' })])
    return (await tx.query(`select public.${name}(${params}) as result`, keys.map(key => args[key]))).rows[0].result
  })
}
const errorOf = async promise => { try { await promise; return 'HATA YOK' } catch (error) { return error.message } }
const orders = secret => ({
  qr: () => rpcWith(secret, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: items }),
  pickup: () => rpcWith(secret, ANON, 'place_online_order', { p_fulfillment_type: 'pickup', p_idempotency_key: randomUUID(), p_items: items,
    p_customer: JSON.stringify({ name: 'Yetki Test', phone: `0546${String(++phone).padStart(7, '0')}` }) }),
  delivery: (postal = zone.pc) => rpcWith(secret, ANON, 'place_online_order', { p_fulfillment_type: 'delivery', p_idempotency_key: randomUUID(), p_items: items,
    p_customer: JSON.stringify({ name: 'Yetki Test', phone: `0546${String(++phone).padStart(7, '0')}` }),
    p_address: JSON.stringify({ street: 'Kurgusal Cadde 1', district: zone.d, postal_code: postal }) }),
  config: () => rpcWith(secret, ANON, 'get_ordering_config', {}),
})

test('alım kapalıyken: yetkisiz ziyaretçi ve yanlış sır reddedilir; doğru sır üç kanalda sipariş verir', async () => {
  const secret = newSecret()
  const created = await rpc(db, admin, 'create_ordering_test_grant', { p_token_hash: hash(secret), p_minutes: 30, p_note: 'e2e' })
  assert.ok(created.id && Date.parse(created.expires_at) > Date.now() + 29 * 60000)

  for (const who of [undefined, newSecret(), '', secret.slice(0, 30), hash(secret)]) {
    const o = orders(who)
    for (const kind of ['qr', 'pickup', 'delivery']) assert.match(await errorOf(o[kind]()), /ordering_closed/, `${kind} ${String(who).slice(0, 6)}`)
    assert.equal((await o.config()).accepting, false)
  }
  const ok = orders(secret)
  assert.equal((await ok.config()).accepting, true, 'sır sahibi arayüzde açık görür')
  assert.ok((await ok.qr()).order_id)
  assert.ok((await ok.pickup()).order_id)
  assert.ok((await ok.delivery()).order_id)
  // Herkes için durum değişmedi.
  assert.deepEqual((await db.query('select accepting_orders, accepting_orders_until from public.fulfillment_settings')).rows[0], { accepting_orders: false, accepting_orders_until: null })
  await rpc(db, admin, 'revoke_ordering_test_grants', {})
})

test('yetki diğer korumaları aşmaz: kanal kapalı, bölge dışı adres, personel rolü gerektiren işlemler', async () => {
  const secret = newSecret()
  await rpc(db, admin, 'create_ordering_test_grant', { p_token_hash: hash(secret), p_minutes: 10 })
  const o = orders(secret)
  assert.match(await errorOf(o.delivery('00000')), /out_of_area/)
  await rpc(db, admin, 'update_ordering_settings', { p_settings: JSON.stringify({ ...base, pickup_enabled: false }) })
  assert.match(await errorOf(o.pickup()), /channel_closed|pickup/)
  await rpc(db, admin, 'update_ordering_settings', { p_settings: JSON.stringify(base) })
  assert.match(await errorOf(rpcWith(secret, ANON, 'update_order_status', { p_order_id: randomUUID(), p_status: 'ready', p_reason: null })), /permission denied|forbidden/)
  await rpc(db, admin, 'revoke_ordering_test_grants', {})
})

test('süre dolunca ve kaldırılınca yetki hemen geçersiz; kaldırma denetim kaydına yazılır', async () => {
  const secret = newSecret()
  const { id } = await rpc(db, admin, 'create_ordering_test_grant', { p_token_hash: hash(secret), p_minutes: 5 })
  assert.ok((await orders(secret).qr()).order_id)
  await db.query("update pos_private.ordering_test_grants set expires_at = now() - interval '1 second' where id = $1", [id])
  assert.match(await errorOf(orders(secret).qr()), /ordering_closed/, 'süresi dolan')

  const second = newSecret()
  await rpc(db, admin, 'create_ordering_test_grant', { p_token_hash: hash(second), p_minutes: 5 })
  assert.ok((await orders(second).pickup()).order_id)
  const revoked = await rpc(db, admin, 'revoke_ordering_test_grants', {})
  assert.deepEqual(revoked, { revoked: 1, active: 0 })
  assert.match(await errorOf(orders(second).pickup()), /ordering_closed/, 'kaldırılan')
  const { rows } = await db.query("select action from public.audit_log where action like 'settings.test_grant_%'")
  assert.ok(rows.some(r => r.action === 'settings.test_grant_create') && rows.some(r => r.action === 'settings.test_grant_revoke'))
})

test('yalnızca yönetici yetki oluşturur/kaldırır; sınırlar; tablo ve özet dışarıdan okunamaz', async () => {
  const h = hash(newSecret())
  for (const user of [manager, waiter]) {
    assert.match(await rpcError(db, user, 'create_ordering_test_grant', { p_token_hash: h, p_minutes: 5 }), /forbidden/)
    assert.match(await rpcError(db, user, 'revoke_ordering_test_grants', {}), /forbidden/)
  }
  assert.match(await rpcError(db, ANON, 'create_ordering_test_grant', { p_token_hash: h, p_minutes: 5 }), /permission denied/)
  for (const minutes of [0, 61, null]) assert.match(await rpcError(db, admin, 'create_ordering_test_grant', { p_token_hash: h, p_minutes: minutes }), /invalid_window/)
  for (const bad of ['', 'abc', h.toUpperCase(), `${h}0`, null]) assert.match(await rpcError(db, admin, 'create_ordering_test_grant', { p_token_hash: bad, p_minutes: 5 }), /invalid_grant/)
  for (let i = 0; i < 3; i++) await rpc(db, admin, 'create_ordering_test_grant', { p_token_hash: hash(newSecret()), p_minutes: 5 })
  assert.match(await rpcError(db, admin, 'create_ordering_test_grant', { p_token_hash: h, p_minutes: 5 }), /too_many_grants/)
  await rpc(db, admin, 'revoke_ordering_test_grants', {})
  for (const user of [ANON, admin, waiter]) {
    await assert.rejects(as(db, user, tx => tx.query('select * from pos_private.ordering_test_grants')), /permission denied/)
    await assert.rejects(as(db, user, tx => tx.query('select pos_private.active_test_grant()')), /permission denied/)
  }
})

test('dosya tekrar çalıştırılabilir, DROP/DELETE içermez; pencere davranışı korunur', async () => {
  const code = GRANT_SQL.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\b(drop|truncate|delete)\b/i)
  assert.doesNotMatch(code, /function public\.place_/)
  await db.exec(GRANT_SQL)
  // Yetki yokken süreli pencere ve kapalı alım eskisi gibi çalışır.
  await rpc(db, admin, 'open_ordering_window', { p_minutes: 5 })
  assert.ok((await orders(undefined).qr()).order_id)
  await rpc(db, admin, 'close_ordering_now', {})
  assert.match(await errorOf(orders(undefined).qr()), /ordering_closed/)
  // Personel siparişi yetkiden bağımsızdır.
  assert.ok((await rpc(db, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items })).order_id)
})
