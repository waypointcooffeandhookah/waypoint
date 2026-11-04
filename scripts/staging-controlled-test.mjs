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
const tableToken = Object.values(JSON.parse(readFileSync(new URL('.staging-qr.local', root), 'utf8')))[0]

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const secret = randomBytes(32).toString('base64url')
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options)
const tester = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { ...options, global: { headers: { [HEADER]: secret } } })
const admin = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options)
const results = []
const check = (ok, label) => { results.push(Boolean(ok)); console.log(`${ok ? '✔' : '✖'} ${label}`) }
const code = ({ error }) => /pos:([a-z_]+)/.exec(error?.message ?? '')?.[1] ?? error?.message ?? null
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

  const { data: product } = await anon.from('menu_items').select('id, price').gt('price', 0).eq('is_available', true).order('price', { ascending: false }).limit(1).single()
  const lines = [{ menu_item_id: product.id, quantity: 2 }]
  const qrKey = randomUUID()
  const qr = await tester.rpc('place_qr_order', { p_table_token: tableToken, p_idempotency_key: qrKey, p_items: lines, p_note: 'KONTROLLU STAGING TESTI' })
  check(!qr.error && qr.data?.order_id, `masa QR siparişi alındı (#${qr.data?.order_number ?? code(qr)})`)
  const again = await tester.rpc('place_qr_order', { p_table_token: tableToken, p_idempotency_key: qrKey, p_items: lines })
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
