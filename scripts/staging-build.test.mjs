// Netlify staging derleme korumaları: dal, üretime sessiz bağlantı, sır sızıntısı.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCTION_REF, STAGING_REF } from '../src/supabaseTarget.js'
import { REDIRECTS_FILE, SPA_FALLBACK, checkBranch, detectHost, checkBuildEnv, headersFile, scanBundle, netlifyShouldBuild } from './staging-build.lib.mjs'

const jwt = claims => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2lnbmF0dXJl`
const STAGING_URL = `https://${STAGING_REF}.supabase.co`
const anon = jwt({ ref: STAGING_REF, role: 'anon' })
const pushKey = Buffer.from(Uint8Array.from({ length: 65 }, (_, i) => (i ? i : 4))).toString('base64url')
const good = { VITE_SUPABASE_URL: STAGING_URL, VITE_SUPABASE_ANON_KEY: anon, VITE_WEB_PUSH_PUBLIC_KEY: pushKey }

test('dal: Netlify üzerinde yalnızca feature/restaurant-pos production/branch-deploy derlenir; PR önizlemesi reddedilir', () => {
  const netlify = (BRANCH, CONTEXT = 'production') => checkBranch({ NETLIFY: 'true', BRANCH, CONTEXT })
  assert.deepEqual(netlify('feature/restaurant-pos'), { ok: true, host: 'netlify' })
  assert.equal(netlify('feature/restaurant-pos', 'branch-deploy').ok, true)
  for (const branch of ['main', 'feature/other', '', undefined]) assert.equal(netlify(branch).ok, false, String(branch))
  for (const context of ['deploy-preview', 'dev', null]) assert.match(netlify('feature/restaurant-pos', context).error ?? '', /bağlamı derlenmez/, String(context))
  assert.deepEqual([detectHost({ NETLIFY: 'true' }), detectHost({ CF_PAGES: '1' }), detectHost({})], ['netlify', 'local', 'local'])
  assert.equal(checkBranch({}).ok, true, 'yerel derleme')
})

test('yönlendirmeler: SPA yeniden yazımı eski /waypoint kurallarından SONRA gelir', () => {
  const rules = REDIRECTS_FILE.trim().split('\n')
  assert.equal(rules.at(-1), SPA_FALLBACK.trim())
  assert.ok(rules.indexOf('/waypoint/* /:splat 301') < rules.length - 1)
})

test('ortam: doğru staging ayarı geçer; eksik/üretim/servis anahtarı derlemeyi durdurur', () => {
  assert.deepEqual(checkBuildEnv(good, {}).errors, [])
  assert.deepEqual(checkBuildEnv({ ...good, VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc' }, {}).errors, [])
  const bad = [
    [{}, /VITE_SUPABASE_URL/],
    [{ ...good, VITE_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }, /üretim/],
    [{ ...good, VITE_SUPABASE_ANON_KEY: jwt({ ref: PRODUCTION_REF, role: 'anon' }) }, /staging projesine ait değil/],
    [{ ...good, VITE_SUPABASE_ANON_KEY: jwt({ ref: STAGING_REF, role: 'service_role' }) }, /anon/],
    [{ ...good, VITE_SUPABASE_SERVICE_ROLE_KEY: 'x' }, /sır adı/],
    [{ ...good, VITE_VAPID_PRIVATE_KEY: 'x' }, /sır adı/],
    [{ ...good, VITE_OTHER: jwt({ ref: STAGING_REF, role: 'service_role' }) }, /JWT rolü/],
    [{ ...good, VITE_OTHER: 'sb_secret_abc' }, /sb_secret_/],
    [{ ...good, VITE_WEB_PUSH_PUBLIC_KEY: 'kisa' }, /VAPID/],
  ]
  for (const [env, pattern] of bad) assert.match(checkBuildEnv(env, {}).errors.join('\n'), pattern, JSON.stringify(env))
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PRIVATE_KEY', 'PUSH_DISPATCH_SECRET']) {
    assert.match(checkBuildEnv(good, { [name]: 'x' }).errors.join(), new RegExp(name))
  }
  assert.equal(checkBuildEnv({ ...good, VITE_WEB_PUSH_PUBLIC_KEY: '' }, {}).warnings.length, 1)
})

test('paket taraması: üretim adresi/anahtarı, servis JWT, sb_secret ve bilinen sır yakalanır', () => {
  assert.deepEqual(scanBundle([['a.js', `const u="${STAGING_URL}",k="${anon}"`]]), [])
  // supabase-js'in önek denetimi gerçek anahtar değildir.
  assert.deepEqual(scanBundle([['sdk.js', 'e.startsWith(`sb_publishable_`)||e.startsWith(`sb_secret_`)']]), [])
  const problems = scanBundle([
    ['p.js', `fetch("https://${PRODUCTION_REF}.supabase.co/rest")`],
    ['k.js', `k="${jwt({ ref: PRODUCTION_REF, role: 'anon' })}"`],
    ['s.js', `k="${jwt({ ref: STAGING_REF, role: 'service_role' })}"`],
    // Sahte anahtar çalışma anında üretilir: kaynakta anahtar biçimli dize olmasın (GitHub push protection).
    ['x.js', `k="${['sb', 'secret', 'Z'.repeat(31)].join('_')}"`],
    ['v.js', 'const d="VERYSECRETVALUE_0123456789"'],
  ], ['VERYSECRETVALUE_0123456789'])
  assert.equal(problems.length, 5, problems.join('\n'))
})

test('başlıklar ve yönlendirmeler: noindex, çerçeve yasağı, referrer yok (QR anahtarı sızmaz), CSP yalnız staging', () => {
  const headers = headersFile(STAGING_URL)
  for (const needle of ['X-Robots-Tag: noindex', 'X-Frame-Options: DENY', 'Referrer-Policy: no-referrer', "frame-ancestors 'none'",
    `connect-src 'self' https://${STAGING_REF}.supabase.co wss://${STAGING_REF}.supabase.co`, "worker-src 'self'", '/sw.js\n  Cache-Control: no-cache']) {
    assert.ok(headers.includes(needle), needle)
  }
  assert.ok(!headers.includes(PRODUCTION_REF))
  assert.match(REDIRECTS_FILE, /^\/waypoint\/\* \/:splat 301$/m)
})

test('Netlify ignore: yalnızca staging dalının production yayını derlenir; PR önizlemeleri ve diğer dallar atlanır', async () => {
  const build = env => netlifyShouldBuild(env).build
  assert.equal(build({ BRANCH: 'feature/restaurant-pos', CONTEXT: 'production', PULL_REQUEST: 'false' }), true)
  assert.equal(build({ BRANCH: 'feature/restaurant-pos' }), true, 'bağlam yoksa derleme başlar, checkBranch reddeder')
  assert.equal(build({ BRANCH: 'feature/restaurant-pos', CONTEXT: 'deploy-preview', PULL_REQUEST: 'true', REVIEW_ID: '7' }), false)
  assert.equal(build({ BRANCH: 'feature/restaurant-pos', CONTEXT: 'production', PULL_REQUEST: 'true' }), false)
  assert.equal(build({ BRANCH: 'feature/restaurant-pos', REVIEW_ID: '12' }), false)
  for (const context of ['deploy-preview', 'branch-deploy', 'dev']) assert.equal(build({ BRANCH: 'feature/restaurant-pos', CONTEXT: context }), false, context)
  for (const branch of ['main', 'feature/x', undefined]) assert.equal(build({ BRANCH: branch, CONTEXT: 'production' }), false, String(branch))
  // Komut çıkış kodları Netlify sözleşmesine uygun: 0 = atla, 1 = derle.
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const script = fileURLToPath(new URL('./netlify-ignore.mjs', import.meta.url))
  const run = env => spawnSync(process.execPath, [script], { env: { ...process.env, PULL_REQUEST: '', REVIEW_ID: '', ...env } }).status
  assert.equal(run({ BRANCH: 'feature/restaurant-pos', CONTEXT: 'production' }), 1)
  assert.equal(run({ BRANCH: 'feature/restaurant-pos', CONTEXT: 'deploy-preview', PULL_REQUEST: 'true' }), 0)
  assert.equal(run({ BRANCH: 'main', CONTEXT: 'production' }), 0)
})
