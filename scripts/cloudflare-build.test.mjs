// Cloudflare Pages staging derleme korumaları: dal, üretime sessiz bağlantı, sır sızıntısı.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCTION_REF, STAGING_REF } from '../src/supabaseTarget.js'
import { REDIRECTS, checkBranch, checkBuildEnv, headersFile, scanBundle } from './cloudflare-build.lib.mjs'

const jwt = claims => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2lnbmF0dXJl`
const STAGING_URL = `https://${STAGING_REF}.supabase.co`
const anon = jwt({ ref: STAGING_REF, role: 'anon' })
const pushKey = Buffer.from(Uint8Array.from({ length: 65 }, (_, i) => (i ? i : 4))).toString('base64url')
const good = { VITE_SUPABASE_URL: STAGING_URL, VITE_SUPABASE_ANON_KEY: anon, VITE_WEB_PUSH_PUBLIC_KEY: pushKey }

test('dal: Cloudflare üzerinde yalnızca feature/restaurant-pos derlenir', () => {
  assert.equal(checkBranch({ CF_PAGES: '1', CF_PAGES_BRANCH: 'feature/restaurant-pos' }).ok, true)
  for (const branch of ['main', 'feature/other', '']) assert.equal(checkBranch({ CF_PAGES: '1', CF_PAGES_BRANCH: branch }).ok, false, branch)
  assert.equal(checkBranch({}).ok, true)
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
  assert.match(REDIRECTS, /^\/waypoint\/\* \/:splat 301$/m)
})
