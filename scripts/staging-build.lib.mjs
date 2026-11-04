// Netlify staging derlemesinin saf denetimleri (scripts/staging-build.mjs kullanır, testler doğrular).
import { STAGING_REF, resolveSupabaseTarget } from '../src/supabaseTarget.js'

export const STAGING_BRANCH = 'feature/restaurant-pos'
export const OUT_DIR = 'dist-staging'

// Derleme ortamında bulunmaması gereken sunucu sırları (Netlify ortam değişkenlerine hiç konmamalı).
export const FORBIDDEN_ENV = ['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY', 'VAPID_PRIVATE_KEY', 'PUSH_DISPATCH_SECRET', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']

function jwtClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

// Derlemeyi yapan ortam: Netlify NETLIFY=true tanımlar; diğer her durum yerel derlemedir.
export function detectHost(env) {
  return env.NETLIFY === 'true' ? 'netlify' : 'local'
}

// Başka dal staging'e yayınlanamaz. Netlify'da PR önizlemeleri (deploy-preview) de reddedilir:
// herkese açık ikinci bir adres aynı staging veritabanına bağlanmasın.
export function checkBranch(env) {
  const host = detectHost(env)
  if (host === 'local') return { ok: true, host, note: 'yerel derleme: dal denetimi atlandı' }
  const branch = env.BRANCH
  if (branch !== STAGING_BRANCH) return { ok: false, host, error: `yalnızca ${STAGING_BRANCH} dalı derlenir (gelen: ${branch || 'yok'})` }
  if (!['production', 'branch-deploy'].includes(env.CONTEXT)) {
    return { ok: false, host, error: `Netlify ${env.CONTEXT || 'bilinmeyen'} bağlamı derlenmez (yalnızca production / branch-deploy)` }
  }
  return { ok: true, host }
}

// Netlify "ignore" adımı (derleme başlamadan): yalnızca staging dalının production yayını derlenir. PR önizlemeleri ve
// başka dallar hiç derlenmez; böylece herkese açık deploy-preview adresi de oluşmaz. Bağlam bilinmiyorsa derleme
// başlar ve checkBranch yine reddeder (iki katmanlı koruma).
export function netlifyShouldBuild(env) {
  if (env.PULL_REQUEST === 'true' || (env.REVIEW_ID ?? '') !== '') return { build: false, reason: 'PR önizlemesi (deploy preview) derlenmez' }
  if (env.CONTEXT && env.CONTEXT !== 'production') return { build: false, reason: `Netlify ${env.CONTEXT} bağlamı derlenmez` }
  if (env.BRANCH !== STAGING_BRANCH) return { build: false, reason: `yalnızca ${STAGING_BRANCH} derlenir (gelen: ${env.BRANCH || 'yok'})` }
  return { build: true, reason: `${STAGING_BRANCH} production yayını` }
}

// viteEnv: Vite'ın staging modunda göreceği VITE_* değerleri (loadEnv), processEnv: tüm derleme ortamı.
export function checkBuildEnv(viteEnv, processEnv) {
  const errors = []
  const target = resolveSupabaseTarget({ MODE: 'staging', ...viteEnv }, null)
  if (target.error) errors.push(`Supabase staging ayarı: ${target.error}`)
  for (const name of FORBIDDEN_ENV) if (processEnv[name]) errors.push(`${name} derleme ortamında olmamalı (sunucu sırrı)`)
  for (const [name, value] of Object.entries(viteEnv)) {
    if (!name.startsWith('VITE_')) continue
    if (/SERVICE|SECRET|PRIVATE|PASSWORD|TOKEN/i.test(name)) errors.push(`${name}: VITE_ ile başlayan değişken tarayıcı paketine girer; sır adı taşıyamaz`)
    if (typeof value === 'string' && value.startsWith('sb_secret_')) errors.push(`${name}: gizli (sb_secret_) anahtar`)
    const claims = typeof value === 'string' && /^eyJ/.test(value) ? jwtClaims(value) : null
    if (claims && claims.role !== 'anon') errors.push(`${name}: JWT rolü "${claims.role}" — yalnızca anon olabilir`)
  }
  const pushKey = viteEnv.VITE_WEB_PUSH_PUBLIC_KEY
  if (pushKey) {
    let bytes = null
    try { bytes = Buffer.from(pushKey, 'base64url') } catch { /* aşağıda hata */ }
    if (!bytes || bytes.length !== 65 || bytes[0] !== 4 || !/^[A-Za-z0-9_-]+$/.test(pushKey)) errors.push('VITE_WEB_PUSH_PUBLIC_KEY geçerli bir VAPID genel anahtarı değil (65 bayt, base64url)')
  }
  return { errors, warnings: pushKey ? [] : ['VITE_WEB_PUSH_PUBLIC_KEY yok: arka plan bildirimi arayüzü kapalı kalır'] }
}

// Paket taraması: üretim projesine işaret eden adres/anahtar, anon dışı JWT veya bilinen sır varsa derleme düşer.
export function scanBundle(files, secrets = []) {
  const problems = []
  for (const [name, text] of files) {
    for (const token of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []) {
      const claims = jwtClaims(token)
      if (!claims || claims.role !== 'anon' || claims.ref !== STAGING_REF) problems.push(`${name}: staging anon olmayan JWT (ref=${claims?.ref}, role=${claims?.role})`)
    }
    for (const [, ref] of text.matchAll(/([a-z0-9]{20})\.supabase\.(?:co|in)/g)) {
      if (ref !== STAGING_REF) problems.push(`${name}: başka Supabase projesi adresi (${ref})`)
    }
    // supabase-js kendi içinde "sb_secret_" önekini denetler; yalnızca gerçek anahtar biçimi aranır.
    if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) problems.push(`${name}: sb_secret_ anahtarı`)
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) problems.push(`${name}: özel anahtar bloğu`)
    for (const secret of secrets) if (secret && secret.length >= 16 && text.includes(secret)) problems.push(`${name}: sunucu sırrı pakette`)
  }
  return problems
}

export function headersFile(supabaseUrl) {
  const host = new URL(supabaseUrl).host
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' https://${host} wss://${host}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
  return `/*
  X-Robots-Tag: noindex, nofollow
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Strict-Transport-Security: max-age=31536000
  Content-Security-Policy: ${csp}

/sw.js
  Cache-Control: no-cache

/manifest.webmanifest
  Content-Type: application/manifest+json
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`
}

// GitHub Pages biçimindeki eski /waypoint/... bağlantıları (QR dahil) kök yola taşınır.
// Çıktıda 404.html OLMAMALIDIR. /garson, /masa/... yenilenince index.html'e yeniden yazılır (SPA);
// Netlify gölgelemez: gerçek dosya (sw.js, assets) varsa kural uygulanmaz. Sıra önemlidir: önce eski yollar.
export const REDIRECTS = `/waypoint /  301
/waypoint/* /:splat 301
`
export const SPA_FALLBACK = '/* /index.html 200\n'
export const REDIRECTS_FILE = REDIRECTS + SPA_FALLBACK

export const ROBOTS = 'User-agent: *\nDisallow: /\n'
