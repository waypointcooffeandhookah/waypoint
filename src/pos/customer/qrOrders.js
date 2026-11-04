// QR müşteri siparişinin saf mantığı: masa kodu, sunucu yanıtı eşleme, cihazdaki kayıt.
const STORAGE_PREFIX = 'waypoint-qr-v1:'
export const MAX_AGE_MS = 12 * 60 * 60 * 1000
export const RECONCILE_MAX_AGE_MS = 10 * 60 * 1000
const MAX_SUBMISSIONS = 50

// Canlı kod migration'daki biçimdedir; biçimi tutmayan kod sunucuya hiç sorulmaz.
export const isLiveToken = token => /^[0-9a-f]{64}$/.test(token ?? '')
export const demoTableIdOf = token => /^demo-([1-9]\d?)$/.exec(token ?? '') && `demo-masa-${token.slice(5)}`

export function mapQrOrder(row) {
  return {
    id: row.order_id,
    orderNumber: row.order_number,
    key: row.idempotency_key,
    status: row.status,
    source: row.source,
    createdAt: Date.parse(row.created_at),
    subtotalCents: Number(row.subtotal_cents),
    duplicate: row.duplicate,
    items: (row.items ?? []).map(item => ({ name: item.name, quantity: item.quantity, lineTotalCents: Number(item.line_total_cents), note: item.note })),
  }
}

// get_qr_table yanıtı: geçersiz kod, kurulmamış şema ve ağ hatası ayrı ele alınır.
export function classifyTable({ data, error }) {
  // Alım kapalı / saat dışı: masa doğrulanır, menü ve sepet açılır, gönderim kapalı kalır (sunucu da reddeder).
  if (!error) return data?.blocked ? { state: 'ready', label: data?.table_label, blocked: data.blocked } : { state: 'ready', label: data?.table_label }
  if (/^pos:invalid_table/.test(error.message ?? '')) return { state: 'invalid' }
  if (/^pos:(ordering_closed|outside_hours|channel_closed)/.test(error.message ?? '')) return { state: 'unavailable' }
  if (['PGRST202', '42883', '3F000', 'PGRST205', '42P01'].includes(error.code)) return { state: 'unavailable' }
  return { state: 'unreachable' }
}

export function loadQrState(stateKey, now = Date.now(), storage = globalThis.localStorage) {
  const empty = { cart: null, submissions: [] }
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_PREFIX + stateKey))
    if (!saved) return empty
    return {
      cart: now - saved.savedAt < MAX_AGE_MS ? saved.cart : null,
      submissions: (saved.submissions ?? []).filter(sub => now - sub.createdAt < MAX_AGE_MS).slice(-MAX_SUBMISSIONS),
    }
  } catch { return empty }
}

export function saveQrState(stateKey, { cart, submissions }, now = Date.now(), storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_PREFIX + stateKey, JSON.stringify({ savedAt: now, cart, submissions }))
  } catch { /* Depolama kapalı olabilir; sipariş akışı bellekte sürer. */ }
}

// Eski bir gönderim sessizce yeniden yollanmaz (müşteri masadan kalkmış olabilir);
// yalnızca durum sorgusunda kalır, gerçekten kaydedildiyse listede görünür.
export const isFreshPending = (sub, now = Date.now()) => sub.pending && now - sub.createdAt < RECONCILE_MAX_AGE_MS

export const STATUS_STEPS = ['new', 'preparing', 'ready', 'served']
export const CUSTOMER_STATUS = { new: 'Alındı', preparing: 'Hazırlanıyor', ready: 'Hazır', served: 'Servis edildi', cancelled: 'İptal edildi' }

// ── Süreli masa bileti (20261105090000_pos_qr_visits.sql) ──
// QR okutulunca masa kodu bilete çevrilir ve adresten silinir. Bilet yalnızca bu sekmede (sessionStorage) tutulur:
// sayfa yenilemek süreyi uzatmaz; sekme kapanınca veya süre dolunca müşteri QR'ı tekrar okutur.
const VISIT_KEY = 'waypoint-qr-visit-v1'
export const VISIT_ERRORS = ['qr_visit_expired', 'qr_visit_invalid', 'qr_visit_required']
export const isVisitToken = token => /^qv_[0-9a-f]{64}$/.test(token ?? '')
export const visitStateKey = tableKey => `table:${tableKey}`

export function saveVisit(data, storage = globalThis.sessionStorage) {
  const visit = { visit: data.visit, tableKey: data.table_key, label: data.table_label, expiresAt: Date.parse(data.expires_at) }
  if (!isVisitToken(visit.visit) || !visit.tableKey || !Number.isFinite(visit.expiresAt)) return null
  try { storage.setItem(VISIT_KEY, JSON.stringify(visit)) } catch { /* Depolama kapalıysa bilet yalnızca bu açılışta geçerlidir. */ }
  return visit
}

export function loadVisit(now = Date.now(), storage = globalThis.sessionStorage) {
  try {
    const visit = JSON.parse(storage.getItem(VISIT_KEY))
    if (!visit || !isVisitToken(visit.visit) || !visit.tableKey) return null
    return { ...visit, expired: !(visit.expiresAt > now) }
  } catch { return null }
}

export function clearVisit(storage = globalThis.sessionStorage) {
  try { storage.removeItem(VISIT_KEY) } catch { /* yok sayılır */ }
}

export const errorCode = error => /^pos:([a-z_]+)/.exec(error?.message ?? '')?.[1] ?? null

// start_qr_visit / get_qr_visit yanıtı → ekran durumu.
export function classifyVisit({ data, error }) {
  if (!error) return { state: 'ready', label: data?.table_label, blocked: data?.blocked ?? null, expiresAt: Date.parse(data?.expires_at) }
  const code = errorCode(error)
  if (VISIT_ERRORS.includes(code)) return { state: 'expired' }
  return classifyTable({ data, error })
}
