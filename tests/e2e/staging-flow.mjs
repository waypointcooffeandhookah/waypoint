// Gerçek staging veritabanıyla tarayıcı testi (npm run test:e2e:staging). Önce `npm run dev:staging`.
// Her rol ayrı Chrome profili ve ayrı işlemde çalışır; yine de AYNI bilgisayardadır, fiziksel cihaz testi değildir.
// Ortam: E2E_BASE (ör. http://192.168.1.107:5173/waypoint → HTTPS olmayan, telefondaki koşulun aynısı).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STAGING_REF, PRODUCTION_REF } from '../../src/supabaseTarget.js'

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173/waypoint'
const BROWSER = [process.env.E2E_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome']
  .find(path => path && existsSync(path))
if (!BROWSER) { console.error('Chrome veya Edge bulunamadı.'); process.exit(2) }
const root = new URL('../../', import.meta.url)
const tokens = JSON.parse(readFileSync(new URL('.staging-qr.local', root), 'utf8'))
const credsFile = new URL('.staging-credentials.local', root)
const creds = existsSync(credsFile) ? JSON.parse(readFileSync(credsFile, 'utf8')) : null
const TOKEN_5 = tokens['Masa 5']

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const consoleErrors = [], hosts = new Set(), browsers = [], temps = []
let nextPort = 9340

async function openPage() {
  const port = nextPort++
  const temp = mkdtempSync(join(tmpdir(), 'waypoint-staging-'))
  temps.push(temp)
  browsers.push(spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${temp}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' }))
  for (let i = 0; i < 60; i++) { if (await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.ok).catch(() => false)) break; await sleep(250) }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json())
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => { ws.onopen = resolve })
  let id = 0
  const waiting = new Map()
  let cdp
  const pausedHandlers = []
  ws.onmessage = event => {
    const m = JSON.parse(event.data)
    if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if (m.method === 'Network.requestWillBeSent') {
      const host = /^https?:\/\/([^/]+)/.exec(m.params.request.url)?.[1]
      if (host) hosts.add(host)
    }
    if (m.method === 'Fetch.requestPaused') pausedHandlers.forEach(handler => handler(m.params))
  }
  cdp = (method, params = {}) => new Promise((resolve, reject) => {
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
  const page = {
    cdp, ev, onPaused: handler => pausedHandlers.push(handler),
    size: (width, height) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 1000 }),
    go: path => cdp('Page.navigate', { url: BASE + path }),
    until: async (expression, label, ms = 25000) => {
      const end = Date.now() + ms
      while (Date.now() < end) { if (await ev(`(()=>{try{return !!(${expression})}catch{return false}})()`)) return; await sleep(100) }
      throw new Error(`Beklenen durum oluşmadı: ${label}`)
    },
    click: sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('yok: '+${JSON.stringify(sel)}); e.click()})()`),
    clickText: (text, scope = 'button,a') => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope)})].find(b=>b.innerText.includes(${JSON.stringify(text)})&&b.offsetParent); if(!e) throw new Error('yok: '+${JSON.stringify(text)}); e.click()})()`),
    type: (sel, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`),
  }
  return page
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
  await sleep(1200)
  if (await page.ev(`!!document.querySelector('.promotion-close')`)) await page.click('.promotion-close')
}
const addProduct = async (page, name, times = 1) => {
  await page.type('.menu-search', name)
  const card = `[...document.querySelectorAll('.editorial-card')].find(c=>c.querySelector('.editorial-card-title')?.innerText.toLocaleLowerCase('tr')===${JSON.stringify(name.toLocaleLowerCase('tr'))})`
  await page.until(`${card}?.querySelector('.qr-add')`, `${name} kartı`)
  await page.ev(`${card}.querySelector('.qr-add').click()`)
  for (let i = 1; i < times; i++) {
    await page.until(`${card}.querySelector('[aria-label="Artır"]')`, 'adet artır')
    await page.ev(`${card}.querySelector('[aria-label="Artır"]').click()`)
  }
  await page.until(`document.querySelector('.qr-bar-count')?.innerText==='${times}'`, `sepette ${times}`)
}
const openCart = async page => {
  await page.click('.qr-bar-cart')
  await page.until(`document.querySelector('.qr-send')`, 'sepet')
}
const orderCount = page => page.ev(`document.querySelectorAll('.qr-order').length`)

try {
  const customer = await openPage(), second = await openPage()
  await customer.size(390, 844); await second.size(390, 844)
  let total = ''

  await step('Bağlam: sayfa staging etiketli açılır, demo modu yoktur', async () => {
    await enterMenu(customer, `/masa/${TOKEN_5}`)
    await customer.until(`document.querySelector('.qr-table-chip')?.innerText.includes('Masa 5')`, 'Masa 5 etiketi')
    expect(await customer.ev(`document.querySelector('.staging-badge')?.innerText.includes('STAGING')`), 'staging etiketi yok')
    expect(!await customer.ev(`!!document.querySelector('.qr-banner-demo')`), 'demo modunda')
    return `güvenli bağlam: ${await customer.ev('window.isSecureContext')}, randomUUID: ${await customer.ev(`typeof crypto.randomUUID`)}`
  })

  await step('Müşteri: 2 Türk Kahvesi sipariş eder; çift dokunuş tek sipariş', async () => {
    await addProduct(customer, 'Türk Kahvesi', 2)
    await openCart(customer)
    total = await customer.ev(`document.querySelector('.qr-total strong').innerText`)
    expect(/180/.test(total), `sepet toplamı ${total}`)
    await customer.ev(`(()=>{const b=document.querySelector('.qr-send');b.click();b.click()})()`)
    await customer.until(`document.querySelector('.qr-confirm')`, 'onay')
    await customer.clickText('Siparişlerim', '.qr-confirm button')
    await customer.until(`document.querySelector('.qr-order-new')`, 'sipariş listesi')
    expect(await orderCount(customer) === 1, 'çift sipariş')
    return total
  })

  await step('Yanıt kaybı: sipariş sunucuya ulaşır, yanıt kopar; doğrulama çift üretmez', async () => {
    await customer.click('.qr-sheet-head .pos-icon-btn')
    await customer.until(`!document.querySelector('.qr-sheet')`, 'sayfa kapandı')
    await addProduct(customer, 'Latte')
    await openCart(customer)
    customer.onPaused(params => customer.cdp('Fetch.failRequest', { requestId: params.requestId, errorReason: 'ConnectionReset' }))
    await customer.cdp('Fetch.enable', { patterns: [{ urlPattern: '*place_qr_order*', requestStage: 'Response' }] })
    await customer.click('.qr-send')
    await customer.until(`document.querySelector('.qr-uncertain')`, 'belirsiz uyarı')
    expect(!await customer.ev(`!!document.querySelector('.qr-confirm')`), 'yanıtsız başarı gösterildi')
    await customer.cdp('Fetch.disable')
    await customer.clickText('Durumu kontrol et')
    await customer.until(`document.querySelector('.qr-confirm')`, 'doğrulama sonrası onay')
    await customer.clickText('Siparişlerim', '.qr-confirm button')
    await customer.until(`document.querySelectorAll('.qr-order').length===2`, 'iki sipariş')
    await sleep(800)
    expect(await orderCount(customer) === 2, 'çift sipariş')
  })

  await step('Bağlantı kopması: çevrimdışında başarı denmez, bağlanınca sipariş tek kaydolur', async () => {
    await customer.click('.qr-sheet-head .pos-icon-btn')
    await customer.until(`!document.querySelector('.qr-sheet')`, 'sayfa kapandı')
    await addProduct(customer, 'Limonata')
    await openCart(customer)
    await customer.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await customer.click('.qr-send')
    await customer.until(`document.querySelector('.qr-uncertain')`, 'belirsiz uyarı')
    expect(!await customer.ev(`!!document.querySelector('.qr-confirm')`), 'çevrimdışı başarı gösterildi')
    await customer.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    // Bağlantı gelince uygulama kendiliğinden aynı anahtarla doğrular; dokunmak gerekmez.
    await customer.until(`document.querySelector('.qr-confirm')`, 'bağlanınca otomatik onay')
    await customer.clickText('Siparişlerim', '.qr-confirm button')
    await customer.until(`document.querySelectorAll('.qr-order').length===3`, 'üç sipariş')
  })

  await step('İkinci müşteri: ayrı oturumda sipariş verir, ilkini görmez', async () => {
    await enterMenu(second, `/masa/${TOKEN_5}`)
    await second.until(`document.querySelector('.qr-table-chip')`, 'masa')
    expect(!await second.ev(`!!document.querySelector('.qr-bar-orders')`) || await orderCount(second) === 0, 'ilk müşterinin siparişi')
    await addProduct(second, 'Espresso')
    await openCart(second)
    await second.click('.qr-send')
    await second.until(`document.querySelector('.qr-confirm')`, 'onay')
    await second.clickText('Siparişlerim', '.qr-confirm button')
    await second.until(`document.querySelectorAll('.qr-order').length===1`, 'yalnızca kendi siparişi')
  })

  await step('Geçersiz masa kodu: menü açılır, sipariş kapalıdır', async () => {
    await enterMenu(second, `/masa/${'a'.repeat(64)}`)
    await second.until(`document.querySelector('.qr-banner')`, 'uyarı')
    await second.until(`document.querySelector('.editorial-card')`, 'ürünler')
    expect(!await second.ev(`!!document.querySelector('.qr-add')`), 'ekleme düğmesi göründü')
  })

  if (!creds) {
    results.push('SKIP  Garson ve mutfak ekranları: .staging-credentials.local yok')
  } else {
    const waiter = await openPage(), kitchen = await openPage()
    await waiter.size(390, 844); await kitchen.size(1366, 900)
    const login = async (page, path, { email, password }) => {
      await page.go(path)
      await page.until(`document.querySelector('#staff-email')`, 'giriş formu')
      await page.type('#staff-email', email)
      await page.type('#staff-password', password)
      await page.click('.login-btn')
    }
    const ticket = `[...document.querySelectorAll('.kt-ticket')].find(t=>t.querySelector('.kt-ticket-table').textContent==='Masa 5'&&t.innerText.includes('Türk Kahvesi')&&t.offsetParent)`

    await step('Yetki: mutfak hesabı garson paneline giremez', async () => {
      await login(waiter, '/garson', creds.kitchen)
      await waiter.until(`document.querySelector('.pos-form-error')`, 'yetki uyarısı')
    })
    await step('Garson ve mutfak: gerçek hesapla giriş, siparişler görünür', async () => {
      await login(waiter, '/garson', creds.waiter)
      await waiter.until(`document.querySelectorAll('.wt-table-card').length===10`, '10 masa')
      await login(kitchen, '/mutfak', creds.kitchen)
      await kitchen.until(ticket, 'Masa 5 fişi')
    })
    await step('Mutfak: yeni sipariş yenilemeden görünür (gerçek Realtime)', async () => {
      await customer.click('.qr-sheet-head .pos-icon-btn')
      await customer.until(`!document.querySelector('.qr-sheet')`, 'sayfa kapandı')
      const before = await kitchen.ev(`document.querySelectorAll('.kt-ticket').length`)
      await addProduct(customer, 'Tiramisu')
      await openCart(customer)
      await customer.click('.qr-send')
      await customer.until(`document.querySelector('.qr-confirm')`, 'onay')
      await kitchen.until(`document.querySelectorAll('.kt-ticket').length===${before + 1}`, 'yeni fiş', 8000)
    })
    await step('Mutfak: Hazırlanıyor ve Hazır; müşteri otomatik görür', async () => {
      await customer.clickText('Siparişlerim', '.qr-confirm button')
      await kitchen.ev(`${ticket}.querySelector('.kt-action').click()`)
      await kitchen.until(`${ticket}.classList.contains('kt-ticket-preparing')`, 'hazırlanıyor')
      await customer.until(`document.querySelector('.qr-order-preparing')`, 'müşteride hazırlanıyor', 20000)
      await kitchen.ev(`${ticket}.querySelector('.kt-action').click()`)
      await kitchen.until(`${ticket}.classList.contains('kt-ticket-ready')`, 'hazır')
      await customer.until(`document.querySelector('.qr-order-ready')`, 'müşteride hazır', 20000)
    })
    await step('Garson: Masa 5 hazır rozeti ve tüm siparişlerin adisyonu', async () => {
      const card = `[...document.querySelectorAll('.wt-table-card')].find(c=>c.innerText.includes('Masa 5'))`
      await waiter.until(`${card}.querySelector('.wt-table-ready')`, 'hazır rozeti', 10000)
      await waiter.ev(`${card}.click()`)
      await waiter.until(`document.querySelector('.wt-bill-btn')`, 'masa görünümü')
      await waiter.click('.wt-bill-btn')
      await waiter.until(`document.querySelector('.wt-bill')`, 'adisyon')
      await waiter.until(`document.querySelectorAll('.wt-order').length===5`, 'beş sipariş')
      const bill = await waiter.ev(`document.querySelector('.wt-bill').innerText`)
      for (const name of ['Türk Kahvesi', 'Latte', 'Limonata', 'Espresso', 'Tiramisu']) expect(bill.includes(name), `adisyonda yok: ${name}`)
      return await waiter.ev(`document.querySelector('.wt-bill-summary strong').innerText`)
    })
    await step('Garson: siparişi aynı adisyona ekler', async () => {
      await waiter.click('.wt-sheet-close')
      await waiter.until(`document.querySelector('.wt-product:not(.out)')`, 'katalog')
      await waiter.click('.wt-product:not(.out)')
      await waiter.until(`document.querySelector('.wt-cart-bar')`, 'sepet çubuğu')
      await waiter.click('.wt-cart-bar')
      await waiter.until(`document.querySelector('.wt-send')`, 'gönder')
      await waiter.click('.wt-send')
      await waiter.until(`document.querySelectorAll('.wt-order').length===6`, 'altı sipariş')
      await waiter.until(`document.querySelector('.wt-bill-summary strong')`, 'toplam')
      const shown = await waiter.ev(`document.querySelector('.wt-bill-summary strong').innerText`)
      const added = Number(shown.replace(/[^\d,]/g, '').replace(',', '.')) - 647.5
      expect([87.5, 90, 100, 110, 130, 140, 150].includes(added), `toplam ${shown}, fark ${added}`)
      return `${shown} (eklenen ${added} ₺)`
    })
    // Servis edilen fişler 2 saat görünür kalır; yalnızca bu çalıştırmanın açık fişi seçilir.
    const waiterTicket = `[...document.querySelectorAll('.kt-ticket.kt-from-waiter:not(.kt-ticket-served)')].find(t=>t.querySelector('.kt-ticket-table').textContent==='Masa 5'&&t.offsetParent)`
    const waiterOrder = `[...document.querySelectorAll('.wt-order')].find(o=>/garson/i.test(o.querySelector('.pos-source')?.innerText??''))`
    await step('Garson siparişi: mutfak ekranına yenilemeden ulaşır', async () => {
      await kitchen.until(waiterTicket, 'garson fişi', 10000)
    })
    await step('Mutfak Hazırlanıyor → Hazır; garson ekranı yenilemeden güncellenir', async () => {
      await kitchen.ev(`${waiterTicket}.querySelector('.kt-action').click()`)
      await kitchen.until(`${waiterTicket}.classList.contains('kt-ticket-preparing')`, 'mutfakta hazırlanıyor')
      await waiter.until(`${waiterOrder}.querySelector('.pos-status-preparing')`, 'garsonda hazırlanıyor', 10000)
      await kitchen.ev(`${waiterTicket}.querySelector('.kt-action').click()`)
      await kitchen.until(`${waiterTicket}.classList.contains('kt-ticket-ready')`, 'mutfakta hazır')
      await waiter.until(`${waiterOrder}.querySelector('.pos-status-ready')`, 'garsonda hazır', 10000)
    })
    await step('Yenileme: oturum korunur, kayıtlar veritabanından gelir', async () => {
      await waiter.go('/garson')
      await waiter.until(`document.querySelectorAll('.wt-table-card').length===10`, 'girişsiz masa listesi')
      await kitchen.go('/mutfak')
      await kitchen.until(waiterTicket, 'yenileyince garson fişi')
    })
    await step('Yeniden bağlanma: mutfak koparken gelen sipariş bağlanınca yenilemeden görünür', async () => {
      await sleep(2500)
      const before = await kitchen.ev(`document.querySelectorAll('.kt-ticket').length`)
      await kitchen.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
      await sleep(1500)
      await customer.click('.qr-sheet-head .pos-icon-btn')
      await customer.until(`!document.querySelector('.qr-sheet')`, 'sayfa kapandı')
      await addProduct(customer, 'Ice Latte')
      await openCart(customer)
      await customer.click('.qr-send')
      await customer.until(`document.querySelector('.qr-confirm')`, 'onay')
      await sleep(3000)
      const whileOffline = await kitchen.ev(`document.querySelectorAll('.kt-ticket').length`)
      expect(whileOffline === before, 'çevrimdışıyken fiş geldi: bağlantı gerçekten kopmadı')
      const started = Date.now()
      await kitchen.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
      await kitchen.until(`document.querySelectorAll('.kt-ticket').length===${before + 1}`, 'bağlanınca yeni fiş', 30000)
      return `${((Date.now() - started) / 1000).toFixed(1)} sn içinde görüldü`
    })

    // ── Garson bildirimleri ──
    const shot = async (page, name) => {
      if (!process.env.E2E_SHOTS) return
      const r = await page.cdp('Page.captureScreenshot', { format: 'jpeg', quality: 72 })
      writeFileSync(join(process.env.E2E_SHOTS, `${name}.jpg`), Buffer.from(r.result.data, 'base64'))
    }
    const unread = page => page.ev(`document.querySelector('.wt-notify-count')?.innerText??'0'`)
    const bannerCount = page => page.ev(`document.querySelectorAll('.wt-notify-banner').length`)
    const openPanel = async page => { await page.click('.wt-bell'); await page.until(`document.querySelector('.wt-notify-panel')`, 'bildirim paneli') }
    const closePanel = async page => { await page.click('.wt-notify-close'); await page.until(`!document.querySelector('.wt-notify-panel')`, 'panel kapandı') }
    const newWaiterTicket = status => `[...document.querySelectorAll('.kt-ticket.kt-from-waiter.kt-ticket-${status}')].find(t=>t.querySelector('.kt-ticket-table').textContent==='Masa 5')`
    const advance = async (status, waitFor = 1) => {
      const count = `[...document.querySelectorAll('.kt-ticket.kt-from-waiter.kt-ticket-${status}')].filter(t=>t.querySelector('.kt-ticket-table').textContent==='Masa 5').length`
      // Beklenen fişlerin hepsi gelmeden sayılırsa sonradan gelen fiş sayımı bozar.
      await kitchen.until(`${count}>=${waitFor}`, `mutfakta ${waitFor} ${status} fiş`, 12000)
      const before = await kitchen.ev(count)
      await kitchen.ev(`${newWaiterTicket(status)}.querySelector('.kt-action').click()`)
      // Aynı fişe ikinci kez basılmasın: durum değişene kadar beklenir.
      await kitchen.until(`${count}===${before - 1}`, `${status} fişi ilerledi`, 12000)
    }
    let product = ''
    const sendOrder = async (page = waiter, quantity = 2) => {
      await page.go('/garson')
      await page.until(`document.querySelectorAll('.wt-table-card').length===10`, 'masalar')
      await page.ev(`[...document.querySelectorAll('.wt-table-card')].find(c=>c.innerText.includes('Masa 5')).click()`)
      await page.until(`document.querySelector('.wt-product:not(.out)')`, 'katalog')
      product = await page.ev(`document.querySelector('.wt-product:not(.out)').innerText.split('\\n')[0]`)
      await page.click('.wt-product:not(.out)')
      await page.until(`document.querySelector('.wt-cart-bar')`, 'sepet çubuğu')
      await page.click('.wt-cart-bar')
      await page.until(`document.querySelector('[aria-label="Artır"]')`, 'sepet')
      for (let i = 1; i < quantity; i++) await page.click('[aria-label="Artır"]')
      await page.click('.wt-send')
      await page.until(`document.querySelector('.wt-bill')`, 'adisyon')
    }

    await step('Bildirim: yenileme eski uyarıları tekrar göstermez, tümü okundu sayacı sıfırlar', async () => {
      await waiter.go('/garson')
      await waiter.until(`document.querySelectorAll('.wt-table-card').length===10`, 'masalar')
      await sleep(1500)
      expect(await bannerCount(waiter) === 0, 'yenilemede eski uyarı göründü')
      await openPanel(waiter)
      if (await waiter.ev(`!document.querySelector('.wt-notify-all').disabled`)) await waiter.click('.wt-notify-all')
      await closePanel(waiter)
      await waiter.until(`!document.querySelector('.wt-notify-count')`, 'sayaç sıfır')
    })
    await step('Garson siparişi → Hazırlanıyor: garson yenilemeden görür, uyarı çıkmaz', async () => {
      await sendOrder()
      await advance('new')
      await waiter.until(`document.querySelector('.wt-order .pos-status-preparing')`, 'garsonda hazırlanıyor', 10000)
      expect(await bannerCount(waiter) === 0 && await unread(waiter) === '0', 'hazırlanıyor durumunda uyarı çıktı')
    })
    await step('Hazır: garsona anında görünür uyarı; masa, ürün, adet ve saat doğru', async () => {
      const started = Date.now()
      await advance('preparing')
      await waiter.until(`document.querySelector('.wt-notify-banner')`, 'hazır uyarısı', 10000)
      const elapsed = ((Date.now() - started) / 1000).toFixed(1)
      const text = (await waiter.ev(`document.querySelector('.wt-notify-banner').innerText`)).toLocaleLowerCase('tr')
      for (const part of ['masa 5 — siparişiniz hazır!', `2 × ${product.toLocaleLowerCase('tr')}`, 'mutfaktan teslim alabilirsiniz']) expect(text.includes(part), `uyarıda yok: ${part} → ${text}`)
      expect(/\d\d[:.]\d\d/.test(text), 'saat yok')
      expect(await unread(waiter) === '1', `sayaç ${await unread(waiter)}`)
      await waiter.until(`document.querySelector('.wt-order.ready .pos-status-ready')`, 'adisyonda hazır', 10000)
      const box = await waiter.ev(`(()=>{const r=document.querySelector('.wt-notify-banner').getBoundingClientRect();return [r.left,r.right,innerWidth]})()`)
      expect(box[0] >= 0 && box[1] <= box[2], `uyarı ekrana sığmıyor: ${box}`)
      // Adisyon sayfası açıkken de gerçekten en üstte olmalı (DOM'da olması yetmez).
      expect(await waiter.ev(`(()=>{const b=document.querySelector('.wt-notify-banner');const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})()`), 'uyarı başka katmanın arkasında')
      expect(await waiter.ev(`!!document.querySelector('.wt-side.open')`), 'senaryo adisyon açıkken çalışmalı')
      await sleep(350)
      await shot(waiter, 'banner-390')
      return `${elapsed} sn içinde`
    })
    await step('Masa vurgusu ve geçmiş: yenilemede kalıcı, tekrar uyarmaz; panelden masa açılır, okundu olur', async () => {
      await waiter.go('/garson')
      await waiter.until(`[...document.querySelectorAll('.wt-table-card')].find(c=>c.innerText.includes('Masa 5'))?.classList.contains('has-ready')`, 'masa vurgusu')
      await shot(waiter, 'tables-390')
      await sleep(1500)
      expect(await bannerCount(waiter) === 0, 'yenilemede uyarı tekrarlandı')
      expect(await unread(waiter) === '1', 'okunmamış kayboldu')
      await openPanel(waiter)
      const entry = (await waiter.ev(`document.querySelector('.wt-notify-item').innerText`)).toLocaleLowerCase('tr')
      expect(entry.includes('masa 5') && entry.includes(`2 × ${product.toLocaleLowerCase('tr')}`), `kayıt: ${entry}`)
      await sleep(350)
      await shot(waiter, 'panel-390')
      await waiter.clickText('Masayı aç', '.wt-notify-item.unread button')
      await waiter.until(`location.pathname.includes('/garson/masa/')&&document.querySelector('.wt-side.open .wt-bill')`, 'adisyon açıldı')
      await waiter.until(`!document.querySelector('.wt-notify-count')`, 'okundu')
    })
    await step('Servis edildi: mutfak ve garson ekranları yenilemeden eşitlenir', async () => {
      const served = await kitchen.ev(`document.querySelectorAll('.kt-ticket-served').length`)
      await waiter.click('.wt-order.ready .wt-serve')
      await kitchen.until(`document.querySelectorAll('.kt-ticket-served').length===${served + 1}`, 'mutfakta servis edildi', 10000)
      await waiter.until(`document.querySelector('.wt-order .pos-status-served')`, 'garsonda servis edildi', 10000)
    })
    const second = await openPage()
    await second.size(1366, 900)
    await step('Birden çok sipariş ve farklı personel: iki cihaza ayrı uyarı, servis diğer cihazı düşürür', async () => {
      await login(second, '/garson', creds.admin)
      await second.until(`document.querySelectorAll('.wt-table-card').length===10`, 'yönetici masaları')
      await openPanel(second)
      if (await second.ev(`!document.querySelector('.wt-notify-all').disabled`)) await second.click('.wt-notify-all')
      await closePanel(second)
      await sendOrder(waiter, 1)
      await sendOrder(waiter, 3)
      await advance('new', 2); await advance('new')
      await advance('preparing', 2); await advance('preparing')
      for (const page of [waiter, second]) await page.until(`document.querySelectorAll('.wt-notify-banner').length===2`, 'iki ayrı uyarı', 12000)
      expect(await unread(waiter) === '2' && await unread(second) === '2', 'sayaç 2 değil')
      await shot(second, 'banners-1366')
      await openPanel(second)
      await second.ev(`document.querySelector('.wt-notify-panel .wt-notify-serve').click()`)
      await waiter.until(`document.querySelector('.wt-notify-count')?.innerText==='1'`, 'diğer cihazda sayaç düştü', 12000)
      await waiter.until(`document.querySelectorAll('.wt-notify-banner').length===1`, 'diğer cihazda uyarı kalktı', 12000)
      await sleep(350)
      await shot(second, 'panel-1366')
      await closePanel(second)
    })
    await step('Yeniden bağlanma: kopukken hazır olan sipariş kaybolmaz ve tek kez bildirilir', async () => {
      await sendOrder(waiter, 1)
      await advance('new')
      await waiter.until(`document.querySelector('.wt-order .pos-status-preparing')`, 'garsonda hazırlanıyor', 10000)
      await sleep(500)
      const before = Number(await unread(waiter)), banners = await bannerCount(waiter)
      await waiter.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
      await sleep(1500)
      await advance('preparing')
      await sleep(3000)
      expect(Number(await unread(waiter)) === before, 'kopukken bildirim geldi: bağlantı gerçekten kopmadı')
      await waiter.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
      await waiter.until(`document.querySelector('.wt-notify-count')?.innerText==='${before + 1}'`, 'kaçırılan bildirim', 25000)
      await waiter.until(`document.querySelectorAll('.wt-notify-banner').length===${banners + 1}`, 'kaçırılan uyarı', 5000)
      await sleep(17000) // Düzenli yenileme de çoğaltmamalı.
      expect(Number(await unread(waiter)) === before + 1 && await bannerCount(waiter) === banners + 1, 'düzenli yenileme bildirimi çoğalttı')
      await waiter.go('/garson')
      await waiter.until(`document.querySelectorAll('.wt-table-card').length===10`, 'masalar')
      await sleep(1500)
      expect(await bannerCount(waiter) === 0 && Number(await unread(waiter)) === before + 1, 'yenilemede çoğaldı veya kayboldu')
      await openPanel(waiter)
      const ids = await waiter.ev(`[...document.querySelectorAll('.wt-notify-item')].map(i=>i.dataset.id)`)
      expect(new Set(ids).size === ids.length, 'geçmişte çift kayıt')
      await closePanel(waiter)
      return `${ids.length} geçmiş kaydı, çift yok`
    })
    await step('Ses tercihi ve tarayıcı bildirimi durumu doğru; yetkisiz roller paneli göremez', async () => {
      await openPanel(waiter)
      expect(await waiter.ev(`document.querySelector('.wt-notify-sound').getAttribute('aria-pressed')`) === 'false', 'ses varsayılan kapalı değil')
      await waiter.click('.wt-notify-sound')
      await waiter.until(`document.querySelector('.wt-notify-sound').getAttribute('aria-pressed')==='true'`, 'ses açıldı')
      const secure = await waiter.ev('window.isSecureContext')
      const note = await waiter.ev(`document.querySelector('.wt-notify-browser').innerText`)
      if (!secure) expect(note.includes('HTTPS'), `not: ${note}`)
      await waiter.go('/garson')
      await waiter.until(`document.querySelector('.wt-bell')`, 'zil')
      await openPanel(waiter)
      expect(await waiter.ev(`document.querySelector('.wt-notify-sound').getAttribute('aria-pressed')`) === 'true', 'ses tercihi korunmadı')
      await waiter.click('.wt-notify-sound')
      await closePanel(waiter)
      expect(!await kitchen.ev(`!!document.querySelector('.wt-bell')`), 'mutfakta garson zili var')
      return secure ? 'güvenli bağlam' : 'HTTP: tarayıcı bildirimi kapalı, uygulama içi açık'
    })
    await step('Yerleşim: bildirim paneli ve zil telefon, tablet ve masaüstünde taşmaz', async () => {
      for (const [width, height] of [[320, 640], [390, 844], [430, 932], [820, 1180], [1366, 900]]) {
        await waiter.size(width, height); await sleep(200)
        expect(await waiter.ev('document.documentElement.scrollWidth - document.documentElement.clientWidth') === 0, `${width}px taşma`)
        await openPanel(waiter)
        await sleep(300)
        const r = await waiter.ev(`(()=>{const b=document.querySelector('.wt-notify-panel').getBoundingClientRect();return [b.left,b.right,b.bottom,document.querySelector('.wt-bell').getBoundingClientRect().height]})()`)
        expect(r[0] >= 0 && r[1] <= width && r[2] <= height && r[3] >= 44, `${width}px panel: ${r}`)
        await closePanel(waiter)
      }
      await waiter.size(390, 844)
    })
  }

  await step('Yalıtım: uygulama yalnızca staging projesine bağlandı', async () => {
    const supabaseHosts = [...hosts].filter(host => host.includes('supabase'))
    expect(!supabaseHosts.some(host => host.includes(PRODUCTION_REF)), `üretime istek: ${supabaseHosts}`)
    expect(supabaseHosts.length === 1 && supabaseHosts[0].startsWith(STAGING_REF), `beklenmeyen: ${supabaseHosts}`)
    return supabaseHosts[0]
  })

  console.log(results.join('\n'))
  const unique = [...new Set(consoleErrors)]
  console.log('Yakalanmamış hatalar:', unique.length ? unique.slice(0, 6).join('\n  ') : 'yok')
  if (unique.length) failed++
} finally {
  browsers.forEach(browser => browser.kill())
  await sleep(500)
  temps.forEach(temp => { try { rmSync(temp, { recursive: true, force: true }) } catch { /* Chrome dosyayı henüz bırakmamış olabilir. */ } })
}
console.log(`\n${results.filter(r => r.startsWith('OK')).length} geçti, ${failed} kaldı, ${results.filter(r => r.startsWith('SKIP')).length} atlandı`)
process.exit(failed ? 1 : 0)
