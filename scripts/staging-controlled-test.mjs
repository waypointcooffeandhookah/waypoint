// Kontrollü staging sipariş testi (HERKESE AÇMADAN):  npm run test:staging:controlled -- --onay [--dakika 20] [--e2e multichannel,staging]
//
// Müşteri siparişi herkes için KAPALI kalır (accepting_orders=false). Bunun yerine:
// 1) Bu bilgisayarda 256 bit rastgele sır üretilir; yalnızca bellekte tutulur, ekrana/diske/GitHub'a yazılmaz.
// 2) Yönetici girişiyle sunucuya YALNIZCA SHA-256 özeti kaydedilir (create_ordering_test_grant, en fazla 60 dk).
//    Ön koşul: supabase/staging/06_test_order_grants.sql staging'e uygulanmış olmalı.
// 3) API ile üç kanalda gerçek sipariş (x-waypoint-test-grant başlığıyla) + yetkisiz isteğin reddi + tekrar gönderim
//    denetimi. İstenen tarayıcı testleri (E2E_BASE, ör. https://waypointcoffeandhookah.netlify.app) aynı yetkiyle
//    çalışır: başlık test tarayıcısında yalnızca Supabase REST isteklerine eklenir.
// 4) HER DURUMDA (hata, Ctrl+C dahil) revoke_ordering_test_grants ile yetki kaldırılır; hem yetkisiz hem eski sırla
//    reddedildiği müşteri gibi doğrulanır. Betik çökse bile yetki süre sonunda sunucuda kendiliğinden geçersizdir.
// --onay verilmeden hiçbir şey değiştirilmez (yalnızca durum gösterilir). Kurgusal müşteri verisi; kayıt silinmez.
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { PRODUCTION_REF, STAGING_REF } from '../src/supabaseTarget.js'
import { closeTestTable } from '../tests/e2e/tableCleanup.mjs'
import { qrVisitFor } from '../tests/e2e/qrVisit.mjs'

// API testinin masası; tarayıcı testleri Masa 5 ve Masa 6'yı kullanır. Diğer masalara dokunulmaz.
const API_TABLE = 'Masa 9'
const SOLD_OUT_ITEM = '5e000000-0000-4000-8000-000000000302' // staging örnek ürünü "Tükenmiş Tatlı" (is_available=false)

const HEADER = 'x-waypoint-test-grant'
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback }
const minutes = Number(value('--dakika', '20'))
const e2e = value('--e2e', '').split(',').map(s => s.trim()).filter(Boolean)
const ALLOWED_E2E = ['multichannel', 'staging']
if (e2e.some(name => !ALLOWED_E2E.includes(name))) { console.error(`--e2e yalnızca: ${ALLOWED_E2E.join(', ')} (admin akışı ayarları kendisi değiştirir)`); process.exit(2) }

const root = new URL('../', import.meta.url)
const env = Object.fromEntries(readFileSync(new URL('.env.staging.local', root), 'utf8').split(/\r?\n/).filter(line => line.includes('='))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]))
if (!env.VITE_SUPABASE_URL?.includes(STAGING_REF) || env.VITE_SUPABASE_URL.includes(PRODUCTION_REF)) { console.error('✖ Hedef staging projesi değil; durduruldu.'); process.exit(2) }
const creds = JSON.parse(readFileSync(new URL('.staging-credentials.local', root), 'utf8'))
const tableToken = JSON.parse(readFileSync(new URL('.staging-qr.local', root), 'utf8'))[API_TABLE]
if (!tableToken) { console.error(`✖ ${API_TABLE} QR kodu .staging-qr.local içinde yok`); process.exit(2) }

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const secret = randomBytes(32).toString('base64url')
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options)
const tester = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { ...options, global: { headers: { [HEADER]: secret } } })
const admin = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options)
const results = []
const check = (ok, label) => { results.push(Boolean(ok)); console.log(`${ok ? '✔' : '✖'} ${label}`) }
const code = ({ error }) => /pos:([a-z_]+)/.exec(error?.message ?? '')?.[1] ?? error?.message ?? null
async function staffClient(user) {
  const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options)
  const { error } = await db.auth.signInWithPassword(user)
  if (error) throw new Error(`personel girişi: ${error.message}`)
  return db
}
const probe = client => client.rpc('place_online_order', { p_fulfillment_type: 'pickup', p_idempotency_key: randomUUID(),
  p_items: [{ menu_item_id: '00000000-0000-0000-0000-000000000000', quantity: 1 }], p_customer: { name: 'Kapali Denetimi', phone: '05550000099' } })

const beforeResult = await anon.rpc('get_ordering_config')
const before = beforeResult.data
if (!before) { console.error(`✖ Staging durumu okunamadı (${beforeResult.error?.message ?? 'boş yanıt'}); hiçbir şey değiştirilmedi.`); process.exit(1) }
console.log(`Durum: herkese alım ${before?.accepting ? 'AÇIK' : 'kapalı'} (${before?.blocked ?? 'engel yok'}), kanallar ${JSON.stringify(before?.channels)}`)
if (!flag('--onay')) {
  console.log('\nHiçbir şey değiştirilmedi. Test yetkisiyle denemek için: npm run test:staging:controlled -- --onay [--dakika 20] [--e2e multichannel,staging]')
  process.exit(0)
}
if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) { console.error('--dakika 1–60 olmalı'); process.exit(2) }
if (before?.accepting) { console.error('✖ Alım herkese AÇIK; bu test kapalı durumda çalışır. Önce kapatın.'); process.exit(2) }

const signIn = await admin.auth.signInWithPassword(creds.admin)
if (signIn.error) { console.error(`✖ Yönetici girişi: ${signIn.error.message}`); process.exit(1) }

let finished = false
async function revoke() {
  if (finished) return
  finished = true
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await admin.rpc('revoke_ordering_test_grants')
    if (!result.error) { console.log(`\nYetki kaldırıldı (${result.data?.revoked ?? 0}); etkin yetki: ${result.data?.active ?? '?'}`); break }
    console.error(`⚠ kaldırma denemesi ${attempt}: ${result.error.message}`)
  }
  const [publicProbe, oldSecretProbe, config] = [await probe(anon), await probe(tester), (await anon.rpc('get_ordering_config')).data]
  check(code(publicProbe) === 'ordering_closed' && config?.accepting === false, `herkese alım KAPALI (müşteri isteği: ${code(publicProbe)})`)
  check(code(oldSecretProbe) === 'ordering_closed', `kaldırılan sır artık geçersiz (${code(oldSecretProbe)})`)
}
process.on('SIGINT', () => { console.log('\nDurduruldu; yetki kaldırılıyor…'); revoke().finally(() => process.exit(130)) })

try {
  const hash = createHash('sha256').update(secret).digest('hex')
  const created = await admin.rpc('create_ordering_test_grant', { p_token_hash: hash, p_minutes: minutes, p_note: 'test:staging:controlled' })
  if (created.error) {
    throw new Error(/create_ordering_test_grant|schema cache|does not exist/i.test(created.error.message)
      ? 'test yetkisi altyapısı staging\'de yok: önce supabase/staging/06_test_order_grants.sql uygulanmalı (onay gerekir)'
      : `yetki oluşturulamadı: ${created.error.message}`)
  }
  console.log(`\nTest yetkisi: ${new Date(created.data.expires_at).toLocaleString('tr-TR')} saatine kadar (yalnızca bu bilgisayardaki sırla)`)

  check(code(await probe(anon)) === 'ordering_closed', 'yetkisiz ziyaretçi hâlâ reddediliyor')
  check((await tester.rpc('get_ordering_config')).data?.accepting === true, 'yetkili istemci alımı açık görüyor')
  // API masası temiz başlar (önceki çalıştırma yarıda kaldıysa normal yoldan kapatılır; veri silinmez).
  console.log(`ℹ ön temizlik ${API_TABLE}: ${JSON.stringify(await closeTestTable(admin, API_TABLE))}`)

  const { data: product } = await anon.from('menu_items').select('id, price').gt('price', 0).eq('is_available', true).order('price', { ascending: false }).limit(1).single()
  const lines = [{ menu_item_id: product.id, quantity: 2 }]
  // Masa kodu yalnızca süreli bilet verir; çıplak kodla sipariş reddedilir.
  check(code(await tester.rpc('place_qr_order', { p_table_token: tableToken, p_idempotency_key: randomUUID(), p_items: lines })) === 'qr_visit_required', 'basılı masa kodu tek başına sipariş veremiyor')
  const tableVisit = await qrVisitFor(tester, tableToken)
  const qrKey = randomUUID()
  const qr = await tester.rpc('place_qr_order', { p_table_token: tableVisit, p_idempotency_key: qrKey, p_items: lines, p_note: 'KONTROLLU STAGING TESTI' })
  check(!qr.error && qr.data?.order_id, `masa QR siparişi alındı (#${qr.data?.order_number ?? code(qr)})`)
  const again = await tester.rpc('place_qr_order', { p_table_token: tableVisit, p_idempotency_key: qrKey, p_items: lines })
  check(again.data?.order_id === qr.data?.order_id && again.data?.duplicate === true, 'aynı anahtarla tekrar gönderim yeni sipariş üretmedi')
  const customer = { name: 'Staging Test', phone: `0555${String(Date.now()).slice(-7)}` }
  const pickup = await tester.rpc('place_online_order', { p_fulfillment_type: 'pickup', p_idempotency_key: randomUUID(), p_items: lines, p_customer: customer, p_note: 'KONTROLLU STAGING TESTI' })
  check(!pickup.error && pickup.data?.order_id, `paket siparişi alındı (#${pickup.data?.order_number ?? code(pickup)})`)
  const zone = (await admin.from('delivery_zones').select('postal_codes, districts').eq('is_active', true).limit(1).single()).data
  const delivery = await tester.rpc('place_online_order', { p_fulfillment_type: 'delivery', p_idempotency_key: randomUUID(), p_items: lines, p_customer: customer,
    p_address: { street: 'Kurgusal Test Sokak 1', district: zone?.districts?.[0] ?? 'Merkez', postal_code: zone?.postal_codes?.[0] }, p_note: 'KONTROLLU STAGING TESTI' })
  check(!delivery.error && delivery.data?.order_id, `kurye siparişi alındı (#${delivery.data?.order_number ?? code(delivery)})`)
  const outside = await tester.rpc('place_online_order', { p_fulfillment_type: 'delivery', p_idempotency_key: randomUUID(), p_items: lines, p_customer: customer,
    p_address: { street: 'Kurgusal Test Sokak 1', district: 'Bolge Disi', postal_code: '00000' } })
  check(code(outside) === 'out_of_area', `bölge dışı adres yetkiyle de reddedildi (${code(outside)})`)
  const soldOut = await tester.rpc('place_online_order', { p_fulfillment_type: 'pickup', p_idempotency_key: randomUUID(),
    p_items: [{ menu_item_id: SOLD_OUT_ITEM, quantity: 1 }], p_customer: customer })
  check(code(soldOut) === 'item_unavailable', `stok: tükenen ürün yetkiyle de reddedildi (${code(soldOut)})`)

  // ── Uçtan uca işleme: gerçek mutfak/garson hesaplarıyla mutfak → servis/teslimat → ödeme → kapanış ──
  const kitchen = await staffClient(creds.kitchen)
  const waiter = await staffClient(creds.waiter)
  const ids = [qr, pickup, delivery].map(o => o.data.order_id)
  const status = async (db, id, next, reason = null) => code(await db.rpc('update_order_status', { p_order_id: id, p_status: next, p_reason: reason }))
  const seen = (await kitchen.from('orders').select('id').in('id', ids)).data ?? []
  check(seen.length === 3, `mutfak hesabı üç siparişi görüyor (${seen.length}/3)`)
  check(await status(waiter, qr.data.order_id, 'preparing') === 'forbidden', 'yetki: garson siparişi "hazırlanıyor" yapamaz')
  const kitchenErrors = []
  for (const id of ids) for (const next of ['preparing', 'ready']) { const failure = await status(kitchen, id, next); if (failure) kitchenErrors.push(`${next}: ${failure}`) }
  check(!kitchenErrors.length, `mutfak: üç sipariş hazırlanıyor → hazır ${kitchenErrors.join(', ')}`)

  check(!(await status(waiter, qr.data.order_id, 'served')), 'garson: masa siparişi servis edildi')
  const { data: qrRow } = await admin.from('orders').select('bill_id, session_id').eq('id', qr.data.order_id).single()
  const balance = async () => Number((await admin.from('bill_summaries').select('balance_cents').eq('bill_id', qrRow.bill_id).single()).data?.balance_cents)
  const due = await balance()
  check(due === Number(qr.data.subtotal_cents), `adisyon: bakiye sipariş tutarına eşit (${due} = ${qr.data.subtotal_cents} kuruş)`)
  const kitchenPay = await kitchen.rpc('record_payment', { p_bill_id: qrRow.bill_id, p_amount_cents: due, p_method: 'card', p_idempotency_key: randomUUID() })
  check(Boolean(kitchenPay.error), `yetki: mutfak ödeme alamaz (${code(kitchenPay)})`)
  const over = await waiter.rpc('record_payment', { p_bill_id: qrRow.bill_id, p_amount_cents: due + 100, p_method: 'card', p_idempotency_key: randomUUID() })
  check(code(over) === 'overpayment', `ödeme: bakiyeden fazlası reddedildi (${code(over)})`)
  const payKey = randomUUID()
  const paid = await waiter.rpc('record_payment', { p_bill_id: qrRow.bill_id, p_amount_cents: due, p_method: 'card', p_idempotency_key: payKey, p_note: 'KONTROLLU STAGING TESTI' })
  const paidAgain = await waiter.rpc('record_payment', { p_bill_id: qrRow.bill_id, p_amount_cents: due, p_method: 'card', p_idempotency_key: payKey })
  check(!paid.error && !paidAgain.error && await balance() === 0, `ödeme: garson kartla ödedi, aynı anahtarla tekrar ödeme çift kayıt üretmedi (bakiye ${await balance()})`)
  const closed = await waiter.rpc('close_table_session', { p_session_id: qrRow.session_id })
  check(!closed.error, `adisyon kapatıldı (${API_TABLE}) ${closed.error ? code(closed) : ''}`)

  const fulfill = (db, id, next, courier = null) => db.rpc('update_fulfillment_status', { p_order_id: id, p_status: next, p_courier_name: courier })
  check(code(await fulfill(waiter, pickup.data.order_id, 'collected')) === 'forbidden', 'yetki: garson paket teslimini işaretleyemez')
  const collected = await fulfill(admin, pickup.data.order_id, 'collected')
  const pickupPaid = await admin.rpc('record_fulfillment_payment', { p_order_id: pickup.data.order_id, p_method: 'cash' })
  check(!collected.error && !pickupPaid.error, `paket: hazır → müşteri teslim aldı → nakit ödeme ${code(collected) ?? ''} ${code(pickupPaid) ?? ''}`)
  const noCourier = await fulfill(admin, delivery.data.order_id, 'handed_to_courier')
  check(code(noCourier) === 'courier_required', `kurye: kurye adı olmadan yola çıkarılamaz (${code(noCourier)})`)
  const handed = await fulfill(admin, delivery.data.order_id, 'handed_to_courier', 'Test Kurye')
  const delivered = await fulfill(admin, delivery.data.order_id, 'delivered')
  const deliveryPaid = await admin.rpc('record_fulfillment_payment', { p_order_id: delivery.data.order_id, p_method: 'cash' })
  check(!handed.error && !delivered.error && !deliveryPaid.error, `kurye: hazır → kuryeye verildi → teslim edildi → kapıda ödeme ${[handed, delivered, deliveryPaid].map(code).filter(Boolean).join(' ')}`)
  const final = (await admin.from('orders').select('order_number, status').in('id', ids).order('order_number')).data ?? []
  check(final.length === 3 && final.every(o => o.status === 'served'), `son durum: ${final.map(o => `#${o.order_number} ${o.status}`).join(', ')}`)
  const tracked = await anon.rpc('get_order_tracking', { p_tracking_token: delivery.data.tracking_token })
  check(!tracked.error && JSON.stringify(tracked.data).includes('delivered'), 'müşteri takip sayfası "teslim edildi" görüyor')
  await kitchen.auth.signOut(); await waiter.auth.signOut()

  // Tarayıcı testleri Masa 5/6'da sıfırdan başlamalı: önceki çalıştırmalardan kalanlar normal yoldan kapatılır.
  for (const label of ['Masa 5', 'Masa 6']) console.log(`ℹ ön temizlik ${label}: ${JSON.stringify(await closeTestTable(admin, label))}`)

  for (const name of e2e) {
    console.log(`\n── tarayıcı testi: test:e2e:${name} (E2E_BASE=${process.env.E2E_BASE ?? 'varsayılan'}) ──`)
    // Sır yalnızca alt sürecin ortamına verilir; komut satırına/loga yazılmaz.
    const run = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', `test:e2e:${name}`], { stdio: 'inherit', env: { ...process.env, E2E_TEST_GRANT: secret }, shell: process.platform === 'win32' })
    check(run.status === 0, `test:e2e:${name}`)
  }
} catch (error) {
  check(false, error.message)
} finally {
  await revoke()
  await admin.auth.signOut()
}
const failed = results.filter(ok => !ok).length
console.log(failed ? `\n✖ ${failed} denetim başarısız` : '\n✔ Kontrollü test tamam; yetki kaldırıldı, alım herkese kapalı')
process.exit(failed ? 1 : 0)
