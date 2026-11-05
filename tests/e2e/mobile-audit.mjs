// Telefon uyumu denetimi (yalnızca okur): iPhone boyutunda (390×844, @3x, dokunmatik) her ekranı açar ve
//  - yatay taşma (sayfanın ekrandan geniş olması, sağa kayma),
//  - iOS'un odaklanınca otomatik yakınlaştırdığı 16px altı yazı kutuları,
//  - 40px'ten küçük dokunma hedefleri
// listeler; ekran görüntülerini E2E_SHOTS klasörüne kaydeder.
// Ortam: E2E_BASE (varsayılan canlı staging), E2E_SHOTS (varsayılan: işletim sistemi geçici klasörü).
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { STAGING_REF } from '../../src/supabaseTarget.js'

const BASE = process.env.E2E_BASE ?? 'https://waypointcoffeandhookah.netlify.app'
const SHOTS = process.env.E2E_SHOTS ?? mkdtempSync(join(tmpdir(), 'waypoint-mobile-'))
const WIDTH = Number(process.env.E2E_WIDTH ?? 390), HEIGHT = Number(process.env.E2E_HEIGHT ?? 844)
const BROWSER = [process.env.E2E_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find(Boolean)
const root = new URL('../../', import.meta.url)
const env = Object.fromEntries(readFileSync(new URL('.env.staging.local', root), 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!env.VITE_SUPABASE_URL?.includes(STAGING_REF)) throw new Error('hedef staging değil')
const creds = JSON.parse(readFileSync(new URL('.staging-credentials.local', root), 'utf8'))
const tokens = JSON.parse(readFileSync(new URL('.staging-qr.local', root), 'utf8'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
mkdirSync(SHOTS, { recursive: true })

async function session(role) {
  const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await db.auth.signInWithPassword(creds[role])
  if (error) throw new Error(`${role} girişi: ${error.message}`)
  return data.session
}

async function browser() {
  const port = 9460 + Math.floor(Math.random() * 300)
  const temp = mkdtempSync(join(tmpdir(), 'waypoint-audit-'))
  const proc = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${temp}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) { if (await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.ok).catch(() => false)) break; await sleep(250) }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json())
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => { ws.onopen = resolve })
  let id = 0
  const waiting = new Map()
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id) } }
  const cdp = (method, params = {}) => new Promise(resolve => { const n = ++id; waiting.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })) })
  const ev = async expression => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
  await cdp('Page.enable'); await cdp('Runtime.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 3, mobile: true })
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1' })
  return { cdp, ev, close: () => { ws.close(); proc.kill(); setTimeout(() => rmSync(temp, { recursive: true, force: true }), 1500) } }
}

const AUDIT = `(() => {
  const vw = innerWidth, out = { scrollWidth: document.documentElement.scrollWidth, vw, overflow: [], smallInputs: [], smallTargets: [] }
  const name = el => (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') || el.tagName.toLowerCase()
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    if (!r.width || cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed' && r.right <= 0) continue
    if (r.right > vw + 1 && r.left < vw) {
      let p = el.parentElement, clipped = false
      while (p && p !== document.body) { const s = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(s.overflowX)) { clipped = true; break } p = p.parentElement }
      if (!clipped) out.overflow.push(name(el) + ' →' + Math.round(r.right - vw) + 'px')
    }
    if (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), textarea, select') && parseFloat(cs.fontSize) < 16) out.smallInputs.push(name(el) + ' ' + cs.fontSize)
    if (el.matches('button, a[href], [role=button], input[type=checkbox], select') && r.top < innerHeight * 3 && (r.width < 40 || r.height < 40) && r.width > 0) out.smallTargets.push(name(el) + ' ' + Math.round(r.width) + '×' + Math.round(r.height))
  }
  out.overflow = [...new Set(out.overflow)].slice(0, 12); out.smallInputs = [...new Set(out.smallInputs)].slice(0, 12); out.smallTargets = [...new Set(out.smallTargets)].slice(0, 15)
  return out
})()`

const PAGES = [
  { name: 'menu', path: '/', ready: `document.querySelector('.hero-viewport, .menu-search')`, enter: true },
  { name: 'masa-qr', path: `/masa/${tokens['Masa 9']}`, ready: `document.querySelector('.hero-viewport, .menu-search')`, enter: true },
  { name: 'garson-giris', path: '/garson', ready: `document.querySelector('input[type=password], input[type=email]')` },
  { name: 'garson', path: '/garson', role: 'waiter', ready: `document.querySelector('.wt-table, .wt-tables, [data-table]')` },
  { name: 'mutfak', path: '/mutfak', role: 'kitchen', ready: `document.querySelector('.kt-board, .kt-column, .pos-title, main')` },
  { name: 'paket-kurye', path: '/siparisler', role: 'admin', ready: `document.querySelector('main')` },
  { name: 'yonetim-panel', path: '/admin', role: 'admin', ready: `document.querySelector('.ad-stats')` },
  { name: 'yonetim-ciro', path: '/admin/ciro', role: 'admin', ready: `document.querySelector('.ad-revenue-stats')` },
  { name: 'yonetim-masalar', path: '/admin/masalar', role: 'admin', ready: `document.querySelector('.ad-table')` },
  { name: 'yonetim-ayarlar', path: '/admin/ayarlar', role: 'admin', ready: `document.querySelector('.ad-settings')` },
  { name: 'yonetim-menu', path: '/admin/menu', role: 'admin', ready: `document.querySelector('main, .admin-content, input')` },
]

const sessions = {}
const report = []
const b = await browser()
try {
  for (const page of PAGES.filter(p => !process.env.E2E_ONLY || process.env.E2E_ONLY.split(',').includes(p.name))) {
    await b.cdp('Page.navigate', { url: BASE + '/' })
    await sleep(800)
    await b.ev(`localStorage.clear(); sessionStorage.clear()`)
    if (page.role) {
      sessions[page.role] ??= await session(page.role)
      await b.ev(`localStorage.setItem('sb-${STAGING_REF}-auth-token', ${JSON.stringify(JSON.stringify(sessions[page.role]))})`)
    }
    await b.cdp('Page.navigate', { url: BASE + page.path })
    const end = Date.now() + 20000
    while (Date.now() < end && !await b.ev(`!!(${page.ready})`)) await sleep(200)
    if (page.enter && await b.ev(`!!document.querySelector('.hero-viewport')`)) {
      await b.ev(`[...document.querySelectorAll('button')].find(x=>x.innerText.includes('MENÜYÜ KEŞFET'))?.click()`)
      await sleep(1500)
      await b.ev(`document.querySelector('.promotion-close')?.click()`)
    }
    await sleep(1500)
    const audit = await b.ev(AUDIT)
    const shot = await b.cdp('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
    writeFileSync(join(SHOTS, `${page.name}.jpg`), Buffer.from(shot.result.data, 'base64'))
    report.push({ page: page.name, ...audit })
  }
} finally { b.close() }

for (const r of report) {
  const flag = r.scrollWidth > r.vw || r.overflow.length || r.smallInputs.length ? '✖' : '✔'
  console.log(`${flag} ${r.page}: genişlik ${r.scrollWidth}/${r.vw}`)
  if (r.overflow.length) console.log(`   taşan: ${r.overflow.join(', ')}`)
  if (r.smallInputs.length) console.log(`   iOS yakınlaştırır (<16px): ${r.smallInputs.join(', ')}`)
  if (r.smallTargets.length) console.log(`   küçük dokunma hedefi: ${r.smallTargets.join(', ')}`)
}
console.log(`\nEkran görüntüleri: ${SHOTS}`)
