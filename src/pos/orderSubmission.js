// Güvenilir sipariş gönderimi: her gönderimin sabit bir idempotency anahtarı vardır.
// Sunucu onaylamadan "başarılı" denmez; yanıt alınamazsa durum "belirsiz" olur ve
// tekrar denemeden önce aynı anahtarla sunucudaki durum sorgulanır.
export const SUBMIT_TIMEOUT_MS = 15000
const PENDING_KEY = 'waypoint-pos-pending-v1'

export function createSubmission(payload, newKey = () => crypto.randomUUID()) {
  return { key: newKey(), payload, createdAt: Date.now() }
}

// Sunucunun bilinçli reddi (doğrulama, yetki, kısıt) — tekrar denemek sonucu değiştirmez.
// Ağ hatası, zaman aşımı ve 5xx ise siparişin kaydedilip kaydedilmediği bilinmez.
export function isDefinitiveRejection(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  return code === 'P0001' || /^(22|23|28|42)/.test(code)
}

export function rejectionCode(error) {
  return /^pos:([a-z_]+)/.exec(error?.message ?? '')?.[1] ?? 'unknown'
}

async function withTimeout(run, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

// send(submission, signal) → { data, error } (supabase-js biçimi)
export async function submitOrder(submission, { send, timeoutMs = SUBMIT_TIMEOUT_MS }) {
  try {
    const { data, error } = await withTimeout(signal => send(submission, signal), timeoutMs)
    if (!error && data?.order_id) return { state: 'confirmed', order: data }
    if (error && isDefinitiveRejection(error)) return { state: 'rejected', code: rejectionCode(error), error }
    return { state: 'uncertain', error }
  } catch (error) {
    return { state: 'uncertain', error }
  }
}

// lookup(submission, signal) → { data: order | null, error }
export async function reconcileOrder(submission, { send, lookup, timeoutMs = SUBMIT_TIMEOUT_MS }) {
  try {
    const { data, error } = await withTimeout(signal => lookup(submission, signal), timeoutMs)
    if (error) return { state: 'uncertain', error }
    if (data?.order_id) return { state: 'confirmed', order: data }
  } catch (error) {
    return { state: 'uncertain', error }
  }
  // Sunucuda kayıt yok: aynı anahtarla yeniden göndermek güvenlidir.
  return submitOrder(submission, { send, timeoutMs })
}

// Belirsiz gönderimler cihazda saklanır (menü önbelleğinden ayrı, finans verisi içermez)
// ve bağlantı geri geldiğinde reconcileOrder ile doğrulanır; körü körüne tekrar gönderilmez.
export function loadPending(storage) {
  try {
    storage ??= globalThis.localStorage
    const value = JSON.parse(storage.getItem(PENDING_KEY))
    return Array.isArray(value) ? value.filter(s => typeof s?.key === 'string' && s.payload) : []
  } catch { return [] }
}

export function savePending(submission, storage) {
  try {
    storage ??= globalThis.localStorage
    const rest = loadPending(storage).filter(s => s.key !== submission.key)
    storage.setItem(PENDING_KEY, JSON.stringify([...rest, submission].slice(-20)))
  } catch { /* Depolama kapalı olabilir; kullanıcı durumu ekranda görmeye devam eder. */ }
}

export function clearPending(key, storage) {
  try {
    storage ??= globalThis.localStorage
    storage.setItem(PENDING_KEY, JSON.stringify(loadPending(storage).filter(s => s.key !== key)))
  } catch { /* Depolama kapalı olabilir. */ }
}
