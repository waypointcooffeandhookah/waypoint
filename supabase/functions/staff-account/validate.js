// Personel hesabı isteklerinin doğrulaması (Edge Function ve Node testleri ortak kullanır).
// Panelden yalnızca Garson ve Mutfak hesabı açılır; sistemde tek Admin vardır.
export const STAFF_ROLE_KEYS = ['waiter', 'kitchen']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const MIN_PASSWORD = 8

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return 'weak_password'
  if (password.length > 72) return 'weak_password'
  return null
}

// Döner: { ok: true, value } veya { ok: false, code }
export function validateRequest(body) {
  const action = body?.action
  if (action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase()
    const displayName = String(body.displayName ?? '').replace(/\s+/g, ' ').trim()
    const role = body.role
    if (!EMAIL.test(email) || email.length > 254) return { ok: false, code: 'invalid_email' }
    if (!displayName || displayName.length > 60) return { ok: false, code: 'invalid_name' }
    if (!STAFF_ROLE_KEYS.includes(role)) return { ok: false, code: 'invalid_role' }
    const weak = validatePassword(body.password)
    if (weak) return { ok: false, code: weak }
    return { ok: true, value: { action, email, displayName, role, password: body.password } }
  }
  if (action === 'set_password') {
    if (!UUID.test(String(body.userId ?? ''))) return { ok: false, code: 'invalid_user' }
    const weak = validatePassword(body.password)
    if (weak) return { ok: false, code: weak }
    return { ok: true, value: { action, userId: body.userId, password: body.password } }
  }
  return { ok: false, code: 'invalid_action' }
}
