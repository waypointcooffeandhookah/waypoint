// Staging personel betiğinin ağdan ve terminalden bağımsız mantığı (test edilebilir).
import { randomBytes } from 'node:crypto'
import { STAGING_REF } from '../src/supabaseTarget.js'

export const STAGING_URL = `https://${STAGING_REF}.supabase.co`
export const ACCOUNTS = [
  { role: 'admin', email: 'admin@waypoint-staging.test', name: 'Staging Yönetici' },
  { role: 'waiter', email: 'garson@waypoint-staging.test', name: 'Staging Garson' },
  { role: 'kitchen', email: 'mutfak@waypoint-staging.test', name: 'Staging Mutfak' },
]

export const newPassword = () => randomBytes(24).toString('base64url')

// Hata iletileri anahtarın hiçbir parçasını içermez. sb_secret_ anahtarında proje bilgisi yoktur;
// yanlış projenin anahtarı yalnızca staging adresine gider ve orada reddedilir.
export function checkAdminKey(key) {
  if (/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(key)) return 'secret'
  if (key.startsWith('sb_')) throw new Error('Bu bir sb_secret_ anahtarı değil.')
  let claims = null
  try {
    claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
  } catch { /* Aşağıda tek tip hata verilir. */ }
  if (!claims) throw new Error('Anahtar biçimi tanınmadı.')
  if (claims.ref !== STAGING_REF) throw new Error('Anahtar staging projesine ait değil; işlem durduruldu.')
  if (claims.role !== 'service_role') throw new Error('Bu bir yönetici anahtarı değil.')
  return 'legacy'
}

// Yönetici anahtarı yalnızca staging kökenine gider; yönlendirme izlenmez.
export function guardedFetch(input, init, baseFetch = fetch) {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input)
  if (url.origin !== STAGING_URL) throw new Error('Staging dışına istek engellendi.')
  return baseFetch(input, { ...init, redirect: 'error' })
}

async function listAllUsers(admin) {
  const users = []
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`Kullanıcılar okunamadı: ${error.message}`)
    users.push(...data.users)
    if (data.users.length < 200) return users
  }
}

// Eksik profili ekler, var olan profili asla değiştirmez.
async function ensureProfile(admin, userId, account) {
  const { data, error } = await admin.from('staff_profiles').select('role').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(`${account.email} profili okunamadı: ${error.message}`)
  if (data) return data.role
  const inserted = await admin.from('staff_profiles').insert({ user_id: userId, display_name: account.name, role: account.role, is_active: true })
  if (inserted.error) throw new Error(`${account.email} profili eklenemedi: ${inserted.error.message}`)
  return account.role
}

// Var olan hesabın şifresine ve yetki bilgisine dokunulmaz: yalnızca eksik hesap oluşturulur.
// Şifre, profil yazılmadan önce kaydedilir; yarıda kesilirse yeniden çalıştırmak güvenlidir.
export async function provisionStaff(admin, credentials, save, log) {
  const users = await listAllUsers(admin)
  for (const account of ACCOUNTS) {
    let user = users.find(item => item.email?.toLowerCase() === account.email)
    if (user) {
      log(`Atlandı (zaten var, değiştirilmedi): ${account.role} → ${account.email}`)
      if (!credentials[account.role]) log(`  Uyarı: ${account.email} şifresi bu bilgisayarda kayıtlı değil; gerekirse panelden sıfırlayın.`)
    } else {
      const password = newPassword()
      const created = await admin.auth.admin.createUser({
        email: account.email, password, email_confirm: true,
        app_metadata: account.role === 'admin' ? { role: 'admin' } : {},
      })
      if (created.error) throw new Error(`${account.email} oluşturulamadı: ${created.error.message}`)
      user = created.data.user
      credentials[account.role] = { email: account.email, password }
      save(credentials)
      log(`Oluşturuldu: ${account.role} → ${account.email}`)
    }
    const role = await ensureProfile(admin, user.id, account)
    if (role !== account.role) log(`  Uyarı: ${account.email} profil rolü "${role}", beklenen "${account.role}". Değiştirilmedi.`)
  }
}
