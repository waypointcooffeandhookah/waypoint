// Staging personel hesaplarını Supabase Authentication Admin API ile oluşturur (auth.users'a SQL yazılmaz).
// Çalıştırma: npm run staging:staff  → service_role anahtarı gizli olarak sorulur.
// Anahtar hiçbir yere yazılmaz. Üretilen şifreler yalnızca git dışı .staging-credentials.local dosyasına
// kaydedilir, ekrana basılmaz. Tekrar çalıştırılırsa aynı hesapların şifresi yenilenir.
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { STAGING_REF } from '../src/supabaseTarget.js'

const ACCOUNTS = [
  { role: 'admin', email: 'admin@waypoint-staging.test', name: 'Staging Yönetici' },
  { role: 'waiter', email: 'garson@waypoint-staging.test', name: 'Staging Garson' },
  { role: 'kitchen', email: 'mutfak@waypoint-staging.test', name: 'Staging Mutfak' },
]
const root = new URL('../', import.meta.url)
const URL_EXPECTED = `https://${STAGING_REF}.supabase.co`

function readUrl() {
  const line = readFileSync(new URL('.env.staging.local', root), 'utf8').split(/\r?\n/).find(l => l.startsWith('VITE_SUPABASE_URL='))
  return line?.slice('VITE_SUPABASE_URL='.length).trim()
}

function promptHidden(label) {
  if (!process.stdin.isTTY) throw new Error('Anahtar girişi için etkileşimli terminal gerekir.')
  return new Promise((resolve, reject) => {
    let value = ''
    process.stdout.write(label)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', function onData(chunk) {
      for (const char of chunk) {
        if (char === '\u0003') { process.stdin.setRawMode(false); reject(new Error('İptal edildi.')); return }
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(value.trim())
          return
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else value += char
      }
    })
  })
}

// Yanlış projenin anahtarı kullanılmasın; eski tip JWT anahtarında proje ve rol denetlenebilir.
function checkKey(key) {
  if (key.startsWith('sb_secret_')) return
  try {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
    if (claims.ref !== STAGING_REF) throw new Error('Anahtar staging projesine ait değil; işlem durduruldu.')
    if (claims.role !== 'service_role') throw new Error('Bu bir service_role anahtarı değil.')
  } catch (error) {
    throw error instanceof SyntaxError ? new Error('Anahtar biçimi tanınmadı.') : error
  }
}

async function findUser(admin, email) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const found = data.users.find(user => user.email === email)
    if (found || data.users.length < 200) return found
  }
}

async function ensureAccount(admin, account) {
  const password = randomBytes(24).toString('base64url')
  const app_metadata = account.role === 'admin' ? { role: 'admin' } : {}
  const created = await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, app_metadata })
  let userId = created.data?.user?.id
  if (created.error) {
    const existing = await findUser(admin, account.email)
    if (!existing) throw new Error(`${account.email}: ${created.error.message}`)
    const updated = await admin.auth.admin.updateUserById(existing.id, { password, app_metadata })
    if (updated.error) throw new Error(`${account.email}: ${updated.error.message}`)
    userId = existing.id
  }
  const { error } = await admin.from('staff_profiles').upsert({ user_id: userId, display_name: account.name, role: account.role, is_active: true })
  if (error) throw new Error(`${account.email} profili: ${error.message}`)
  return { email: account.email, password }
}

try {
  const url = readUrl()
  if (url !== URL_EXPECTED) throw new Error('.env.staging.local staging projesini göstermiyor; işlem durduruldu.')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || await promptHidden('Staging service_role anahtarı (görünmez): ')
  checkKey(key)
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const credentials = {}
  for (const account of ACCOUNTS) {
    credentials[account.role] = await ensureAccount(admin, account)
    console.log(`Hazır: ${account.role} → ${account.email}`)
  }
  writeFileSync(new URL('.staging-credentials.local', root), JSON.stringify(credentials, null, 2), { mode: 0o600 })
  console.log('Şifreler .staging-credentials.local dosyasına kaydedildi (git dışı).')
  process.exit(0)
} catch (error) {
  console.error(`Hata: ${error.message}`)
  process.exit(1)
}
