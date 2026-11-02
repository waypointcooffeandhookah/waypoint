// Cloudflare Pages staging paketinin yerel duman testi (npm run test:cloudflare:smoke).
// Önce: npm run build:cloudflare. dist-staging/ klasörünü Cloudflare Pages davranışını taklit eden
// küçük bir sunucuyla yayınlar (_headers + _redirects + 404.html yokken SPA geri dönüşü) ve başsız
// Chrome'da açar: CSP ihlali, JS hatası, yönlendirme ve service worker kaydı denetlenir.
// Bu, Cloudflare'in kendisi DEĞİLDİR; gerçek dağıtımdan sonra aynı kontroller canlı adreste tekrarlanmalıdır.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../../dist-staging/', import.meta.url))
if (!existsSync(join(OUT, 'index.html'))) { console.error('Önce: npm run build:cloudflare'); process.exit(2) }
const BROWSER = [process.env.E2E_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome']
  .find(path => path && existsSync(path))
if (!BROWSER) { console.error('Chrome veya Edge bulunamadı.'); process.exit(2) }

// ── Cloudflare Pages taklidi ───────────────────────────────────
function parseHeaders(text) {
  const rules = []
  let current = null
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    if (!line.startsWith(' ')) { current = { pattern: line.trim(), headers: {} }; rules.push(current); continue }
    const [name, ...rest] = line.trim().split(':')
    current.headers[name] = rest.join(':').trim()
  }
  return rules
}
const headerRules = parseHeaders(readFileSync(join(OUT, '_headers'), 'utf8'))
const matches = (pattern, path) => pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.jpg': 'image/jpeg', '.webp': 'image/webp' }

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path === '/waypoint' || path.startsWith('/waypoint/')) {
    res.writeHead(301, { Location: path.slice('/waypoint'.length) || '/' })
    return res.end()
  }
  let file = normalize(join(OUT, path))
  if (!file.startsWith(normalize(OUT))) { res.writeHead(400); return res.end() }
  let served = path
  if (!existsSync(file) || statSync(file).isDirectory()) { file = join(OUT, 'index.html'); served = '/index.html' }
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }
  for (const rule of headerRules) if (matches(rule.pattern, path) || matches(rule.pattern, served)) Object.assign(headers, rule.headers)
  res.writeHead(200, headers)
  res.end(readFileSync(file))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const ORIGIN = `http://localhost:${server.address().port}`

// ── Başsız Chrome (CDP) ────────────────────────────────────────
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const port = 9480 + Math.floor(Math.random() * 100)
const temp = mkdtempSync(join(tmpdir(), 'waypoint-cf-smoke-'))
const chrome = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${temp}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
for (let i = 0; i < 60; i++) { if (await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.ok).catch(() => false)) break; await sleep(250) }
const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json())
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => { ws.onopen = resolve })
let id = 0
const waiting = new Map()
const problems = []
ws.onmessage = event => {
  const m = JSON.parse(event.data)
  if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') problems.push(`JS hatası: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`)
  if (m.method === 'Log.entryAdded' && /Content Security Policy|Refused to/i.test(m.params.entry.text)) problems.push(`CSP: ${m.params.entry.text}`)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ')
    if (/Content Security Policy|Refused to/i.test(text)) problems.push(`CSP: ${text}`)
  }
}
const cdp = (method, params = {}) => new Promise(resolve => {
  const msg = { id: ++id, method, params }
  waiting.set(msg.id, resolve)
  ws.send(JSON.stringify(msg))
})
const evaluate = async expression => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
await cdp('Runtime.enable')
await cdp('Log.enable')
await cdp('Page.enable')

const checks = []
const check = (ok, label) => { checks.push([ok, label]); console.log(`${ok ? '✔' : '✖'} ${label}`) }

async function visit(path, wait = 2500) {
  await cdp('Page.navigate', { url: `${ORIGIN}${path}` })
  await sleep(wait)
  return evaluate('location.pathname')
}

check(await visit('/') === '/', 'kök menü açılır')
check(await visit('/waypoint/garson') === '/garson', 'eski /waypoint/garson bağlantısı /garson adresine taşınır')
check(await visit('/masa/ornek-qr-anahtari') === '/masa/ornek-qr-anahtari', 'derin bağlantı (QR masa yolu) SPA geri dönüşüyle açılır')
check(await visit('/mutfak') === '/mutfak', 'mutfak ekranı yolu açılır')
const staffLogin = await evaluate("!!document.querySelector('input[type=password]')")
await visit('/garson')
check(staffLogin !== undefined && await evaluate("!!document.querySelector('input[type=password]')"), 'garson paneli personel girişi ister')
check(await evaluate("document.querySelector('.staging-badge')?.textContent?.includes('STAGING')"), 'STAGING etiketi görünür')
check(await evaluate("document.querySelector('meta[name=robots]')?.content === 'noindex, nofollow'"), 'noindex meta etiketi var')
const manifest = await evaluate("fetch('/manifest.webmanifest').then(r => r.json()).then(m => m.start_url + '|' + m.display)")
check(manifest === '/garson|standalone', `manifest: ${manifest}`)
const sw = await evaluate("navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready).then(r => r.active ? 'active' : 'pending').catch(e => 'error: ' + e.message)")
check(sw === 'active', `service worker CSP altında kaydolur ve etkinleşir (${sw})`)
const notFound = await fetch(`${ORIGIN}/404.html`).then(r => r.text())
check(!notFound.includes('index-BVEYOfSL'), 'eski GitHub Pages 404.html yayınlanmıyor')
const head = await fetch(`${ORIGIN}/`).then(r => r.headers)
check(head.get('referrer-policy') === 'no-referrer' && head.get('x-frame-options') === 'DENY' && head.get('content-security-policy')?.includes("script-src 'self'"), 'güvenlik başlıkları uygulanıyor')
check(problems.length === 0, `CSP ihlali / JS hatası yok${problems.length ? `:\n   ${[...new Set(problems)].join('\n   ')}` : ''}`)

// Pozitif kontrol: dedektör gerçekten çalışıyor mu? Satır içi betik CSP tarafından engellenmeli ve yakalanmalı.
const before = problems.length
await evaluate("(() => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.body.appendChild(s) })()")
await sleep(500)
check(problems.length > before && await evaluate('window.__inline') === undefined, 'pozitif kontrol: satır içi betik engellendi ve ihlal yakalandı')

ws.close()
chrome.kill()
server.close()
await sleep(300)
try { rmSync(temp, { recursive: true, force: true }) } catch { /* Chrome dosyayı bırakmamış olabilir. */ }
const failed = checks.filter(([ok]) => !ok).length
console.log(failed ? `\n✖ ${failed} denetim başarısız` : '\n✔ Tüm duman denetimleri geçti (yerel Cloudflare taklidi)')
process.exit(failed ? 1 : 0)
