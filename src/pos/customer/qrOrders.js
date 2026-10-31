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
  if (!error) return { state: 'ready', label: data?.table_label }
  if (/^pos:invalid_table/.test(error.message ?? '')) return { state: 'invalid' }
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
