// Yönetim merkezinin gerçek staging testi (npm run test:e2e:admin). Önce `npm run dev:staging`.
// Ayarları geçici değiştirir ve sonunda geri yükler; kurgusal veri kullanır, kayıt silmez.
// Her rol ayrı Chrome profilindedir ama aynı bilgisayardadır: fiziksel cihaz testi değildir.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomInt, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { PRODUCTION_REF, STAGING_REF } from '../../src/supabaseTarget.js'

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173/waypoint'
const BROWSER = [process.env.E2E_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(path => path && existsSync(path))
if (!BROWSER) { console.error('Chrome veya Edge bulunamadı.'); process.exit(2) }
const root = new URL('../../', import.meta.url)
const env = Object.fromEntries(readFileSync(new URL('.env.staging.local', root), 'utf8').split(/\r?\n/).filter(Boolean).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
if (env.VITE_SUPABASE_URL !== `https://${STAGING_REF}.supabase.co`) { console.error('Hedef staging değil.'); process.exit(2) }
const tokens = JSON.parse(readFileSync(new URL('.staging-qr.local', root), 'utf8'))
const creds = JSON.parse(readFileSync(new URL('.staging-credentials.local', root), 'utf8'))
const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const signIn = async role => { const db = client(); const { error } = await db.auth.signInWithPassword(creds[role]); if (error) throw new Error(`${role} girişi başarısız`); return db }

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const errorsSeen = [], hosts = new Set(), browsers = [], temps = []
let nextPort = 9380

async function openPage() {
  const port = nextPort++
  const temp = mkdtempSync(join(tmpdir(), 'waypoint-admin-'))
  temps.push(temp)
  browsers.push(spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${temp}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' }))
  for (let i = 0; i < 60; i++) { if (await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.ok).catch(() => false)) break; await sleep(250) }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json())
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => { ws.onopen = resolve })
  let id = 0
  const waiting = new Map()
  ws.onmessage = event => {
    const m = JSON.parse(event.data)
    if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') errorsSeen.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if (m.method === 'Network.requestWillBeSent') { const host = /^https?:\/\/([^/]+)/.exec(m.params.request.url)?.[1]; if (host) hosts.add(host) }
    if (m.method === 'Page.javascriptDialogOpening') ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }))
  }
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id
    const timer = setTimeout(() => reject(new Error(`Tarayıcı yanıt vermedi: ${method}`)), 30000)
    waiting.set(n, value => { clearTimeout(timer); resolve(value) })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  const ev = async expression => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? expression)
    return r.result.result.value
  }
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable')
  return {
    cdp, ev,
    size: (width, height) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 1000 }),
    go: path => cdp('Page.navigate', { url: BASE + path }),
    until: async (expression, label, ms = 20000) => {
      const end = Date.now() + ms
      while (Date.now() < end) { if (await ev(`(()=>{try{return !!(${expression})}catch{return false}})()`)) return; await sleep(100) }
      throw new Error(`Beklenen durum oluşmadı: ${label}`)
    },
    click: sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('yok: '+${JSON.stringify(sel)}); e.click()})()`),
    clickText: (text, scope = 'button,a') => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope)})].find(b=>b.innerText.includes(${JSON.stringify(text)})&&b.offsetParent); if(!e) throw new Error('yok: '+${JSON.stringify(text)}); e.click()})()`),
    type: (sel, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('yok: '+${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`),
    shot: async name => {
      if (!process.env.E2E_SHOTS) return
      await sleep(350)
      const r = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 72 })
      writeFileSync(join(process.env.E2E_SHOTS, `${name}.jpg`), Buffer.from(r.result.data, 'base64'))
    },
    overflow: () => ev('document.documentElement.scrollWidth - document.documentElement.clientWidth'),
  }
}

const results = []
let failed = 0
async function step(name, fn) {
  try { const detail = await fn(); results.push(`OK    ${name}${detail ? ` -> ${detail}` : ''}`) }
  catch (error) { failed++; results.push(`FAIL  ${name} -> ${error.message.split('\n')[0]}`) }
}
const expect = (ok, message) => { if (!ok) throw new Error(message) }
const code = ({ error }) => /^pos:([a-z_]+)/.exec(error?.message ?? '')?.[1] ?? error?.code ?? 'yok'

const anon = client()
const admin = await signIn('admin'), waiterDb = await signIn('waiter'), kitchenDb = await signIn('kitchen')
const original = (await admin.from('fulfillment_settings').select('*').eq('id', 1).single()).data
const toPayload = row => ({ dine_in_enabled: row.dine_in_enabled, pickup_enabled: row.pickup_enabled && row.allow_pay_at_pickup, delivery_enabled: row.delivery_enabled && row.allow_cash_on_delivery, accepting_orders: row.accepting_orders, auto_open_order_type: row.auto_open_order_type, hours_enabled: row.hours_enabled, operating_hours: row.operating_hours })
const restore = () => admin.rpc('update_ordering_settings', { p_settings: toPayload(original) })
const COFFEE = '5e000000-0000-4000-8000-000000000103'
const orderArgs = extra => ({ p_fulfillment_type: 'pickup', p_idempotency_key: randomUUID(), p_items: [{ menu_item_id: COFFEE, quantity: 1 }], p_customer: { name: 'Kurgusal Müşteri', phone: `0555${randomInt(1000000, 9999999)}` }, p_note: 'TEST admin', ...extra })
const config = async () => (await anon.rpc('get_ordering_config')).data
const SECTIONS = ['', 'menu', 'siparisler', 'masalar', 'teslimat', 'ayarlar', 'personel']

const login = async (page, { email, password }) => {
  await page.go('/admin/login')
  await page.until(`document.querySelector('input[type=password]')`, 'giriş formu')
  await page.type('input[type=email]', email)
  await page.type('input[type=password]', password)
  await page.click('button[type=submit]')
}
const toggle = async (page, id, wanted) => {
  await page.until(`document.querySelector('#${id}')`, 'ayar')
  if (await page.ev(`document.querySelector('#${id}').checked`) !== wanted) await page.click(`#${id}`)
}
const saveSettings = async page => {
  await page.click('.ad-settings-save')
  await page.until(`document.body.innerText.includes('Ayarlar kaydedildi')`, 'kaydedildi', 8000)
  await page.ev(`document.querySelectorAll('[role=status]').forEach(()=>{})`)
  await sleep(300)
}
const enterMenu = async (page, path = '/') => {
  await page.go(path)
  await page.until(`[...document.querySelectorAll('button')].some(b=>b.innerText.includes('MENÜYÜ KEŞFET'))`, 'karşılama')
  await page.clickText('MENÜYÜ KEŞFET')
  await page.until(`document.querySelector('.menu-search')&&!document.querySelector('.hero-viewport')`, 'menü')
  await sleep(1200)
  if (await page.ev(`!!document.querySelector('.promotion-close')`)) {
    await page.click('.promotion-close')
    await page.until(`!document.querySelector('.promotion-close')`, 'tanıtım kapandı')
  }
}
const newVisit = async page => {
  await page.go('/admin/login')
  await page.until('document.body', 'sayfa')
  await sleep(300)
  await page.ev('sessionStorage.clear();localStorage.clear()')
}

try {
  const adminPage = await openPage(), staffPage = await openPage(), customer = await openPage()
  await adminPage.size(1366, 900); await staffPage.size(390, 844); await customer.size(390, 844)

  await step('Yetki: girişsiz kullanıcı giriş sayfasına yönlenir; garson ve mutfak panele giremez, ayar göremez', async () => {
    await staffPage.go('/admin/ayarlar')
    await staffPage.until(`location.pathname.endsWith('/admin/login')`, 'giriş sayfası')
    for (const role of ['waiter', 'kitchen']) {
      await staffPage.ev('localStorage.clear()')
      const path = role === 'waiter' ? '/garson' : '/mutfak'
      await staffPage.go(path)
      await staffPage.until(`document.querySelector('#staff-email')`, 'personel girişi')
      await staffPage.type('#staff-email', creds[role].email)
      await staffPage.type('#staff-password', creds[role].password)
      await staffPage.click('.login-btn')
      await staffPage.until(`document.querySelector('.pos-header')`, 'personel ekranı')
      for (const section of ['/admin', '/admin/ayarlar', '/admin/personel']) {
        await staffPage.go(section)
        await staffPage.until(`document.body.innerText.includes('yönetici yetkisi bulunmuyor')`, `${role} reddi`)
        expect(!await staffPage.ev(`!!document.querySelector('.ad-nav,.ad-settings')`), `${role} paneli gördü`)
      }
    }
  })

  await step('Sunucu yetkisi: garson, mutfak ve anonim ayar, bölge ve personel değiştiremez, müşteri bilgisi okuyamaz', async () => {
    for (const db of [waiterDb, kitchenDb]) {
      expect(code(await db.rpc('update_ordering_settings', { p_settings: toPayload(original) })) === 'forbidden', 'ayar yazıldı')
      expect((await db.from('fulfillment_settings').update({ accepting_orders: false }).eq('id', 1)).error, 'doğrudan ayar yazıldı')
      expect((await db.from('delivery_zones').update({ fee_cents: 1 }).neq('fee_cents', -1).select('id')).data?.length === 0, 'ücret değişti')
      expect((await db.from('delivery_zones').insert({ name: 'Sızma', postal_codes: ['99998'], fee_cents: 1 })).error, 'bölge eklendi')
      expect(code(await db.rpc('upsert_staff_profile', { p_user_id: randomUUID(), p_display_name: 'x', p_role: 'admin' })) === 'forbidden', 'personel atandı')
      expect((await db.from('order_fulfillments').select('street')).data.length === 0, 'müşteri bilgisi okundu')
      expect((await db.from('audit_log').select('id')).data.length === 0, 'denetim kaydı okundu')
    }
    expect((await waiterDb.from('table_qr_tokens').select('token')).data.length === 0, 'garson QR gördü')
    expect((await anon.rpc('update_ordering_settings', { p_settings: toPayload(original) })).error, 'anonim ayar yazdı')
    expect((await anon.from('fulfillment_settings').select('*')).error, 'anonim ayar okudu')
    expect((await admin.from('fulfillment_settings').update({ accepting_orders: false }).eq('id', 1)).error, 'yönetici RPC dışında yazdı')
  })

  await step('Yönetici: giriş panele açılır; tüm bölümler ve mutfak bağlantısı çalışır, mevcut menü yönetimi korunur', async () => {
    await login(adminPage, creds.admin)
    await adminPage.until(`document.querySelector('.ad-stats')`, 'panel kartları')
    await adminPage.shot('admin-dashboard-1366')
    const links = await adminPage.ev(`[...document.querySelectorAll('.ad-nav a')].map(a=>a.innerText)`)
    expect(links.join('|') === 'Panel|Menü|Siparişler|Masalar|Teslimat|Sipariş Ayarları|Personel|Mutfak Ekranı', `menü: ${links}`)
    await adminPage.go('/admin/menu')
    await adminPage.until(`document.querySelector('.stats-grid')&&document.querySelector('.admin-tabs')`, 'mevcut menü yönetimi')
    await adminPage.until(`/10[45]/.test(document.querySelector('.stats-grid').innerText)`, 'ürün sayısı')
    expect(!await adminPage.ev(`!!document.querySelector('.admin-header')`), 'çift başlık')
    await adminPage.shot('admin-menu-1366')
    await adminPage.clickText('Mutfak Ekranı', '.ad-nav a')
    await adminPage.until(`location.pathname.endsWith('/mutfak')&&document.querySelector('.kt-board')`, 'mutfak ekranı aynı oturumla')
    await adminPage.go('/siparisler')
    await adminPage.until(`document.querySelector('.ff-page .ff-board')`, 'mevcut paket ekranı')
    await adminPage.go('/admin/olmayan')
    await adminPage.until(`location.pathname.endsWith('/admin')&&document.querySelector('.ad-stats')`, 'bilinmeyen bölüm')
  })

  await step('Panel: sipariş sayımı gerçek veriyle güncellenir, Realtime ile yenilenir; siparişler bölümünde müşteri bilgisi yok', async () => {
    await adminPage.go('/admin')
    await adminPage.until(`document.querySelector('.ad-stat strong')`, 'kartlar')
    const read = () => adminPage.ev(`Number(document.querySelector('.ad-stat strong').innerText)`)
    const before = await read()
    const { data, error } = await anon.rpc('place_online_order', orderArgs())
    expect(!error, error?.message)
    await adminPage.until(`Number(document.querySelector('.ad-stat strong').innerText)===${before + 1}`, 'sayaç yenilemeden arttı', 10000)
    await adminPage.go('/admin/siparisler')
    await adminPage.until(`document.querySelector('.ad-order[data-order="${data.order_number}"]')`, 'sipariş listede')
    const text = await adminPage.ev(`document.querySelector('.ad-order[data-order="${data.order_number}"]').innerText`)
    expect(/PAKET/.test(text) && /Latte/i.test(text), `satır: ${text}`)
    expect(!(await adminPage.ev('document.body.innerText')).includes('Kurgusal Müşteri'), 'siparişler bölümünde müşteri adı')
    await admin.rpc('update_order_status', { p_order_id: data.order_id, p_status: 'cancelled', p_reason: 'test' })
  })

  await step('Ayar: paket kapatılınca kart kalkar, doğrudan istek sunucuda reddedilir; açılınca döner', async () => {
    await adminPage.go('/admin/ayarlar')
    await toggle(adminPage, 'set-pickup', false)
    await adminPage.shot('admin-settings-1366')
    await saveSettings(adminPage)
    expect((await config()).pickup === false, 'yapılandırma')
    expect(code(await anon.rpc('place_online_order', orderArgs())) === 'channel_closed', 'sunucu reddetmedi')
    await newVisit(customer)
    await enterMenu(customer)
    await customer.until(`document.querySelector('.qr-channels')`, 'seçim')
    expect(!await customer.ev(`!!document.querySelector('[data-channel="pickup"]')`), 'kapalı kanal göründü')
    expect(await customer.ev(`!!document.querySelector('[data-channel="delivery"]')`), 'açık kanal kayboldu')
    await toggle(adminPage, 'set-pickup', true)
    await adminPage.click('.ad-settings-save')
    await sleep(1200)
    expect((await config()).pickup === true, 'geri açılmadı')
  })

  await step('Ayar: otomatik sorma kapalıysa pencere açılmaz, menü düğmesi çalışır', async () => {
    await toggle(adminPage, 'set-auto', false)
    await adminPage.click('.ad-settings-save')
    await sleep(1200)
    expect((await config()).auto_open === false, 'yapılandırma')
    await newVisit(customer)
    await enterMenu(customer)
    await sleep(1500)
    expect(!await customer.ev(`!!document.querySelector('.qr-sheet')`), 'pencere açıldı')
    await customer.click('.qr-channel-chip')
    await customer.until(`document.querySelector('.qr-channels')`, 'düğmeyle seçim')
    await toggle(adminPage, 'set-auto', true)
    await adminPage.click('.ad-settings-save')
    await sleep(1200)
  })

  await step('Ayar: sipariş alımı kapalı → genel menü salt, masa QR kapalı, doğrudan istek reddedilir; garson sürer; panel uyarır', async () => {
    await toggle(adminPage, 'set-accepting', false)
    await adminPage.click('.ad-settings-save')
    await sleep(1200)
    expect((await config()).blocked === 'ordering_closed', 'yapılandırma')
    expect(code(await anon.rpc('place_online_order', orderArgs())) === 'ordering_closed', 'çevrimiçi sipariş alındı')
    expect(code(await anon.rpc('place_qr_order', { p_table_token: tokens['Masa 6'], p_idempotency_key: randomUUID(), p_items: [{ menu_item_id: COFFEE, quantity: 1 }] })) === 'ordering_closed', 'QR sipariş alındı')
    await newVisit(customer)
    await enterMenu(customer)
    await customer.until(`document.querySelector('.editorial-card')`, 'menü')
    await sleep(1200)
    expect(!await customer.ev(`!!document.querySelector('.qr-sheet,.qr-add,.qr-channel-chip')`), 'kapalıyken sipariş arayüzü')
    await enterMenu(customer, `/masa/${tokens['Masa 6']}`)
    await customer.until(`document.querySelector('.qr-banner')?.innerText.includes('kapalı')`, 'masa kapalı uyarısı')
    expect(!await customer.ev(`!!document.querySelector('.qr-add')`), 'masada sipariş düğmesi')
    const table = (await waiterDb.from('restaurant_tables').select('id').eq('label', 'Masa 6').single()).data
    const staffOrder = await waiterDb.rpc('place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: [{ menu_item_id: COFFEE, quantity: 1 }], p_note: 'TEST admin' })
    expect(!staffOrder.error, `garson siparişi: ${staffOrder.error?.message}`)
    await adminPage.go('/admin')
    await adminPage.until(`document.querySelector('.ad-blocked')?.innerText.includes('Sipariş alımı kapalı')`, 'panel uyarısı')
    await admin.rpc('update_order_status', { p_order_id: staffOrder.data.order_id, p_status: 'cancelled', p_reason: 'test' })
    const bill = (await waiterDb.from('bill_summaries').select('session_id').eq('table_id', table.id).eq('status', 'open').single()).data
    await admin.rpc('close_table_session', { p_session_id: bill.session_id, p_force: true })
    expect(!(await restore()).error, 'geri yükleme')
  })

  await step('Ayar: çalışma saati dışında sipariş reddedilir; sıfırlanınca açılır; hatalı saat kaydedilmez', async () => {
    await adminPage.go('/admin/ayarlar')
    await toggle(adminPage, 'set-hours', true)
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }))
    const other = (now.getDay() + 3) % 7
    for (let day = 0; day < 7; day++) {
      const box = `.ad-day[data-day="${day}"] input[type=checkbox]`
      const wanted = day === other
      if (await adminPage.ev(`document.querySelector('${box}').checked`) !== wanted) await adminPage.click(box)
    }
    await adminPage.click('.ad-settings-save')
    await sleep(1200)
    expect((await config()).blocked === 'outside_hours', `yapılandırma: ${(await config()).blocked}`)
    expect(code(await anon.rpc('place_online_order', orderArgs())) === 'outside_hours', 'saat dışı sipariş alındı')
    await adminPage.type(`.ad-day[data-day="${other}"] input[type=time]:nth-of-type(1)`, '10:00')
    await adminPage.ev(`(()=>{const [a,b]=document.querySelectorAll('.ad-day[data-day="${other}"] input[type=time]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(a,'10:00');a.dispatchEvent(new Event('input',{bubbles:true}));set.call(b,'10:00');b.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await adminPage.click('.ad-settings-save')
    await adminPage.until(`document.body.innerText.includes('farklı olmalı')`, 'saat doğrulaması', 5000)
    expect(!(await restore()).error, 'geri yükleme')
    expect((await config()).blocked === null, 'geri yüklenmedi')
  })

  const zoneName = 'E2E Test Bölgesi'
  await step('Teslimat: bölge eklenir, ücret düzenlenir ve kapatılır; müşteri sorgusu ve sipariş buna uyar; hatalı kod reddedilir', async () => {
    await adminPage.go('/admin/teslimat')
    await adminPage.until(`document.querySelector('#new-zone-name')&&document.querySelector('.ad-zone')`, 'bölge listesi')
    const exists = await adminPage.ev(`!!document.querySelector('[data-zone="${zoneName}"]')`)
    if (!exists) {
      await adminPage.type('#new-zone-postal', '12')
      await adminPage.type('#new-zone-name', zoneName)
      await adminPage.type('#new-zone-fee', '45,50')
      await adminPage.click('.ad-zone-form .ad-zone-save')
      await adminPage.until(`document.body.innerText.includes('5 haneli')`, 'posta kodu uyarısı', 5000)
      await adminPage.type('#new-zone-postal', '99200')
      await adminPage.click('.ad-zone-form .ad-zone-save')
      await adminPage.until(`document.querySelector('[data-zone="${zoneName}"]')`, 'yeni bölge', 8000)
    } else if (await adminPage.ev(`document.querySelector('[data-zone="${zoneName}"]').classList.contains('inactive')`)) {
      await adminPage.click(`[data-zone="${zoneName}"] .ad-zone-toggle`)
      await adminPage.until(`!document.querySelector('[data-zone="${zoneName}"]').classList.contains('inactive')`, 'bölge açıldı', 8000)
    }
    const newFee = randomInt(50, 90)
    const quote = async () => (await anon.rpc('check_delivery_address', { p_postal_code: '99200', p_district: 'Herhangi' })).data
    expect((await quote()).in_area === true, 'bölge sorgusu')
    await adminPage.click(`[data-zone="${zoneName}"] .ad-zone-edit`)
    await adminPage.until(`document.querySelector('[data-zone="${zoneName}"] form')`, 'düzenleme')
    await adminPage.ev(`(()=>{const e=[...document.querySelectorAll('[data-zone="${zoneName}"] input')].find(i=>i.id.endsWith('-fee'));Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${newFee}');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await adminPage.click(`[data-zone="${zoneName}"] .ad-zone-save`)
    await adminPage.until(`!document.querySelector('[data-zone="${zoneName}"] form')`, 'kaydedildi', 8000)
    expect(Number((await quote()).fee_cents) === newFee * 100, `ücret ${(await quote()).fee_cents}`)
    await adminPage.shot('admin-delivery-1366')
    expect(await adminPage.ev(`!!document.querySelector('.ff-board')`), 'paket ve kurye panosu yok')
    // Aynı kodlu bölge açılamaz: yanlış ücret riski.
    await adminPage.type('#new-zone-name', 'Çakışan'); await adminPage.type('#new-zone-postal', '99200'); await adminPage.type('#new-zone-fee', '1')
    await adminPage.click('form.ad-zone-form:last-of-type .ad-zone-save')
    await adminPage.until(`document.body.innerText.includes('başka bir açık bölgede')`, 'çakışma uyarısı', 5000)
    expect(!await adminPage.ev(`!!document.querySelector('[data-zone="Çakışan"]')`), 'çakışan bölge eklendi')
    await adminPage.type('#new-zone-name', ''); await adminPage.type('#new-zone-postal', ''); await adminPage.type('#new-zone-fee', '')
    await adminPage.click(`[data-zone="${zoneName}"] .ad-zone-toggle`)
    await adminPage.until(`document.querySelector('[data-zone="${zoneName}"]').classList.contains('inactive')`, 'bölge kapandı', 8000)
    expect((await quote()).in_area === false, 'kapalı bölge açık')
    expect(code(await anon.rpc('place_online_order', orderArgs({ p_fulfillment_type: 'delivery', p_address: { street: 'Kurgusal Cadde 1', district: 'Herhangi', postal_code: '99200' }, p_items: [{ menu_item_id: COFFEE, quantity: 5 }] }))) === 'out_of_area', 'kapalı bölgeye sipariş')
  })

  await step('Masalar: QR görüntüsü üretilir; masa eklenir, kod yenilenince eski kod geçersiz olur; devre dışı masa reddedilir; açık adisyon zorla kapatılır', async () => {
    await adminPage.go('/admin/masalar')
    await adminPage.until(`document.querySelector('[data-table="Masa 5"]')`, 'masalar')
    await adminPage.click('[data-table="Masa 5"] .ad-qr-open')
    await adminPage.until(`document.querySelector('.ad-qr')?.naturalWidth>0`, 'QR görüntüsü')
    await adminPage.shot('admin-qr-1366')
    await adminPage.click('.ad-dialog .pos-icon-btn')
    const label = `E2E Masa ${randomInt(1000, 9999)}`
    await adminPage.type('#ad-new-table', label)
    await adminPage.click('.ad-add-table')
    await adminPage.until(`document.querySelector('[data-table="${label}"]')`, 'yeni masa', 8000)
    const row = (await admin.from('restaurant_tables').select('id').eq('label', label).single()).data
    const token = async () => (await admin.from('table_qr_tokens').select('token').eq('table_id', row.id).single()).data.token
    const first = await token()
    expect((await anon.rpc('get_qr_table', { p_table_token: first })).data?.table_label === label, 'yeni masa kodu')
    await adminPage.click(`[data-table="${label}"] .ad-qr-open`)
    await adminPage.until(`document.querySelector('.ad-rotate')`, 'yenile düğmesi')
    await adminPage.click('.ad-rotate')
    const end = Date.now() + 8000
    while (Date.now() < end && await token() === first) await sleep(200)
    const second = await token()
    expect(second !== first, 'kod yenilenmedi')
    expect(code(await anon.rpc('get_qr_table', { p_table_token: first })) === 'invalid_table', 'eski kod çalıştı')
    await adminPage.click('.ad-dialog .pos-icon-btn')
    const placed = await anon.rpc('place_qr_order', { p_table_token: second, p_idempotency_key: randomUUID(), p_items: [{ menu_item_id: COFFEE, quantity: 1 }], p_note: 'TEST admin' })
    expect(!placed.error, placed.error?.message)
    await adminPage.until(`document.querySelector('[data-table="${label}"] .ad-force-close')`, 'açık adisyon', 25000)
    await admin.rpc('update_order_status', { p_order_id: placed.data.order_id, p_status: 'cancelled', p_reason: 'test' })
    await adminPage.click(`[data-table="${label}"] .ad-force-close`)
    await adminPage.until(`!document.querySelector('[data-table="${label}"] .ad-force-close')`, 'zorla kapatıldı', 10000)
    await adminPage.click(`[data-table="${label}"] .ad-toggle-table`)
    await adminPage.until(`document.querySelector('[data-table="${label}"]').classList.contains('inactive')`, 'devre dışı', 8000)
    expect(code(await anon.rpc('get_qr_table', { p_table_token: second })) === 'invalid_table', 'devre dışı masa çalıştı')
    const log = await admin.from('audit_log').select('action').eq('entity_id', row.id).eq('action', 'table.rotate_qr')
    expect(log.data.length === 1, 'denetim kaydı')
  })

  await step('Personel: kendi hesabı kilitlenemez; rol değişince yetki hemen değişir; erişim kapatılınca sunucu reddeder; geri alınır', async () => {
    await adminPage.go('/admin/personel')
    await adminPage.until(`document.querySelectorAll('.ad-person').length>=3`, 'personel')
    expect(await adminPage.ev(`document.querySelector('[data-person="Staging Yönetici"] .ad-role').disabled`), 'kendi rolü açık')
    await adminPage.shot('admin-staff-1366')
    const roleNow = async () => (await kitchenDb.rpc('pos_current_role')).data
    const setRole = value => adminPage.ev(`(()=>{const e=document.querySelector('[data-person="Staging Mutfak"] .ad-role');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'${value}');e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    try {
      await setRole('cashier')
      for (let i = 0; i < 40 && await roleNow() !== 'cashier'; i++) await sleep(200)
      expect(await roleNow() === 'cashier', 'rol değişmedi')
      await setRole('kitchen')
      for (let i = 0; i < 40 && await roleNow() !== 'kitchen'; i++) await sleep(200)
      await adminPage.until(`!document.querySelector('[data-person="Staging Mutfak"] .ad-role').disabled`, 'hazır')
      await adminPage.click('[data-person="Staging Mutfak"] .ad-person-toggle')
      for (let i = 0; i < 40 && await roleNow() !== null; i++) await sleep(200)
      expect(await roleNow() === null, 'erişim kapanmadı')
      expect(code(await kitchenDb.rpc('update_order_status', { p_order_id: randomUUID(), p_status: 'ready' })) === 'forbidden', 'pasif hesap işlem yaptı')
    } finally {
      const row = (await admin.from('staff_profiles').select('user_id').eq('display_name', 'Staging Mutfak').single()).data
      await admin.rpc('upsert_staff_profile', { p_user_id: row.user_id, p_display_name: 'Staging Mutfak', p_role: 'kitchen', p_is_active: true })
    }
    expect(await roleNow() === 'kitchen', 'geri alınmadı')
  })

  await step('Yerleşim: tüm bölümler 320 px, telefon, tablet ve masaüstünde taşmaz; gezinme erişilebilir', async () => {
    for (const [width, height] of [[320, 640], [390, 844], [820, 1180], [1366, 900]]) {
      await adminPage.size(width, height)
      for (const section of SECTIONS) {
        await adminPage.go(section ? `/admin/${section}` : '/admin')
        await adminPage.until(`document.querySelector('.ad-nav')&&!document.querySelector('.ad-main .spinner')${section === 'teslimat' ? "&&document.querySelector('.ff-board')&&document.querySelector('.ad-zone')" : ''}`, `${section} yüklendi`)
        await sleep(350)
        const over = await adminPage.overflow()
        expect(over === 0, `${width}px ${section || 'panel'}: ${over}px taşma`)
        const nav = await adminPage.ev(`(()=>{const a=document.querySelector('.ad-nav a');const r=a.getBoundingClientRect();return r.height})()`)
        expect(nav >= 44, `${width}px gezinme yüksekliği ${nav}`)
        if (width <= 390) await adminPage.shot(`admin-${section || 'panel'}-${width}`)
      }
    }
    await adminPage.size(1366, 900)
  })

  await step('Yalıtım: panel yalnızca staging projesine bağlandı', async () => {
    const supabaseHosts = [...hosts].filter(host => host.includes('supabase'))
    expect(!supabaseHosts.some(host => host.includes(PRODUCTION_REF)), `üretime istek: ${supabaseHosts}`)
    expect(supabaseHosts.length === 1 && supabaseHosts[0].startsWith(STAGING_REF), `beklenmeyen: ${supabaseHosts}`)
    return supabaseHosts[0]
  })

  console.log(results.join('\n'))
  const unique = [...new Set(errorsSeen)]
  console.log('Yakalanmamış hatalar:', unique.length ? unique.slice(0, 6).join('\n  ') : 'yok')
  if (unique.length) failed++
} finally {
  // Hata olsa da ayarlar başlangıç haline döner.
  const restored = await restore()
  const now = (await admin.from('fulfillment_settings').select('*').eq('id', 1).single()).data
  console.log(`Ayarlar geri yüklendi: ${!restored.error && now.accepting_orders === original.accepting_orders && now.pickup_enabled === original.pickup_enabled ? 'evet' : 'HAYIR'}`)
  browsers.forEach(browser => browser.kill())
  await sleep(500)
  temps.forEach(temp => { try { rmSync(temp, { recursive: true, force: true }) } catch { /* Chrome dosyayı henüz bırakmamış olabilir. */ } })
}
console.log(`\n${results.filter(r => r.startsWith('OK')).length} geçti, ${failed} kaldı`)
process.exit(failed ? 1 : 0)
