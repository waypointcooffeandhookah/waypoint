// Tarayıcıda uçtan uca demo testi: garson ve mutfak iki ayrı sekmede, aynı tarayıcıda.
// Çalıştırma: önce `npm run dev`, sonra `npm run test:e2e`. Chrome veya Edge gerekir.
// Ortam: E2E_BASE (varsayılan http://localhost:5173/waypoint), E2E_BROWSER (tarayıcı yolu)
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173/waypoint'
const BROWSER = [
  process.env.E2E_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(path => path && existsSync(path))
if (!BROWSER) { console.error('Chrome veya Edge bulunamadı (E2E_BROWSER ile belirtin).'); process.exit(2) }

const PORT = 9334
const temp = mkdtempSync(join(tmpdir(), 'waypoint-e2e-'))
const shots = join(temp, 'shots'); mkdirSync(shots)
const browser = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(temp, 'profile')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const consoleErrors = [], writes = []

async function openPage() {
  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json())
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => { ws.onopen = resolve })
  let id = 0
  const waiting = new Map()
  ws.onmessage = event => {
    const m = JSON.parse(event.data)
    if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '))
    if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('supabase') && !['GET', 'HEAD', 'OPTIONS'].includes(m.params.request.method)) writes.push(`${m.params.request.method} ${m.params.request.url.split('?')[0]}`)
  }
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id
    const timer = setTimeout(() => reject(new Error(`Tarayıcı yanıt vermedi: ${method} ${String(params.expression ?? '').slice(0, 80)}`)), 30000)
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
    cdp, ev,
    size: (width, height) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 1000 }),
    go: async path => { await cdp('Page.navigate', { url: BASE + path }) },
    until: async (expression, label, ms = 20000) => {
      const end = Date.now() + ms
      while (Date.now() < end) { if (await ev(`(()=>{try{return !!(${expression})}catch{return false}})()`)) return; await sleep(100) }
      throw new Error(`Beklenen durum oluşmadı: ${label}`)
    },
    click: sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('yok: '+${JSON.stringify(sel)}); e.click()})()`),
    clickText: (text, scope = 'button,a') => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope)})].find(b=>b.innerText.includes(${JSON.stringify(text)})&&b.offsetParent); if(!e) throw new Error('yok: '+${JSON.stringify(text)}); e.click()})()`),
    overflow: () => ev('document.documentElement.scrollWidth - document.documentElement.clientWidth'),
    // Chrome arka plandaki sekmenin görüntüsünü almaz.
    shot: async name => { await cdp('Page.bringToFront'); const r = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); writeFileSync(join(shots, `${name}.jpg`), Buffer.from(r.result.data, 'base64')) },
    close: () => { ws.close() },
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
const ticketOf = table => `[...document.querySelectorAll('.kt-ticket')].find(t=>t.querySelector('.kt-ticket-table').textContent===${JSON.stringify(table)}&&t.offsetParent)`

try {
  for (let i = 0; i < 40; i++) { if (await fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.ok).catch(() => false)) break; await sleep(250) }
  const waiter = await openPage(), kitchen = await openPage()
  await waiter.size(390, 844); await kitchen.size(1366, 900)
  let total = ''

  await step('Garson: demo girişi ve masa listesi', async () => {
    await waiter.go('/garson')
    await waiter.until(`[...document.querySelectorAll('button')].some(b=>b.innerText.includes("Demo'yu Başlat"))`, 'demo kartı')
    await waiter.clickText("Demo'yu Başlat")
    await waiter.until(`document.querySelectorAll('.wt-table-card').length===12`, '12 masa')
    expect(await waiter.overflow() === 0, 'yatay taşma')
  })
  await step('Mutfak: demo girişi ve boş sütun durumları', async () => {
    await kitchen.go('/mutfak')
    await kitchen.until(`[...document.querySelectorAll('button')].some(b=>b.innerText.includes("Demo'yu Başlat"))`, 'demo kartı')
    await kitchen.clickText("Demo'yu Başlat")
    await kitchen.until(`document.querySelector('.kt-board')`, 'pano')
    await kitchen.until(`document.querySelector('.kt-from-qr')&&document.querySelector('.kt-from-waiter')`, 'QR ve garson fişleri')
    const count = await kitchen.ev(`document.querySelectorAll('.kt-column').length`)
    expect(count === 4, 'sütun sayısı')
    await kitchen.shot('kitchen-desktop')
  })
  await step('Garson: Masa 5, ürün ekle, adet, not, gönder', async () => {
    await waiter.ev(`[...document.querySelectorAll('.wt-table-card')].find(c=>c.innerText.includes('Masa 5')).click()`)
    await waiter.until(`document.querySelector('.wt-table-bar .pos-title')?.innerText==='Masa 5'`, 'masa görünümü')
    await waiter.until(`document.querySelector('.wt-product:not(.out)')`, 'katalog')
    await waiter.click('.wt-product:not(.out)')
    await waiter.until(`document.querySelector('.wt-cart-bar')`, 'sepet çubuğu')
    await waiter.click('.wt-cart-bar')
    await waiter.until(`document.querySelector('[aria-label="Artır"]')`, 'sepet')
    await waiter.click('[aria-label="Artır"]')
    await waiter.click('.wt-note-toggle')
    await waiter.until(`document.querySelector('.wt-note-input')`, 'not alanı')
    await waiter.ev(`(()=>{const e=document.querySelector('.wt-note-input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'e2e notu');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await waiter.until(`document.querySelector('.wt-cart-total strong')`, 'toplam')
    total = await waiter.ev(`document.querySelector('.wt-cart-total strong').innerText`)
    await waiter.click('.wt-send')
    await waiter.until(`document.querySelector('.wt-bill-summary')`, 'adisyon')
    await waiter.until(`document.body.innerText.includes('demo mutfağa')`, 'dürüst demo mesajı')
    expect(!/mutfağa iletildi/.test(await waiter.ev('document.body.innerText')), 'gerçek mutfak iddiası')
    return `sepet toplamı ${total}`
  })
  await step('Mutfak: sipariş yenilemeden görünür (sekmeler arası)', async () => {
    await kitchen.until(ticketOf('Masa 5'), 'Masa 5 fişi', 5000)
    const t = await kitchen.ev(`${ticketOf('Masa 5')}.innerText`)
    expect(t.includes('2×') && t.includes('e2e notu') && /GARSON/i.test(t), `fiş içeriği: ${t}`)
    await kitchen.shot('kitchen-new-order')
  })
  await step('Mutfak: Hazırlanıyor, sonra Hazır', async () => {
    await kitchen.ev(`${ticketOf('Masa 5')}.querySelector('.kt-action').click()`)
    await kitchen.until(`${ticketOf('Masa 5')}.classList.contains('kt-ticket-preparing')`, 'hazırlanıyor')
    await waiter.until(`document.querySelector('.wt-order .pos-status-preparing')`, 'garsonda hazırlanıyor', 5000)
    await kitchen.ev(`${ticketOf('Masa 5')}.querySelector('.kt-action').click()`)
    await kitchen.until(`${ticketOf('Masa 5')}.classList.contains('kt-ticket-ready')`, 'hazır')
  })
  await step('Garson: güncel durum ve Masa 5 adisyonu', async () => {
    await waiter.until(`document.querySelector('.wt-order .pos-status-ready')`, 'garsonda hazır', 5000)
    const bill = await waiter.ev(`document.querySelector('.wt-bill').innerText`)
    expect(bill.includes('2×') && bill.includes('e2e notu') && bill.includes(total), `adisyon: ${bill}`)
    await waiter.shot('waiter-bill-ready')
    return `adisyon toplamı ${total}`
  })
  await step('Garson: masa kartında "hazır" rozeti', async () => {
    await waiter.click('.wt-sheet-close')
    await waiter.click('[aria-label="Masalara dön"]')
    await waiter.until(`[...document.querySelectorAll('.wt-table-card')].find(c=>c.innerText.includes('Masa 5'))?.querySelector('.wt-table-ready')`, 'rozet')
    await waiter.shot('waiter-tables')
    expect(await waiter.overflow() === 0, 'yatay taşma')
  })
  await step('Ek sipariş öncekini ezmez, toplam artar', async () => {
    await waiter.ev(`[...document.querySelectorAll('.wt-table-card')].find(c=>c.innerText.includes('Masa 5')).click()`)
    await waiter.until(`document.querySelector('.wt-product:not(.out)')`, 'katalog')
    await waiter.click('.wt-product:not(.out)')
    await waiter.until(`document.querySelector('.wt-cart-bar')`, 'sepet çubuğu')
    await waiter.click('.wt-cart-bar')
    await waiter.until(`document.querySelector('.wt-send')`, 'gönder')
    await waiter.click('.wt-send')
    await waiter.until(`document.querySelectorAll('.wt-order').length===2`, 'iki sipariş')
    const shown = await waiter.ev(`document.querySelector('.wt-bill-summary strong').innerText`)
    expect(shown !== total, `toplam değişmedi: ${shown}`)
    await kitchen.until(`[...document.querySelectorAll('.kt-ticket')].filter(t=>t.querySelector('.kt-ticket-table').textContent==='Masa 5').length===2`, 'mutfakta iki fiş', 5000)
    return `yeni toplam ${shown}`
  })
  await step('Yerleşim: mutfak telefon ve tablette taşmaz, sekmeler çalışır', async () => {
    for (const [width, height, name] of [[320, 640, 'kitchen-phone-small'], [390, 844, 'kitchen-phone'], [820, 1180, 'kitchen-tablet'], [1366, 900, 'kitchen-laptop'], [1920, 1080, 'kitchen-desktop-wide']]) {
      await kitchen.size(width, height); await sleep(250)
      expect(await kitchen.overflow() === 0, `${width}px taşma`)
      const visible = await kitchen.ev(`[...document.querySelectorAll('.kt-column')].filter(c=>c.offsetParent).length`)
      expect(visible === (width >= 1100 ? 4 : 1), `${width}px görünen sütun: ${visible}`)
      await kitchen.shot(name)
    }
    await kitchen.size(390, 844)
    await kitchen.ev(`document.querySelectorAll('.kt-tabs button')[2].click()`)
    await kitchen.until(`document.querySelectorAll('.kt-column')[2].offsetParent`, 'Hazır sekmesi')
    const h = await kitchen.ev(`document.querySelector('.kt-column.active .kt-action')?.getBoundingClientRect().height ?? 0`)
    expect(h >= 44, `düğme yüksekliği ${h}`)
    return `dokunma hedefi ${h}px`
  })
  await step('Garson: tablet ve masaüstü taşmaz', async () => {
    for (const [width, height] of [[820, 1180], [1366, 900]]) {
      await waiter.size(width, height); await sleep(250)
      expect(await waiter.overflow() === 0, `${width}px taşma`)
    }
    await waiter.size(390, 844)
  })
  await step('Sayfa yenilenince demo siparişleri korunur', async () => {
    await kitchen.size(1366, 900)
    await kitchen.go('/mutfak')
    await kitchen.until(ticketOf('Masa 5'), 'yenilenince Masa 5 fişi')
  })
  await step('QR menü açılır, yönetici girişi çalışır', async () => {
    const page = await openPage()
    await page.size(390, 844)
    await page.go('/')
    await page.until(`document.querySelectorAll('img').length>3`, 'menü')
    expect(await page.overflow() === 0, 'menü taşması')
    await page.go('/admin/login')
    await page.until(`document.querySelector('input[type=password]')`, 'yönetici formu')
    page.close()
  })

  // ── Milestone 4: müşteri QR siparişi ──
  const customer = await openPage()
  await customer.size(390, 844)
  const enterMenu = async (page, path) => {
    await page.go(path)
    await page.until(`[...document.querySelectorAll('button')].some(b=>b.innerText.includes('MENÜYÜ KEŞFET'))`, 'karşılama ekranı')
    await page.clickText('MENÜYÜ KEŞFET')
    await page.until(`document.querySelector('.menu-search')&&!document.querySelector('.hero-viewport')`, 'menü')
    // Gerçek müşteri gibi öne çıkan ürün penceresini kapat; arkasındaki öğelere tıklanmasın.
    await sleep(1200)
    if (await page.ev(`!!document.querySelector('.promotion-close')`)) {
      await page.click('.promotion-close')
      await page.until(`!document.querySelector('.welcome-promotion')`, 'tanıtım kapandı')
    }
  }
  const searchMenu = (page, text) => page.ev(`(()=>{const e=document.querySelector('.menu-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const billTotal = async () => {
    await waiter.until(`document.querySelector('.wt-bill-summary strong')`, 'adisyon toplamı')
    return waiter.ev(`document.querySelector('.wt-bill-summary strong').innerText`)
  }
  const openTable5 = async () => {
    await waiter.go('/garson/masa/demo-masa-5')
    await waiter.until(`document.querySelector('.wt-bill-btn')`, 'masa görünümü')
    await waiter.click('.wt-bill-btn')
    await waiter.until(`document.querySelector('.wt-bill')`, 'adisyon')
  }
  const addFirstProduct = async (page, times = 1) => {
    await page.until(`document.querySelector('.qr-add')`, 'ekleme düğmesi')
    await page.click('.qr-add')
    for (let i = 1; i < times; i++) {
      await page.until(`document.querySelector('.editorial-card [aria-label="Artır"]')`, 'adet artır')
      await page.click('.editorial-card [aria-label="Artır"]')
    }
    await page.until(`document.querySelector('.qr-bar-count')?.innerText==='${times}'`, `sepette ${times} ürün`)
  }
  let qrPrice = ''

  await step('Normal QR menüde sipariş arayüzü yoktur', async () => {
    await enterMenu(customer, '/')
    await customer.until(`document.querySelector('.editorial-card')`, 'ürünler')
    const found = await customer.ev(`!!document.querySelector('.qr-add,.qr-bar,.qr-table-chip,.qr-banner')||document.body.innerText.includes('Sipariş Ver')`)
    expect(!found, 'normal menüde sipariş arayüzü göründü')
    await customer.click('.editorial-card')
    await customer.until(`document.querySelector('.modal-sheet-footer-note')`, 'personel notu')
    expect(!await customer.ev(`!!document.querySelector('.qr-add,.qr-add-wide')`), 'vitrinde ekleme düğmesi')
  })
  await step('Geçersiz masa kodunda menü çalışır, sipariş kapalıdır, sunucuya sorulmaz', async () => {
    await enterMenu(customer, '/masa/gecersiz-kod')
    await customer.until(`document.querySelector('.qr-banner')`, 'uyarı')
    await customer.until(`document.querySelector('.editorial-card')`, 'ürünler')
    expect(!await customer.ev(`!!document.querySelector('.qr-add')`), 'ekleme düğmesi göründü')
  })
  await step('Demo sıfırlanır; Masa 5 müşteri menüsü etiketli açılır', async () => {
    await customer.ev(`localStorage.clear()`)
    await enterMenu(customer, '/masa/demo-5')
    await customer.until(`document.querySelector('.qr-table-chip')?.innerText.includes('Masa 5')`, 'masa etiketi')
    await customer.until(`document.querySelector('.qr-banner-demo')?.innerText.includes('DEMO MODU')`, 'demo etiketi')
    await customer.shot('customer-menu')
  })
  await step('Müşteri 2 kahve ekler, adet ve notla Sipariş Ver', async () => {
    await searchMenu(customer, 'kahve')
    // Arama ertelenerek uygulanır: ilk eklenebilir ürün gerçekten kahve olana kadar bekle.
    await customer.until(`document.querySelector('.editorial-card .qr-add')?.closest('.editorial-card').innerText.toLocaleLowerCase('tr').includes('kahve')`, 'kahve')
    const coffee = await customer.ev(`document.querySelector('.editorial-card .qr-add').closest('.editorial-card').querySelector('.editorial-card-title').innerText`)
    await addFirstProduct(customer, 2)
    await customer.shot('customer-bar')
    await customer.click('.qr-bar-cart')
    await customer.until(`document.querySelector('.qr-send')`, 'sepet')
    await customer.click('.qr-note-toggle')
    await customer.until(`document.querySelector('.qr-note-input')`, 'not alanı')
    await customer.ev(`(()=>{const e=document.querySelector('.qr-note-input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'qr notu');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await customer.shot('customer-cart')
    qrPrice = await customer.ev(`document.querySelector('.qr-total strong').innerText`)
    const button = await customer.ev(`document.querySelector('.qr-send').getBoundingClientRect().height`)
    expect(button >= 44, `düğme yüksekliği ${button}`)
    // Çift dokunuş tek sipariş üretmeli.
    await customer.ev(`(()=>{const b=document.querySelector('.qr-send');b.click();b.click()})()`)
    expect(!await customer.ev(`!!document.querySelector('.qr-confirm')`), 'onay sunucu yanıtından önce göründü')
    await customer.until(`document.querySelector('.qr-confirm')`, 'onay')
    expect((await customer.ev(`document.querySelector('.qr-confirm').innerText`)).includes(qrPrice), 'onay toplamı')
    await customer.shot('customer-confirmed')
    return `2 × ${coffee}, toplam ${qrPrice}`
  })
  await step('Sipariş mutfakta QR olarak görünür, tek kayıt', async () => {
    await kitchen.go('/mutfak')
    await kitchen.until(ticketOf('Masa 5'), 'Masa 5 fişi')
    const t = await kitchen.ev(`${ticketOf('Masa 5')}.innerText`)
    expect(/QR/.test(t) && t.includes('2×') && t.includes('qr notu'), `fiş: ${t}`)
    expect(await kitchen.ev(`${ticketOf('Masa 5')}.classList.contains('kt-from-qr')`), 'QR şeridi')
    expect(await kitchen.ev(`[...document.querySelectorAll('.kt-ticket')].filter(t=>t.querySelector('.kt-ticket-table').textContent==='Masa 5').length`) === 1, 'çift sipariş')
  })
  await step('Mutfak durumu değiştirir, müşteri otomatik görür', async () => {
    await customer.clickText('Siparişlerim', '.qr-confirm button')
    await customer.until(`document.querySelector('.qr-order-new')`, 'müşteri siparişi')
    await kitchen.ev(`${ticketOf('Masa 5')}.querySelector('.kt-action').click()`)
    await customer.until(`document.querySelector('.qr-order-preparing')`, 'müşteride hazırlanıyor', 5000)
    await customer.shot('customer-status')
    expect((await customer.ev(`document.querySelector('.qr-order').innerText`)).includes('qr notu'), 'müşteri kalemi')
  })
  await step('Garson Masa 5 adisyonunda aynı kalemleri görür', async () => {
    await openTable5()
    const bill = await waiter.ev(`document.querySelector('.wt-bill').innerText`)
    expect(bill.includes('2×') && bill.includes('qr notu') && /QR/.test(bill), `adisyon: ${bill}`)
    expect(await billTotal() === qrPrice, 'adisyon toplamı')
  })
  await step('Garson ek sipariş verir; ikisi aynı adisyonda kalır', async () => {
    await waiter.until(`document.querySelector('.wt-product:not(.out)')`, 'katalog')
    await waiter.click('.wt-sheet-close')
    await waiter.click('.wt-product:not(.out)')
    await waiter.until(`document.querySelector('.wt-cart-bar')`, 'sepet çubuğu')
    await waiter.click('.wt-cart-bar')
    await waiter.until(`document.querySelector('.wt-send')`, 'gönder')
    await waiter.click('.wt-send')
    await waiter.until(`document.querySelectorAll('.wt-order').length===2`, 'iki sipariş')
    const sources = await waiter.ev(`[...document.querySelectorAll('.wt-order .pos-source')].map(s=>s.innerText).join('+')`)
    expect(/QR/.test(sources) && /GARSON/i.test(sources), `kaynaklar: ${sources}`)
    await waiter.shot('waiter-mixed-bill')
    return sources
  })
  await step('İkinci müşteri ayrı sipariş verir, garson bildirim alır, ilkini görmez', async () => {
    await waiter.go('/garson')
    await waiter.until(`document.querySelector('.wt-table-card')`, 'masalar')
    await sleep(800)
    const second = await openPage()
    await second.size(390, 844)
    await enterMenu(second, '/masa/demo-5?musteri=2')
    expect(!await second.ev(`!!document.querySelector('.qr-bar')`), 'ikinci müşteri ilkinin kaydını gördü')
    await addFirstProduct(second)
    await second.click('.qr-bar-cart')
    await second.until(`document.querySelector('.qr-send')`, 'sepet')
    await second.click('.qr-send')
    await second.until(`document.querySelector('.qr-confirm')`, 'onay')
    await waiter.until(`document.body.innerText.includes('Yeni QR sipariş')`, 'garson bildirimi', 5000)
    await second.clickText('Siparişlerim', '.qr-confirm button')
    await second.until(`document.querySelectorAll('.qr-order').length===1`, 'yalnızca kendi siparişi')
    second.close()
  })
  await step('Yazma başarısızsa başarı gösterilmez; doğrulama tek sipariş üretir', async () => {
    await customer.clickText('Kapat', 'button')
      .catch(() => customer.click('.qr-sheet-head .pos-icon-btn'))
    await customer.until(`!document.querySelector('.qr-sheet')`, 'sayfa kapandı')
    await customer.until(`document.querySelector('.qr-add')`, 'ekleme düğmesi')
    await customer.click('.qr-add')
    await customer.until(`document.querySelector('.qr-bar-cart')`, 'sepet çubuğu')
    await customer.click('.qr-bar-cart')
    await customer.until(`document.querySelector('.qr-send')`, 'sepet')
    await customer.ev(`(()=>{window.__set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='waypoint-pos-demo-v1')throw new Error('kota');return window.__set.call(this,k,v)}})()`)
    await customer.click('.qr-send')
    await customer.until(`document.querySelector('.qr-uncertain')`, 'belirsiz uyarı')
    expect(!await customer.ev(`!!document.querySelector('.qr-confirm')`), 'yanlış başarı')
    await customer.shot('customer-uncertain')
    await customer.ev(`Storage.prototype.setItem=window.__set`)
    await customer.clickText('Durumu kontrol et')
    await customer.until(`document.querySelector('.qr-confirm')`, 'doğrulama sonrası onay')
    await customer.clickText('Menüye dön')
    await customer.until(`!document.querySelector('.qr-sheet')`, 'sayfa kapandı')
  })
  await step('Yanıt alınamadan sayfa yenilenirse sipariş aynı anahtarla toparlanır, çiftlenmez', async () => {
    const countOrders = () => customer.ev(`Object.values(JSON.parse(localStorage.getItem('waypoint-pos-demo-v1')).bills['demo-masa-5'].orders).length`)
    await customer.until(`document.querySelector('.qr-add')`, 'ekleme düğmesi')
    await customer.click('.qr-add')
    await customer.until(`document.querySelector('.qr-bar-cart')`, 'sepet çubuğu')
    await customer.click('.qr-bar-cart')
    await customer.until(`document.querySelector('.qr-send')`, 'sepet')
    const before = await countOrders()
    await customer.ev(`(()=>{window.__set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='waypoint-pos-demo-v1')throw new Error('kota');return window.__set.call(this,k,v)}})()`)
    await customer.click('.qr-send')
    await customer.until(`document.querySelector('.qr-uncertain')`, 'belirsiz uyarı')
    expect(await countOrders() === before, 'yazım başarısızken kayıt oluştu')
    await enterMenu(customer, '/masa/demo-5')
    await customer.until(`document.querySelector('.qr-confirm')`, 'toparlanma onayı')
    await customer.shot('customer-recovered')
    expect(await countOrders() === before + 1, 'tek sipariş bekleniyordu')
    await customer.clickText('Menüye dön')
    await customer.until(`!document.querySelector('.qr-sheet')`, 'sayfa kapandı')
  })
  await step('Yerleşim: müşteri sepeti tüm ekranlarda taşmaz', async () => {
    await customer.click('.qr-add')
    await customer.until(`document.querySelector('.qr-bar-cart')`, 'sepet çubuğu')
    for (const [width, height, name] of [[320, 640, 'qr-320'], [390, 844, 'qr-390'], [430, 932, 'qr-430'], [820, 1180, 'qr-820'], [1366, 900, 'qr-1366']]) {
      await customer.size(width, height); await sleep(250)
      expect(await customer.overflow() === 0, `${width}px menü taşması`)
      const bar = await customer.ev(`(()=>{const r=document.querySelector('.qr-bar-cart').getBoundingClientRect();return [r.left,r.right,r.height]})()`)
      expect(bar[0] >= 0 && bar[1] <= width && bar[2] >= 44, `${width}px çubuk: ${bar}`)
      await customer.click('.qr-bar-cart')
      await customer.until(`document.querySelector('.qr-send')`, 'sepet')
      await sleep(350)
      const send = await customer.ev(`(()=>{const r=document.querySelector('.qr-send').getBoundingClientRect();return [r.left,r.right,r.bottom,r.height]})()`)
      expect(send[0] >= 0 && send[1] <= width && send[2] <= height && send[3] >= 44, `${width}px Sipariş Ver: ${send}`)
      expect(await customer.ev(`(()=>{const s=document.querySelector('.qr-sheet');return s.scrollWidth<=s.clientWidth})()`), `${width}px sayfa taşması`)
      await customer.shot(name)
      await customer.click('.qr-sheet-head .pos-icon-btn')
      await customer.until(`!document.querySelector('.qr-sheet')`, 'sayfa kapandı')
    }
    await customer.size(390, 844)
  })
  customer.close()

  console.log(results.join('\n'))
  console.log('Konsol hataları:', consoleErrors.length ? [...new Set(consoleErrors)].slice(0, 8).join('\n  ') : 'yok')
  console.log('Supabase yazma istekleri:', writes.length ? writes.join(', ') : 'yok')
  console.log('Ekran görüntüleri:', shots)
  if (writes.length) failed++
  waiter.close(); kitchen.close()
} finally {
  browser.kill()
}
process.exit(failed ? 1 : 0)
