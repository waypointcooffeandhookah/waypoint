// Hangi Supabase projesine bağlanılacağının saf kararı. Staging modunda (vite --mode staging)
// yapılandırma eksik veya hatalıysa bağlantı kurulmaz; üretime asla sessizce düşülmez.
export const STAGING_REF = 'jnnjijmdzcjglclcnwtm'
export const PRODUCTION_REF = 'vuqypdluduvqklickadn'
// Hiçbir yere bağlanamayan adres: uygulama açılmasa bile istemci üretime gidemez.
const CLOSED = { url: 'https://staging-config-invalid.invalid', key: 'invalid' }

function jwtClaims(key) {
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')))
  } catch {
    return null
  }
}

function stagingProblem(url, key) {
  if (!url) return 'VITE_SUPABASE_URL tanımlı değil'
  if (url === `https://${PRODUCTION_REF}.supabase.co` || url.includes(PRODUCTION_REF)) return 'adres üretim projesini gösteriyor'
  if (url !== `https://${STAGING_REF}.supabase.co`) return 'adres staging projesi değil'
  if (!key) return 'VITE_SUPABASE_ANON_KEY tanımlı değil'
  if (key.startsWith('sb_publishable_')) return null
  const claims = jwtClaims(key)
  if (!claims) return 'anahtar geçerli bir anon veya publishable anahtar değil'
  if (claims.role !== 'anon') return 'tarayıcıda yalnızca anon anahtar kullanılabilir'
  if (claims.ref !== STAGING_REF) return 'anahtar staging projesine ait değil'
  return null
}

export function resolveSupabaseTarget(env, productionFallback) {
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY
  if (env.MODE !== 'staging') return { staging: false, error: null, url: url || productionFallback.url, key: key || productionFallback.key }
  const problem = stagingProblem(url, key)
  return problem ? { staging: true, error: problem, ...CLOSED } : { staging: true, error: null, url, key }
}
