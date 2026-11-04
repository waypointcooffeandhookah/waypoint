// Netlify STAGING derlemesi: npm run build:netlify
// 1) Dal ve ortam denetimi (yanlış dal / üretim Supabase / sır varsa derleme DÜŞER, sessizce devam etmez)
// 2) vite build --mode staging --base=/  → dist-staging/
// 3) 404.html kaldırılır, _headers/_redirects (SPA yeniden yazımı dahil)/robots.txt yazılır
// 4) Çıktı paketi taranır: yalnızca staging anon/publishable anahtar, sır yok
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { OUT_DIR, ROBOTS, REDIRECTS_FILE, checkBranch, checkBuildEnv, headersFile, scanBundle } from './staging-build.lib.mjs'

const rootPath = fileURLToPath(new URL('../', import.meta.url))
const fail = message => { console.error(`\n✖ Staging derlemesi durduruldu: ${message}\n`); process.exit(1) }

const branch = checkBranch(process.env)
if (!branch.ok) fail(branch.error)
if (branch.note) console.log(`ℹ ${branch.note}`)
console.log(`ℹ barındırma: ${branch.host}`)

const viteEnv = loadEnv('staging', rootPath, 'VITE_')
const { errors, warnings } = checkBuildEnv(viteEnv, process.env)
if (errors.length) fail(errors.join('\n  - '))
warnings.forEach(w => console.warn(`⚠ ${w}`))

const out = join(rootPath, OUT_DIR)
rmSync(out, { recursive: true, force: true })
execFileSync(process.execPath, [join(rootPath, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'staging', '--base=/', '--outDir', OUT_DIR, '--emptyOutDir'],
  { cwd: rootPath, stdio: 'inherit' })

// public/404.html GitHub Pages içindir (eski, sabit hash'li dosya adları taşır); SPA yeniden yazımını gölgeler.
rmSync(join(out, '404.html'), { force: true })
writeFileSync(join(out, '_headers'), headersFile(viteEnv.VITE_SUPABASE_URL))
writeFileSync(join(out, '_redirects'), REDIRECTS_FILE)
writeFileSync(join(out, 'robots.txt'), ROBOTS)

const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})
const files = walk(out).filter(path => /\.(js|mjs|html|css|json|webmanifest|txt|map)$|_headers$|_redirects$/.test(path))
  .map(path => [path.slice(out.length + 1), readFileSync(path, 'utf8')])

// Yerelde üretilmiş push sırları da pakette aranır.
const secrets = ['SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PRIVATE_KEY', 'PUSH_DISPATCH_SECRET'].map(name => process.env[name])
const secretFile = join(rootPath, '.staging-push-secrets.local')
if (existsSync(secretFile)) {
  for (const line of readFileSync(secretFile, 'utf8').split('\n')) {
    const [name, value] = line.split('=')
    if (name === 'VAPID_PRIVATE_KEY' || name === 'PUSH_DISPATCH_SECRET') secrets.push(value?.trim())
  }
}
const problems = scanBundle(files, secrets)
if (problems.length) {
  rmSync(out, { recursive: true, force: true })
  fail(`paket güvenlik taraması:\n  - ${problems.join('\n  - ')}`)
}

const index = readFileSync(join(out, 'index.html'), 'utf8')
for (const [ok, what] of [
  [!existsSync(join(out, '404.html')), '404.html kaldırıldı'],
  [existsSync(join(out, 'sw.js')), 'sw.js var'],
  [index.includes('manifest.webmanifest'), 'manifest bağlantısı var'],
  [index.includes('src="/assets/'), 'varlıklar kök yoldan (/assets/) yükleniyor'],
  [readFileSync(join(out, '_redirects'), 'utf8').includes('/* /index.html 200'), 'SPA yeniden yazımı (_redirects) var'],
]) if (!ok) fail(`çıktı denetimi: ${what} değil`)

console.log(`\n✔ Staging paketi hazır: ${OUT_DIR}/ (${files.length} dosya tarandı, sorun yok)`)
