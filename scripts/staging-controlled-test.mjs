// Kontrollü staging sipariş testi:  npm run test:staging:controlled -- --onay [--dakika 15] [--e2e multichannel,staging]
//
// 1) Yalnızca staging projesi (adres ve anahtar denetlenir; üretim reddedilir).
// 2) Yönetici girişiyle SÜRELİ pencere açılır (open_ordering_window). Süre dolunca sunucu kendiliğinden kapatır;
//    betik çökse ya da bilgisayar kapansa bile alım açık kalmaz.
// 3) API ile üç kanalda gerçek sipariş + tekrar gönderim denetimi; ardından istenen tarayıcı e2e testleri
//    (E2E_BASE, ör. https://waypointcoffeandhookah.netlify.app) aynı pencerede çalışır.
// 4) HER DURUMDA (hata, Ctrl+C dahil) close_ordering_now ile kapatılır ve kapalı olduğu müşteri gibi doğrulanır.
// --onay verilmeden hiçbir şey açılmaz (yalnızca durum gösterilir). Kurgusal müşteri verisi kullanılır, kayıt silinmez.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { PRODUCTION_REF, STAGING_REF } from '../src/supabaseTarget.js'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback }
const minutes = Number(value('--dakika', '15'))
const e2e = value('--e2e', '').split(',').map(s => s.trim()).filter(Boolean)
const ALLOWED_E2E = ['multichannel', 'staging']
if (e2e.some(name => !ALLOWED_E2E.includes(name))) { console.error(`--e2e yalnızca: ${ALLOWED_E2E.join(', ')} (admin akışı ayarları kendisi değiştirir; pencere dışında çalıştırın)`); process.exit(2) }

const root = new URL('../', import.meta.url)
const env = Object.fromEntries(readFileSync(new URL('.env.staging.local', root), 'utf8').split(/\r?\n/).filter(line => line.includes('='))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]))
if (!env.VITE_SUPABASE_URL?.includes(STAGING_REF) || env.VITE_SUPABASE_URL.includes(PRODUCTION_REF)) { console.error('✖ Hedef staging projesi değil; durduruldu.'); process.exit(2) }
const creds = JSON.parse(readFileSync(new URL('.staging-credentials.local', root), 'utf8'))
const tableToken = Object.values(JSON.parse(readFileSync(new URL('.staging-qr.local', root), 'utf8')))[0]

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options)
const admin = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, options)
const results = []
const check = (ok, label) => { results.push(Boolean(ok)); console.log(`${ok ? '✔' : '✖'} ${label}`) }
const code = ({ error }) => /pos:([a-z_]+)/.exec(error?.message ?? '')?.[1] ?? error?.message ?? null

const before = (await anon.rpc('get_ordering_config')).data
console.log(`Durum: alım ${before?.accepting ? 'AÇIK' : 'kapalı'} (${before?.blocked ?? 'engel yok'}), kanallar ${JSON.stringify(before?.channels)}`)
if (!flag('--onay')) {
  console.log('\nHiçbir şey değiştirilmedi. Pencereyi açıp test etmek için: npm run test:staging:controlled -- --onay [--dakika 15] [--e2e multichannel,staging]')
  process.exit(0)
}
if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) { console.error('--dakika 1–120 olmalı'); process.exit(2) }

const signIn = await admin.auth.signInWithPassword(creds.admin)
if (signIn.error) { console.error(`✖ Yönetici girişi: ${signIn.error.message}`); process.exit(1) }

let closed = false
async function closeOrdering() {
  if (closed) return
  closed = true
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await admin.rpc('close_ordering_now')
    if (!result.error) break
    console.error(`⚠ kapatma denemesi ${attempt}: ${result.error.message}`)
  }
  const after = (await anon.rpc('get_ordering_config')).data
  const probe = await anon.rpc('place_online_order', { p_fulfillment_type: 'pickup', p_idempotency_key: randomUUID(),
    p_items: [{ menu_item_id: '00000000-0000-0000-0000-000000000000', quantity: 1 }], p_customer: { name: 'Kapanis Denetimi', phone: '05550000099' } })
  check(after?.accepting === false && code(probe) === 'ordering_closed', `alım yeniden KAPALI (müşteri isteği: ${code(probe)})`)
}
process.on('SIGINT', () => { console.log('\nDurduruldu; alım kapatılıyor…'); closeOrdering().finally(() => process.exit(130)) })

try {
  const opened = await admin.rpc('open_ordering_window', { p_minutes: minutes })
  if (opened.error) throw new Error(`pencere açılamadı: ${opened.error.message}`)
  console.log(`\nPencere açık: ${new Date(opened.data.until).toLocaleString('tr-TR')} saatine kadar (sunucu sonra kendiliğinden kapatır)`)

  // API: üç kanal, kurgusal veri. Ürün ve bölge staging'den okunur.
  const { data: product } = await anon.from('menu_items').select('id, price').gt('price', 0).eq('is_available', true).order('price', { ascending: false }).limit(1).single()
  const lines = [{ menu_item_id: product.id, quantity: 2 }]
  const qrKey = randomUUID()
  const qr = await anon.rpc('place_qr_order', { p_table_token: tableToken, p_idempotency_key: qrKey, p_items: lines, p_note: 'KONTROLLU STAGING TESTI' })
  check(!qr.error && qr.data?.order_id, `masa QR siparişi alındı (#${qr.data?.order_number ?? code(qr)})`)
  const again = await anon.rpc('place_qr_order', { p_table_token: tableToken, p_idempotency_key: qrKey, p_items: lines })
  check(again.data?.order_id === qr.data?.order_id && again.data?.duplicate === true, 'aynı anahtarla tekrar gönderim yeni sipariş üretmedi')
  const customer = { name: 'Staging Test', phone: `0555${String(Date.now()).slice(-7)}` }
  const pickup = await anon.rpc('place_online_order', { p_fulfillment_type: 'pickup', p_idempotency_key: randomUUID(), p_items: lines, p_customer: customer, p_note: 'KONTROLLU STAGING TESTI' })
  check(!pickup.error && pickup.data?.order_id, `paket siparişi alındı (#${pickup.data?.order_number ?? code(pickup)})`)
  const zone = (await admin.from('delivery_zones').select('postal_codes, districts').eq('is_active', true).limit(1).single()).data
  const delivery = await anon.rpc('place_online_order', { p_fulfillment_type: 'delivery', p_idempotency_key: randomUUID(), p_items: lines, p_customer: customer,
    p_address: { street: 'Kurgusal Test Sokak 1', district: zone?.districts?.[0] ?? 'Merkez', postal_code: zone?.postal_codes?.[0] }, p_note: 'KONTROLLU STAGING TESTI' })
  check(!delivery.error && delivery.data?.order_id, `kurye siparişi alındı (#${delivery.data?.order_number ?? code(delivery)})`)

  for (const name of e2e) {
    console.log(`\n── tarayıcı testi: test:e2e:${name} (E2E_BASE=${process.env.E2E_BASE ?? 'varsayılan'}) ──`)
    const run = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', `test:e2e:${name}`], { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' })
    check(run.status === 0, `test:e2e:${name}`)
  }
} catch (error) {
  check(false, error.message)
} finally {
  await closeOrdering()
  await admin.auth.signOut()
}
const failed = results.filter(ok => !ok).length
console.log(failed ? `\n✖ ${failed} denetim başarısız` : '\n✔ Kontrollü test tamam; alım kapalı')
process.exit(failed ? 1 : 0)
