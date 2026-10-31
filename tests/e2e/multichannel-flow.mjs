// Masa, paket ve kurye akışının gerçek staging tarayıcı testi (npm run test:e2e:multichannel). Önce `npm run dev:staging`.
// Her rol ayrı Chrome profilindedir ama aynı bilgisayardadır: fiziksel cihaz testi değildir. Kurgusal veri kullanır.
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
const tokens = JSON.parse(readFileSync(new URL('.staging-qr.local', root), 'utf8'))
const creds = JSON.parse(readFileSync(new URL('.staging-credentials.local', root), 'utf8'))

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const errorsSeen = [], hosts = new Set(), browsers = [], temps = []
let nextPort = 9360

async function openPage() {
  const port = nextPort++
  const temp = mkdtempSync(join(tmpdir(), 'waypoint-channel-'))
  temps.push(temp)
  browsers.push(spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${temp}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' }))
  for (let i = 0; i < 60; i++) { if (await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.ok).catch(() => false)) break; await sleep(250) }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json())
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => { ws.onopen = resolve })
  let id = 0
  const waiting = new Map(), paused = []
  ws.onmessage = event => {
    const m = JSON.parse(event.data)
    if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') errorsSeen.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if (m.method === 'Network.requestWillBeSent') { const host = /^https?:\/\/([^/]+)/.exec(m.params.request.url)?.[1]; if (host) hosts.add(host) }
    if (m.method === 'Fetch.requestPaused') paused.forEach(handler => handler(m.params))
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
    cdp, ev, onPaused: handler => paused.push(handler),
    size: (width, height) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 1000 }),
    go: path => cdp('Page.navigate', { url: BASE + path }),
    until: async (expression, label, ms = 25000) => {
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

const enterMenu = async (page, path) => {
  await page.go(path)
  await page.until(`[...document.querySelectorAll('button')].some(b=>b.innerText.includes('MENÜYÜ KEŞFET'))`, 'karşılama ekranı')
  await page.clickText('MENÜYÜ KEŞFET')
  await page.until(`document.querySelector('.menu-search')&&!document.querySelector('.hero-viewport')`, 'menü')
  // Gerçek müşteri gibi tanıtım penceresini kapat; o açıkken sipariş sayfası üst üste binmemeli.
  await sleep(1200)
  if (await page.ev(`!!document.querySelector('.promotion-close')`)) {
    expect(!await page.ev(`!!document.querySelector('.qr-sheet')`), 'tanıtım ve sipariş sayfası üst üste bindi')
    await page.click('.promotion-close')
    await page.until(`!document.querySelector('.promotion-close')`, 'tanıtım kapandı')
  }
}
const cardOf = name => `[...document.querySelectorAll('.editorial-card')].find(c=>c.querySelector('.editorial-card-title')?.innerText.toLocaleLowerCase('tr')===${JSON.stringify(name.toLocaleLowerCase('tr'))})`
const openProduct = async (page, name) => {
  await page.type('.menu-search', name)
  await page.until(cardOf(name), `${name} kartı`)
  await page.ev(`${cardOf(name)}.click()`)
  await page.until(`document.querySelector('.modal-sheet [id="product-modal-title"]')`, 'ürün penceresi')
}
// Ürün → adet → Sepeti Gör: düğme ekranda ve en üstte olmalı; basınca pencere kapanıp sepet açılmalı.
const continueToCart = async (page, totalPattern) => {
  await page.until(`document.querySelector('.qr-continue')`, 'Sepeti Gör düğmesi', 5000)
  await sleep(300)
  const box = await page.ev(`(()=>{const b=document.querySelector('.qr-continue');const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,w:innerWidth,h:innerHeight,onTop:b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),text:b.innerText}})()`)
  expect(box.onTop, 'düğme başka katmanın arkasında')
  expect(box.bottom <= box.h && box.top >= 0 && box.left >= 0 && box.right <= box.w, `düğme ekran dışında: ${JSON.stringify(box)}`)
  expect(box.height >= 44, `düğme yüksekliği ${box.height}`)
  expect(/Sepeti Gör/i.test(box.text) && totalPattern.test(box.text), `düğme metni: ${box.text}`)
  await page.click('.qr-continue')
  await page.until(`document.querySelector('.qr-sheet .qr-send')&&!document.querySelector('[id="product-modal-title"]')`, 'sepet açıldı', 5000)
  expect(await page.ev(`document.querySelectorAll('.modal-sheet').length`) === 1, 'pencereler üst üste')
  expect(await page.ev('document.body.style.overflow') === 'hidden', 'kaydırma kilidi')
}
const addProduct = async (page, name, expectedCount) => {
  await page.type('.menu-search', name)
  const card = `[...document.querySelectorAll('.editorial-card')].find(c=>c.querySelector('.editorial-card-title')?.innerText.toLocaleLowerCase('tr')===${JSON.stringify(name.toLocaleLowerCase('tr'))})`
  await page.until(`${card}?.querySelector('.qr-add')`, `${name} ekleme düğmesi`)
  await page.ev(`${card}.querySelector('.qr-add').click()`)
  await page.until(`document.querySelector('.qr-bar-count')?.innerText==='${expectedCount}'`, `sepette ${expectedCount}`)
}
const login = async (page, path, { email, password }) => {
  await page.go(path)
  await page.until(`document.querySelector('#staff-email')`, 'giriş formu')
  await page.type('#staff-email', email)
  await page.type('#staff-password', password)
  await page.click('.login-btn')
}
const ticketOf = number => `[...document.querySelectorAll('.kt-ticket')].find(t=>t.querySelector('.kt-ticket-number')?.innerText==='#${number}'&&t.offsetParent)`
const NAME = 'Kurgusal Müşteri', PHONE = `0555${randomInt(1000000, 9999999)}`, STREET = `Kurgusal Gizli Sokak ${randomInt(1000, 9999)}`
const PICKUP_PHONE = `0555${randomInt(1000000, 9999999)}`
const orders = {}

try {
  const customer = await openPage(), kitchen = await openPage(), staffPage = await openPage(), waiter = await openPage()
  await customer.size(390, 844); await kitchen.size(1366, 900); await staffPage.size(1366, 900); await waiter.size(390, 844)
  await login(kitchen, '/mutfak', creds.kitchen)
  await kitchen.until(`document.querySelector('.kt-board')`, 'mutfak panosu')

  await step('Genel menü: üç kanal kartı açılır, masa seçimi paket ve kurye için zorunlu değildir', async () => {
    await enterMenu(customer, '/')
    await customer.until(`document.querySelectorAll('.qr-channel').length===3`, 'üç kanal kartı')
    await customer.shot('channels-390')
    await customer.click('[data-channel="dine_in"]')
    await customer.until(`document.querySelector('.qr-scan-note')`, 'QR yönergesi')
    expect(!await customer.ev(`!!document.querySelector('.qr-add')`), 'QR olmadan masa siparişi açıldı')
    expect(await customer.overflow() === 0, 'taşma')
  })

  await step('Kanal seçilmeden ürün açılınca sonraki adım gösterilir, seçim sayfasına gider', async () => {
    await customer.clickText('Yalnızca menüye göz at')
    await customer.until(`!document.querySelector('.qr-sheet')`, 'sayfa kapandı')
    await openProduct(customer, 'Americano')
    await customer.until(`document.querySelector('.qr-continue-channel')`, 'tür seçme düğmesi')
    expect(!await customer.ev(`!!document.querySelector('.qr-continue')`), 'sepet düğmesi erken çıktı')
    await customer.click('.qr-continue-channel')
    await customer.until(`document.querySelectorAll('.qr-channel').length===3&&!document.querySelector('[id="product-modal-title"]')`, 'kanal kartları')
  })

  await step('Paket: Ürün → Adet → Sepeti Gör → form doğrulanır, çift dokunuş tek sipariş, ücret eklenmez', async () => {
    await customer.click('[data-channel="pickup"]')
    await customer.until(`!document.querySelector('.qr-sheet')`, 'sayfa kapandı')
    await customer.until(`document.querySelector('.qr-channel-chip')?.innerText.includes('Paket')`, 'kanal etiketi')
    await openProduct(customer, 'Americano')
    await customer.until(`document.querySelector('.qr-add-wide')`, 'sepete ekle')
    expect(!await customer.ev(`!!document.querySelector('.qr-continue')`), 'boş sepette düğme çıktı')
    await customer.click('.qr-add-wide')
    await customer.until(`document.querySelector('.modal-sheet [aria-label="Artır"]')`, 'adet seçici')
    await customer.click('.modal-sheet [aria-label="Artır"]')
    await customer.until(`document.querySelector('.qr-continue')?.innerText.includes('260')`, 'güncel toplam')
    await customer.shot('product-continue-390')
    await continueToCart(customer, /260,00/)
    expect(/Americano/i.test(await customer.ev(`document.querySelector('.qr-line').innerText`)), 'sepette ürün yok')
    expect(!await customer.ev(`!!document.querySelector('#online-street')`), 'pakette adres soruldu')
    await customer.click('.qr-send')
    await customer.until(`document.querySelector('#online-name-error')&&document.querySelector('#online-phone-error')`, 'form hataları')
    expect(!await customer.ev(`!!document.querySelector('.qr-confirm')`), 'eksik formla sipariş')
    await customer.type('#online-name', NAME)
    await customer.type('#online-phone', PICKUP_PHONE)
    await customer.shot('pickup-checkout-390')
    const total = await customer.ev(`document.querySelector('.qr-total strong').innerText`)
    expect(/260/.test(total), `toplam ${total}`)
    await customer.ev(`(()=>{const b=document.querySelector('.qr-send');b.click();b.click()})()`)
    await customer.until(`document.querySelector('.qr-confirm')`, 'onay')
    orders.pickup = (await customer.ev(`document.querySelector('.qr-confirm-number').innerText`)).slice(1)
    orders.pickupLink = await customer.ev(`document.querySelector('.qr-track-link').getAttribute('href')`)
    await customer.shot('pickup-confirm-390')
    expect(/\/siparis\/[0-9a-f]{64}$/.test(orders.pickupLink), 'takip bağlantısı')
    await customer.clickText('Menüye dön', '.qr-confirm button')
    return `#${orders.pickup} ${total}`
  })

  await step('Mutfak: paket fişi yenilemeden gelir, etiketli ve masasızdır; müşteri bilgisi yok', async () => {
    await kitchen.until(ticketOf(orders.pickup), 'paket fişi', 12000)
    const label = await kitchen.ev(`${ticketOf(orders.pickup)}.querySelector('.kt-ticket-table').innerText`)
    expect(label === 'PAKET / GEL AL', `etiket ${label}`)
    const body = await kitchen.ev('document.body.innerText')
    expect(!body.includes(NAME) && !body.includes(PICKUP_PHONE), 'mutfakta kişisel veri')
  })

  await step('Kurye: varyantlı ürün → Sepeti Gör; sepet kanal değişiminde korunur; ücret bilinmeden gönderilemez; alan dışı ve asgari tutar engellenir', async () => {
    await customer.until(`!document.querySelector('.qr-sheet')`, 'sayfa kapandı')
    await openProduct(customer, 'Geleneksel Türk Kahvesi')
    const variant = `[...document.querySelectorAll('.modal-variant-row')].find(r=>r.querySelector('.modal-variant-name').innerText.toLocaleLowerCase('tr')==='türk kahvesi')`
    await customer.until(`${variant}?.querySelector('.qr-add')`, 'varyant ekleme düğmesi')
    await customer.ev(`${variant}.querySelector('.qr-add').click()`)
    await customer.shot('variant-continue-390')
    await continueToCart(customer, /80,00/)
    await customer.until(`document.querySelector('.qr-switch')`, 'değiştir düğmesi')
    await customer.click('.qr-switch')
    await customer.until(`document.querySelector('[data-channel="delivery"]')`, 'kanal kartları')
    await customer.click('[data-channel="delivery"]')
    await customer.until(`document.querySelector('#online-street')`, 'adres formu')
    expect(await customer.ev(`document.querySelectorAll('.qr-line').length`) === 1, 'sepet korunmadı')
    expect(await customer.ev(`document.querySelector('.qr-send').disabled`), 'ücretsiz gönderim açık')
    expect((await customer.ev(`document.querySelector('.qr-fee').innerText`)).includes('Adres doğrulanınca'), 'ücret uyduruldu')
    await customer.type('#online-name', NAME)
    await customer.type('#online-phone', PHONE)
    await customer.type('#online-street', STREET)
    await customer.type('#online-district', 'Deneme')
    await customer.type('#online-postalCode', '11111')
    await customer.until(`document.querySelector('.qr-out-of-area')`, 'alan dışı uyarısı', 8000)
    expect(await customer.ev(`document.querySelector('.qr-send').disabled`), 'alan dışına gönderim açık')
    await customer.shot('delivery-out-390')
    await customer.type('#online-postalCode', '99001')
    await customer.until(`document.querySelector('.qr-below-min')`, 'asgari tutar uyarısı', 8000)
    expect(await customer.ev(`document.querySelector('.qr-send').disabled`), 'asgari altı gönderim açık')
    await customer.click('.qr-line [aria-label="Artır"]')
    await customer.until(`!document.querySelector('.qr-below-min')&&!document.querySelector('.qr-send').disabled`, 'gönderim açıldı', 8000)
    const fee = await customer.ev(`document.querySelector('.qr-fee').innerText`)
    const total = await customer.ev(`document.querySelector('.qr-total strong').innerText`)
    expect(/30,00/.test(fee) && /190,00/.test(total), `ücret ${fee}, toplam ${total}`)
    await customer.type('#online-building', '3')
    await customer.type('#online-instructions', 'Kurgusal teslimat notu')
    await customer.shot('delivery-checkout-390')
    return `160,00 + 30,00 = ${total}`
  })

  await step('Kurye: yanıt kopsa da tek sipariş; toplam sunucudan gelir', async () => {
    customer.onPaused(params => customer.cdp('Fetch.failRequest', { requestId: params.requestId, errorReason: 'ConnectionReset' }))
    await customer.cdp('Fetch.enable', { patterns: [{ urlPattern: '*place_online_order*', requestStage: 'Response' }] })
    await customer.click('.qr-send')
    await customer.until(`document.querySelector('.qr-uncertain')`, 'belirsiz uyarı')
    expect(!await customer.ev(`!!document.querySelector('.qr-confirm')`), 'yanıtsız başarı')
    await customer.cdp('Fetch.disable')
    await customer.clickText('Durumu kontrol et')
    await customer.until(`document.querySelector('.qr-confirm')`, 'onay')
    orders.delivery = (await customer.ev(`document.querySelector('.qr-confirm-number').innerText`)).slice(1)
    orders.deliveryLink = await customer.ev(`document.querySelector('.qr-track-link').getAttribute('href')`)
    expect(/190,00/.test(await customer.ev(`document.querySelector('.qr-confirm-total').innerText`)), 'onay toplamı')
    await customer.shot('delivery-confirm-390')
    return `#${orders.delivery}`
  })

  await step('Mutfak: kurye fişinde etiket, ürün ve adet var; adres, ad ve telefon yok', async () => {
    await kitchen.until(ticketOf(orders.delivery), 'kurye fişi', 12000)
    const text = await kitchen.ev(`${ticketOf(orders.delivery)}.innerText`)
    expect(text.includes('KURYE / TESLİMAT') && text.includes('2×') && /Türk Kahvesi/i.test(text), `fiş: ${text}`)
    const body = await kitchen.ev('document.body.innerText')
    for (const secret of [STREET, NAME, PHONE, 'Kurgusal teslimat notu']) expect(!body.includes(secret), `mutfakta sızıntı: ${secret}`)
    // Önceki siparişlerin servis edilen fişleri görünür kalır; bu siparişin fişi sayılır.
    const tally = await kitchen.ev(`[...document.querySelectorAll('.kt-ticket-number')].filter(n=>n.innerText==='#${orders.delivery}').length`)
    expect(tally === 1, `çift kurye fişi: ${tally}`)
  })

  await step('Masa QR: Ürün → Adet → Sepeti Gör; masa seçili açılır, fiş "MASA 5" ve adisyona eklenir; garson görür', async () => {
    await enterMenu(customer, `/masa/${tokens['Masa 5']}`)
    await customer.until(`document.querySelector('.qr-table-chip')?.innerText.includes('Masa 5')`, 'masa etiketi')
    await customer.until(`document.querySelector('.qr-other-channels')`, 'diğer kanallara bağlantı')
    await openProduct(customer, 'Limonata')
    await customer.until(`document.querySelector('.qr-add-wide')`, 'sepete ekle')
    await customer.click('.qr-add-wide')
    await continueToCart(customer, /50,00/)
    expect(!await customer.ev(`!!document.querySelector('#online-name')`), 'masa siparişinde kişisel bilgi soruldu')
    await customer.click('.qr-send')
    await customer.until(`document.querySelector('.qr-confirm')`, 'onay')
    orders.dine = (await customer.ev(`document.querySelector('.qr-confirm-number').innerText`)).slice(1)
    await kitchen.until(ticketOf(orders.dine), 'masa fişi', 12000)
    const label = await kitchen.ev(`${ticketOf(orders.dine)}.querySelector('.kt-ticket-table').innerText`)
    expect(label === 'MASA 5', `etiket ${label}`)
    await kitchen.shot('kitchen-types-1366')
    await login(waiter, '/garson', creds.waiter)
    await waiter.until(`[...document.querySelectorAll('.wt-table-card')].find(c=>c.innerText.includes('Masa 5'))?.classList.contains('occupied')`, 'garsonda dolu masa')
    await waiter.ev(`[...document.querySelectorAll('.wt-table-card')].find(c=>c.innerText.includes('Masa 5')).click()`)
    await waiter.until(`document.querySelector('.wt-bill-btn')`, 'masa görünümü')
    await waiter.click('.wt-bill-btn')
    await waiter.until(`document.querySelector('.wt-bill')?.innerText.toLocaleLowerCase('tr').includes('limonata')`, 'masa adisyonunda ürün')
    expect(/50,00/.test(await waiter.ev(`document.querySelector('.wt-bill-summary').innerText`)), 'adisyon toplamı')
    await waiter.go('/garson')
    await waiter.until(`document.querySelector('.wt-table-card')`, 'masalar')
    return `#${orders.dine}`
  })

  await step('Yetki: garson ve mutfak hesabı teslimat ekranına giremez', async () => {
    await login(staffPage, '/siparisler', creds.waiter)
    await staffPage.until(`document.querySelector('.pos-form-error')`, 'garson reddi')
    await login(staffPage, '/siparisler', creds.kitchen)
    await staffPage.until(`document.querySelector('.pos-form-error')`, 'mutfak reddi')
    expect(!await staffPage.ev(`document.body.innerText.includes(${JSON.stringify(STREET)})`), 'adres göründü')
  })

  const card = number => `document.querySelector('.ff-card[data-order="${number}"]')`
  await step('Yönetici: adres ve iletişim yalnızca burada; ayrı mutfak ve teslimat durumu görünür', async () => {
    await login(staffPage, '/siparisler', creds.admin)
    await staffPage.until(card(orders.delivery), 'kurye kartı')
    const text = await staffPage.ev(`${card(orders.delivery)}.textContent`)
    for (const part of [NAME, PHONE, STREET, 'Kurgusal teslimat notu', 'KURYE / TESLİMAT']) expect(text.includes(part), `kartta yok: ${part}`)
    expect(/Mutfak: Yeni/i.test(text) && /Mutfakta/i.test(text), `durumlar: ${text}`)
    expect(!await staffPage.ev(`!!${card(orders.delivery)}.querySelector('.ff-next')`), 'mutfak bitmeden teslim düğmesi açıldı')
    await staffPage.shot('fulfillment-1366')
  })

  await step('Mutfak Hazırlanıyor → Hazır: teslimat ekranı ve müşteri yenilemeden görür, mutfakta son adım yok', async () => {
    await kitchen.ev(`${ticketOf(orders.delivery)}.querySelector('.kt-action').click()`)
    await kitchen.until(`${ticketOf(orders.delivery)}.classList.contains('kt-ticket-preparing')`, 'hazırlanıyor')
    await staffPage.until(`${card(orders.delivery)}.closest('.ff-column-preparing')`, 'teslimatta hazırlanıyor', 10000)
    await kitchen.ev(`${ticketOf(orders.delivery)}.querySelector('.kt-action').click()`)
    await kitchen.until(`${ticketOf(orders.delivery)}.classList.contains('kt-ticket-ready')`, 'hazır')
    expect(!await kitchen.ev(`!!${ticketOf(orders.delivery)}.querySelector('.kt-action')`), 'mutfakta servis düğmesi kaldı')
    expect((await kitchen.ev(`${ticketOf(orders.delivery)}.innerText`)).includes('Kuryeye teslim bekliyor'), 'teslim notu yok')
    await staffPage.until(`${card(orders.delivery)}.closest('.ff-column-awaiting')`, 'teslimatta bekliyor', 10000)
  })

  await step('Kuryeye verildi yalnızca personel onayıyla; müşteri takip eder, ödeme kendiliğinden işlenmez', async () => {
    const tracker = await openPage()
    await tracker.size(390, 844)
    await tracker.go(orders.deliveryLink.replace('/waypoint', ''))
    await tracker.until(`document.querySelector('.qr-track-steps li.current')?.innerText.includes('Kurye bekleniyor')`, 'müşteride kurye bekleniyor')
    const page = await tracker.ev('document.body.innerText')
    for (const secret of [STREET, NAME, PHONE]) expect(!page.includes(secret), `takipte sızıntı: ${secret}`)
    expect(page.includes('Ödenmedi'), 'ödeme kendiliğinden işlendi')
    await tracker.shot('tracking-390')
    await staffPage.click(`.ff-card[data-order="${orders.delivery}"] .ff-next`)
    await sleep(600)
    expect(await staffPage.ev(`!!${card(orders.delivery)}.closest('.ff-column-awaiting')`), 'kurye adı olmadan verildi')
    await staffPage.type(`.ff-card[data-order="${orders.delivery}"] .ff-courier .input`, 'Kurgusal Kurye')
    await staffPage.click(`.ff-card[data-order="${orders.delivery}"] .ff-next`)
    await staffPage.until(`${card(orders.delivery)}.closest('.ff-column-out')`, 'kuryede', 10000)
    await kitchen.until(`${ticketOf(orders.delivery)}.classList.contains('kt-ticket-served')`, 'mutfakta servis sütunu', 10000)
    await tracker.until(`document.querySelector('.qr-track-steps li.current')?.innerText.includes('Kuryeye verildi')`, 'müşteride kuryeye verildi', 20000)
    expect(!(await tracker.ev('document.body.innerText')).includes('Kurgusal Kurye'), 'kurye adı müşteriye gösterildi')
    await staffPage.ev('window.confirm=()=>true')
    await staffPage.click(`.ff-card[data-order="${orders.delivery}"] .ff-pay-cash`)
    await staffPage.until(`${card(orders.delivery)}.innerText.includes('Ödendi (nakit)')`, 'ödeme kaydı', 10000)
    await staffPage.click(`.ff-card[data-order="${orders.delivery}"] .ff-next`)
    await staffPage.until(`${card(orders.delivery)}.closest('.ff-column-done')`, 'tamamlandı', 10000)
    await tracker.until(`document.querySelector('.qr-track-steps li.current')?.innerText.includes('Teslim edildi')&&document.body.innerText.includes('Ödendi')`, 'müşteride teslim edildi', 20000)
  })

  await step('Paket: mutfak hazır → müşteri teslim aldı; iptal yetkisi ve sayfa taşması', async () => {
    await kitchen.ev(`${ticketOf(orders.pickup)}.querySelector('.kt-action').click()`)
    await kitchen.until(`${ticketOf(orders.pickup)}.classList.contains('kt-ticket-preparing')`, 'hazırlanıyor')
    await kitchen.ev(`${ticketOf(orders.pickup)}.querySelector('.kt-action').click()`)
    await staffPage.until(`${card(orders.pickup)}.closest('.ff-column-awaiting')`, 'paket bekliyor', 10000)
    expect(!await staffPage.ev(`!!${card(orders.pickup)}.querySelector('.ff-courier')`), 'pakette kurye alanı')
    await staffPage.click(`.ff-card[data-order="${orders.pickup}"] .ff-next`)
    await staffPage.until(`${card(orders.pickup)}.closest('.ff-column-done')`, 'paket tamamlandı', 10000)
    for (const [width, height] of [[320, 640], [390, 844], [820, 1180], [1366, 900]]) {
      await staffPage.size(width, height); await sleep(200)
      expect(await staffPage.overflow() === 0, `teslimat ekranı ${width}px taşma`)
    }
    await staffPage.size(390, 844)
    await staffPage.shot('fulfillment-390')
  })

  await step('Garson bildirimi korunur: masa siparişi hazır olunca gelir, paket ve kurye gelmez', async () => {
    await waiter.until(`document.querySelector('.wt-bell')`, 'zil')
    await sleep(1000)
    const before = await waiter.ev(`document.querySelectorAll('.wt-notify-banner').length`)
    await kitchen.ev(`${ticketOf(orders.dine)}.querySelector('.kt-action').click()`)
    await kitchen.until(`${ticketOf(orders.dine)}.classList.contains('kt-ticket-preparing')`, 'hazırlanıyor')
    await kitchen.ev(`${ticketOf(orders.dine)}.querySelector('.kt-action').click()`)
    await waiter.until(`document.querySelectorAll('.wt-notify-banner').length===${before + 1}`, 'hazır uyarısı', 10000)
    const text = (await waiter.ev(`document.querySelector('.wt-notify-banner').innerText`)).toLocaleLowerCase('tr')
    expect(text.includes('masa 5') && text.includes('limonata'), `uyarı: ${text}`)
    await waiter.click('.wt-bell')
    await waiter.until(`document.querySelector('.wt-notify-panel')`, 'panel')
    const panel = await waiter.ev(`document.querySelector('.wt-notify-panel').innerText`)
    expect(!panel.includes('—  ') && !/^ — Siparişiniz/m.test(panel), 'masasız bildirim')
  })

  await step('Tüm katalog: her kategoride ürün görselleri /waypoint/ yolunda yüklenir, kırık görsel yok', async () => {
    await enterMenu(customer, '/')
    await customer.until(`document.querySelector('.qr-channel-chip')`, 'kanal düğmesi')
    const chips = await customer.ev(`document.querySelectorAll('.story-item').length`)
    expect(chips >= 8, `kategori sayısı ${chips}`)
    let checked = 0
    const broken = []
    for (let index = 0; index < chips; index++) {
      await customer.ev(`document.querySelectorAll('.story-item')[${index}].click()`)
      await sleep(500)
      await customer.ev(`(async()=>{for(const i of document.querySelectorAll('.editorial-card img')){i.loading='eager';if(!i.complete)await new Promise(r=>{i.onload=i.onerror=r;setTimeout(r,8000)})}})()`)
      const images = await customer.ev(`[...document.querySelectorAll('.editorial-card img')].map(i=>({src:i.currentSrc||i.src,ok:i.complete&&i.naturalWidth>0}))`)
      checked += images.length
      broken.push(...images.filter(image => !image.ok).map(image => image.src))
      expect(!images.some(image => image.src.includes(PRODUCTION_REF)), 'görsel üretimden yüklendi')
    }
    expect(!broken.length, `kırık görsel: ${broken.slice(0, 5).join(', ')}`)
    expect(checked >= 50, `yalnızca ${checked} görsel denetlendi`)
    // Fotoğrafı olmayan Oralet ürünleri grup olarak görünür; kapak yerel çözücüden gelir.
    await customer.type('.menu-search', 'Oralet')
    await customer.until(`${cardOf('Oralet')}?.querySelector('img')?.naturalWidth>0`, 'yerel görsel', 8000)
    expect((await customer.ev(`${cardOf('Oralet')}.querySelector('img').src`)).includes('/waypoint/images/oralet.jpg'), 'yerel görsel taban yolu')
    await customer.type('.menu-search', '')
    return `${checked} görsel denetlendi`
  })

  await step('Kanallar kapalıyken salt menü: ürün açılır, sipariş ve Sepeti Gör yoktur', async () => {
    const browse = await openPage()
    await browse.size(390, 844)
    browse.onPaused(params => browse.cdp('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' }))
    await browse.cdp('Fetch.enable', { patterns: [{ urlPattern: '*get_ordering_config*' }] })
    await enterMenu(browse, '/')
    await browse.until(`document.querySelector('.editorial-card')`, 'ürünler')
    await sleep(800)
    expect(!await browse.ev(`!!document.querySelector('.qr-add,.qr-bar,.qr-channel-chip,.qr-sheet')`), 'salt menüde sipariş arayüzü')
    await browse.click('.editorial-card')
    await browse.until(`document.querySelector('.modal-sheet-footer-note')`, 'personel notu')
    expect(!await browse.ev(`!!document.querySelector('.qr-continue,.qr-continue-channel,.qr-add-wide')`), 'salt menüde sepet düğmesi')
    await browse.cdp('Fetch.disable')
  })

  await step('Yerleşim: ürün penceresi ve ödeme adımı telefon, tablet ve masaüstünde taşmaz, düğme erişilebilir', async () => {
    await addProduct(customer, 'Latte', 1)
    for (const [width, height] of [[320, 568], [320, 640], [390, 844], [430, 932], [820, 1180], [1366, 900]]) {
      await customer.size(width, height); await sleep(250)
      expect(await customer.overflow() === 0, `${width}px menü taşması`)
      await openProduct(customer, 'Latte')
      await sleep(300)
      await customer.shot(`product-${width}`)
      await continueToCart(customer, /130,00/)
      await customer.click('.qr-sheet-head .pos-icon-btn')
      await customer.until(`!document.querySelector('.qr-sheet')`, 'kapandı')
      await customer.click('.qr-bar-cart')
      await customer.until(`document.querySelector('.qr-send')`, 'ödeme adımı')
      await sleep(350)
      const send = await customer.ev(`(()=>{const r=document.querySelector('.qr-send').getBoundingClientRect();return [r.left,r.right,r.bottom,r.height]})()`)
      expect(send[0] >= 0 && send[1] <= width && send[2] <= height && send[3] >= 44, `${width}px düğme: ${send}`)
      expect(await customer.ev(`(()=>{const s=document.querySelector('.qr-sheet');return s.scrollWidth<=s.clientWidth})()`), `${width}px sayfa taşması`)
      await customer.click('.qr-sheet-head .pos-icon-btn')
      await customer.until(`!document.querySelector('.qr-sheet')`, 'kapandı')
    }
    await customer.size(1366, 900)
    await customer.click('.qr-bar-cart')
    await customer.until(`document.querySelector('.qr-send')`, 'ödeme adımı')
    await customer.shot('checkout-1366')
  })

  await step('Yalıtım: uygulama yalnızca staging projesine bağlandı', async () => {
    const supabaseHosts = [...hosts].filter(host => host.includes('supabase'))
    expect(!supabaseHosts.some(host => host.includes(PRODUCTION_REF)), `üretime istek: ${supabaseHosts}`)
    expect(supabaseHosts.length === 1 && supabaseHosts[0].startsWith(STAGING_REF), `beklenmeyen: ${supabaseHosts}`)
    return supabaseHosts[0]
  })

  // Masa açık kalmasın: servis, ödeme ve normal kapatma.
  await step('Temizlik: Masa 5 servis edilip ödenerek normal yoldan kapatılır', async () => {
    const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    await db.auth.signInWithPassword(creds.waiter)
    const { data: table } = await db.from('restaurant_tables').select('id').eq('label', 'Masa 5').single()
    const { data: bill } = await db.from('bill_summaries').select('bill_id, session_id, balance_cents').eq('table_id', table.id).eq('status', 'open').single()
    const { data: open } = await db.from('orders').select('id').eq('bill_id', bill.bill_id).eq('status', 'ready')
    for (const order of open) await db.rpc('update_order_status', { p_order_id: order.id, p_status: 'served' })
    const paid = await db.rpc('record_payment', { p_bill_id: bill.bill_id, p_amount_cents: Number(bill.balance_cents), p_method: 'cash', p_idempotency_key: randomUUID() })
    expect(!paid.error, paid.error?.message)
    const closed = await db.rpc('close_table_session', { p_session_id: bill.session_id })
    expect(!closed.error, closed.error?.message)
  })

  console.log(results.join('\n'))
  const unique = [...new Set(errorsSeen)]
  console.log('Yakalanmamış hatalar:', unique.length ? unique.slice(0, 6).join('\n  ') : 'yok')
  if (unique.length) failed++
} finally {
  browsers.forEach(browser => browser.kill())
  await sleep(500)
  temps.forEach(temp => { try { rmSync(temp, { recursive: true, force: true }) } catch { /* Chrome dosyayı henüz bırakmamış olabilir. */ } })
}
console.log(`\n${results.filter(r => r.startsWith('OK')).length} geçti, ${failed} kaldı`)
process.exit(failed ? 1 : 0)
