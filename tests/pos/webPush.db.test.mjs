// Web Push aboneliği ve sunucu tarafı gönderim kuyruğu: yetki, SSRF listesi, sahiplik,
// tekrar gönderim koruması ve talep/sonuç yaşam döngüsü (gerçek Postgres, PGlite).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, webcrypto } from 'node:crypto'
import { createDb, createUser, rpc, rpcError, as, addTable, menuItem, ANON } from './db-harness.mjs'

let db, waiter, waiter2, kitchen, cashier, manager, kofte

const b64url = bytes => Buffer.from(bytes).toString('base64url')
async function deviceKeys() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  return { p256dh: b64url(await webcrypto.subtle.exportKey('raw', pair.publicKey)), auth: b64url(webcrypto.getRandomValues(new Uint8Array(16))) }
}
const endpoint = (host = 'fcm.googleapis.com') => `https://${host}/fcm/send/${randomUUID()}`
async function register(user, url = endpoint()) {
  const keys = await deviceKeys()
  const result = await rpc(db, user, 'register_push_subscription', { p_endpoint: url, p_p256dh: keys.p256dh, p_auth: keys.auth, p_user_agent: 'test' })
  return { ...result, endpoint: url }
}
const asService = fn => db.transaction(async tx => { await tx.query('set local role service_role'); return fn(tx) })
const claim = (limit = 50) => asService(async tx => (await tx.query('select * from public.push_claim_batch($1)', [limit])).rows)
const report = (id, outcome, status = 201, error = null) =>
  asService(tx => tx.query('select public.push_report_result($1, $2, $3, $4)', [id, outcome, status, error]))
const outbox = async orderId => (await db.query('select * from public.push_outbox where order_id = $1 order by id', [orderId])).rows

async function readyOrder(label) {
  const table = await addTable(db, label)
  const order = await rpc(db, waiter, 'place_staff_order', {
    p_table_id: table.id, p_idempotency_key: randomUUID(),
    p_items: JSON.stringify([{ menu_item_id: kofte.id, quantity: 2, note: null }]),
  })
  await rpc(db, kitchen, 'update_order_status', { p_order_id: order.order_id, p_status: 'preparing' })
  await rpc(db, kitchen, 'update_order_status', { p_order_id: order.order_id, p_status: 'ready' })
  return { table, id: order.order_id }
}

before(async () => {
  db = await createDb()
  waiter = await createUser(db, { staffRole: 'waiter', name: 'Garson' })
  waiter2 = await createUser(db, { staffRole: 'waiter', name: 'Garson 2' })
  kitchen = await createUser(db, { staffRole: 'kitchen', name: 'Mutfak' })
  cashier = await createUser(db, { staffRole: 'cashier', name: 'Kasa' })
  manager = await createUser(db, { staffRole: 'manager', name: 'Müdür' })
  kofte = await menuItem(db, 'Izgara Köfte')
  // Bağımsız testler birbirinin aboneliğini görmesin diye her test kendi masasını ve cihazlarını kullanır.
})

test('abonelik: yalnızca garson/müdür/yönetici kaydedebilir; anonim, mutfak ve kasa reddedilir', async () => {
  const keys = await deviceKeys()
  const args = { p_endpoint: endpoint(), p_p256dh: keys.p256dh, p_auth: keys.auth, p_user_agent: null }
  assert.ok((await rpc(db, waiter, 'register_push_subscription', args)).id)
  assert.ok((await rpc(db, manager, 'register_push_subscription', { ...args, p_endpoint: endpoint() })).id)
  assert.match(await rpcError(db, kitchen, 'register_push_subscription', { ...args, p_endpoint: endpoint() }), /forbidden/)
  assert.match(await rpcError(db, cashier, 'register_push_subscription', { ...args, p_endpoint: endpoint() }), /forbidden/)
  assert.match(await rpcError(db, ANON, 'register_push_subscription', { ...args, p_endpoint: endpoint() }), /permission denied/)
})

test('abonelik: bilinmeyen/iç ağ adresi ve bozuk anahtar reddedilir (SSRF)', async () => {
  const keys = await deviceKeys()
  const bad = ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://127.0.0.1/x', 'https://localhost/x',
    'https://fcm.googleapis.com.evil.com/x', 'https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x',
    'https://169.254.169.254/latest', `https://fcm.googleapis.com/${'a'.repeat(1100)}`]
  for (const url of bad) {
    assert.match(await rpcError(db, waiter, 'register_push_subscription', { p_endpoint: url, p_p256dh: keys.p256dh, p_auth: keys.auth, p_user_agent: null }), /push_endpoint_invalid/, url)
  }
  for (const host of ['web.push.apple.com', 'updates.push.services.mozilla.com', 'wns2-db5p.notify.windows.com']) {
    assert.ok((await register(waiter2, endpoint(host))).id, host)
  }
  assert.match(await rpcError(db, waiter, 'register_push_subscription', { p_endpoint: endpoint(), p_p256dh: 'kisa', p_auth: keys.auth, p_user_agent: null }), /push_keys_invalid/)
  assert.match(await rpcError(db, waiter, 'register_push_subscription', { p_endpoint: endpoint(), p_p256dh: keys.p256dh, p_auth: 'x'.repeat(40), p_user_agent: null }), /push_keys_invalid/)
})

test('abonelik tabloları tarayıcıdan doğrudan okunamaz/yazılamaz; gönderici RPC yalnızca service_role', async () => {
  for (const sql of ['select * from public.push_subscriptions', 'select * from public.push_outbox',
    "insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values (gen_random_uuid(), 'https://fcm.googleapis.com/x', 'a', 'b')"]) {
    await assert.rejects(as(db, waiter, tx => tx.query(sql)), /permission denied/, sql)
    await assert.rejects(as(db, ANON, tx => tx.query(sql)), /permission denied/, sql)
  }
  for (const user of [ANON, waiter, manager]) {
    await assert.rejects(as(db, user, tx => tx.query('select * from public.push_claim_batch(10)')), /permission denied/)
    await assert.rejects(as(db, user, tx => tx.query("select public.push_report_result(1, 'sent')")), /permission denied/)
  }
})

test('sahiplik: aynı cihaz başka garsonla açılınca abonelik ona geçer; başkasının aboneliği silinemez', async () => {
  const shared = endpoint()
  const first = await register(waiter, shared)
  const second = await register(waiter2, shared)
  assert.equal(first.id, second.id)
  const { rows: [row] } = await db.query('select user_id from public.push_subscriptions where endpoint = $1', [shared])
  assert.equal(row.user_id, waiter2.id)
  assert.equal(await rpc(db, waiter, 'unregister_push_subscription', { p_endpoint: shared }), false)
  assert.equal(await rpc(db, waiter2, 'unregister_push_subscription', { p_endpoint: shared }), true)
  assert.match(await rpcError(db, ANON, 'unregister_push_subscription', { p_endpoint: shared }), /permission denied/)
})

test('kişi başına en fazla 5 cihaz tutulur', async () => {
  const user = await createUser(db, { staffRole: 'waiter', name: 'Çok cihaz' })
  for (let i = 0; i < 7; i++) await register(user)
  const { rows: [{ count }] } = await db.query('select count(*)::int as count from public.push_subscriptions where user_id = $1', [user.id])
  assert.equal(count, 5)
})

test('hazır: her uygun cihaz için tek kuyruk satırı; tekrar "hazır" kaydı kopya üretmez; yük müşteri bilgisi taşımaz', async () => {
  await db.query('delete from public.push_subscriptions')
  const phone = await register(waiter)
  const managerTablet = await register(manager)
  await db.query('insert into public.staff_profiles(user_id, display_name, role) values ($1, $2, $3) on conflict do nothing', [kitchen.id, 'Mutfak', 'kitchen'])
  const { table, id } = await readyOrder('Masa P1')

  const rows = await outbox(id)
  assert.deepEqual(rows.map(r => r.subscription_id).sort(), [phone.id, managerTablet.id].sort())
  const payload = rows[0].payload
  assert.equal(payload.title, 'Masa P1 — Siparişiniz Hazır!')
  assert.equal(payload.body, '2 × Izgara Köfte')
  assert.equal(payload.url, `garson/masa/${table.id}`)
  assert.match(payload.tag, /^waypoint-ready-\d+$/)
  assert.deepEqual(Object.keys(payload).sort(), ['at', 'body', 'orderId', 'orderNumber', 'tableId', 'tag', 'title', 'type', 'url', 'v'])

  // Aynı siparişe ikinci bir "ready" geçmiş satırı (ör. yeniden deneme) yeni bildirim üretmez.
  await db.query("insert into public.order_status_history(order_id, from_status, to_status) values ($1, 'ready', 'ready')", [id])
  assert.equal((await outbox(id)).length, 2)
  // Durum zaten "ready" iken tekrar istek geçmiş satırı da yazmaz.
  await rpc(db, kitchen, 'update_order_status', { p_order_id: id, p_status: 'ready' })
  assert.equal((await outbox(id)).length, 2)
})

test('gönderim yaşam döngüsü: talep edilen satır ikinci kez verilmez; sent/retry/gone/failed doğru işlenir', async () => {
  await db.query('delete from public.push_subscriptions')
  const a = await register(waiter)
  const b = await register(waiter2)
  const c = await register(manager)
  const { id } = await readyOrder('Masa P2')

  const batch = await claim()
  assert.equal(batch.length, 3)
  assert.ok(batch.every(row => row.endpoint && row.p256dh && row.auth && row.topic === id.replaceAll('-', '')))
  assert.equal((await claim()).length, 0, 'eşzamanlı ikinci çağrı aynı satırları alamaz')

  const bySub = Object.fromEntries((await outbox(id)).map(r => [r.subscription_id, r.id]))
  await report(bySub[a.id], 'sent', 201)
  await report(bySub[a.id], 'sent', 201) // tekrar rapor durumu bozmaz
  await report(bySub[b.id], 'retry', 503, 'http_503')
  await report(bySub[c.id], 'gone', 410, 'http_410')

  const after = Object.fromEntries((await outbox(id)).map(r => [r.subscription_id, r]))
  assert.equal(after[a.id].status, 'sent')
  assert.equal(after[b.id].status, 'pending')
  assert.ok(new Date(after[b.id].next_attempt_at) > new Date())
  assert.equal(after[c.id], undefined)
  const { rows } = await db.query('select id from public.push_subscriptions where id = $1', [c.id])
  assert.equal(rows.length, 0, '410 dönen abonelik silinir')

  // Geri çekilme süresi dolmadan yeniden talep edilmez; dolunca edilir; 5 denemeden sonra kalıcı hata.
  assert.equal((await claim()).length, 0)
  for (let i = 0; i < 4; i++) {
    await db.query("update public.push_outbox set next_attempt_at = now() - interval '1 second' where id = $1", [bySub[b.id]])
    const [row] = await claim()
    assert.equal(row.id, bySub[b.id])
    await report(row.id, 'retry', 500, 'http_500')
  }
  const { rows: [final] } = await db.query('select status, attempts from public.push_outbox where id = $1', [bySub[b.id]])
  assert.deepEqual([final.status, final.attempts], ['failed', 5])
})

test('gönderimden önce servis edilen sipariş veya pasifleştirilen garson için bildirim gönderilmez', async () => {
  await db.query('delete from public.push_subscriptions')
  const active = await register(waiter)
  const leaving = await createUser(db, { staffRole: 'waiter', name: 'Ayrılan' })
  const leavingSub = await register(leaving)
  const served = await readyOrder('Masa P3')
  await rpc(db, waiter, 'update_order_status', { p_order_id: served.id, p_status: 'served' })
  assert.equal((await claim()).length, 0)
  assert.ok((await outbox(served.id)).every(r => r.status === 'skipped'))

  const fresh = await readyOrder('Masa P4')
  await db.query('update public.staff_profiles set is_active = false where user_id = $1', [leaving.id])
  const batch = await claim()
  assert.deepEqual(batch.map(r => r.endpoint), [active.endpoint])
  const skipped = (await outbox(fresh.id)).find(r => r.subscription_id === leavingSub.id)
  assert.equal(skipped.status, 'skipped')
})

test('15 dakikadan eski bildirim gönderilmez (geç gelen "hazır" uyarısı yanıltıcıdır)', async () => {
  await db.query('delete from public.push_subscriptions')
  await register(waiter)
  const { id } = await readyOrder('Masa P5')
  await db.query("update public.push_outbox set created_at = now() - interval '16 minutes' where order_id = $1", [id])
  assert.equal((await claim()).length, 0)
  assert.equal((await outbox(id))[0].status, 'expired')
})

test('pg_net/Vault yokken durum değişikliği sorunsuz tamamlanır (kuyruk dolar, çağrı yapılmaz)', async () => {
  await db.query('delete from public.push_subscriptions')
  await register(waiter)
  const { id } = await readyOrder('Masa P6')
  const { rows: [order] } = await db.query('select status from public.orders where id = $1', [id])
  assert.equal(order.status, 'ready')
  assert.equal((await outbox(id)).length, 1)
})
