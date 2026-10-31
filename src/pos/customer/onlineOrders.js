// Paket ve kurye siparişinin saf mantığı. Sunucu her kuralı yeniden denetler; buradaki denetim
// yalnızca müşteriye hatayı erken göstermek içindir. Ücret ve toplam sunucudan gelir.
const STORAGE_KEY = 'waypoint-online-order-v1'
export const PENDING_MAX_AGE_MS = 10 * 60 * 1000
const MAX_TRACKED = 10

export const CHANNELS = { dine_in: 'Masada Sipariş', pickup: 'Paket / Gel Al', delivery: 'Kurye ile Teslimat' }
export const PAYMENT_LABELS = { pay_at_pickup: 'Teslim alırken ödeme', cash_on_delivery: 'Kapıda ödeme' }
export const emptyForm = Object.freeze({ name: '', phone: '', street: '', district: '', postalCode: '', building: '', floor: '', door: '', apartment: '', instructions: '' })

export const isTrackingToken = token => /^[0-9a-f]{64}$/.test(token ?? '')

export function validateCheckout(channel, form) {
  const errors = {}
  if (form.name.trim().length < 2) errors.name = 'Adınızı ve soyadınızı girin.'
  const digits = form.phone.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) errors.phone = 'Geçerli bir telefon numarası girin.'
  if (channel === 'delivery') {
    if (form.street.trim().length < 5) errors.street = 'Sokak ve numara bilgisini girin.'
    if (form.district.trim().length < 2) errors.district = 'İlçe veya semti girin.'
    if (!/^\d{5}$/.test(form.postalCode.trim())) errors.postalCode = 'Posta kodu 5 haneli olmalı.'
  }
  return errors
}

const blank = value => value.trim() || null

export const toOnlinePayload = (channel, form) => ({
  fulfillmentType: channel,
  customer: { name: form.name.trim(), phone: form.phone.trim() },
  address: channel !== 'delivery' ? null : {
    street: form.street.trim(), district: form.district.trim(), postal_code: form.postalCode.trim(),
    building: blank(form.building), floor: blank(form.floor), door: blank(form.door), apartment: blank(form.apartment), instructions: blank(form.instructions),
  },
})

// Kurye ücreti bilinmeden toplam gösterilmez ve sipariş gönderilmez.
export function checkoutSummary(channel, subtotalCents, quote) {
  if (channel !== 'delivery') return { ready: true, feeCents: 0, totalCents: subtotalCents, problem: null }
  if (quote?.state === 'out') return { ready: false, feeCents: null, totalCents: null, problem: 'out_of_area' }
  if (quote?.state !== 'ok') return { ready: false, feeCents: null, totalCents: null, problem: quote?.state === 'error' ? 'quote_error' : 'needs_address' }
  const totalCents = subtotalCents + quote.feeCents
  if (subtotalCents < quote.minOrderCents) return { ready: false, feeCents: quote.feeCents, totalCents, problem: 'below_minimum', minOrderCents: quote.minOrderCents }
  return { ready: true, feeCents: quote.feeCents, totalCents, problem: null }
}

export function mapOnlineOrder(row) {
  return {
    id: row.order_id,
    orderNumber: row.order_number,
    fulfillmentType: row.fulfillment_type,
    trackingToken: row.tracking_token,
    subtotalCents: Number(row.subtotal_cents),
    deliveryFeeCents: Number(row.delivery_fee_cents),
    totalCents: Number(row.total_cents),
    paymentMethod: row.payment_method,
    createdAt: Date.parse(row.created_at),
  }
}

export function mapTracking(row) {
  return {
    orderNumber: row.order_number,
    fulfillmentType: row.fulfillment_type,
    kitchenStatus: row.kitchen_status,
    fulfillmentStatus: row.fulfillment_status,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    subtotalCents: Number(row.subtotal_cents),
    deliveryFeeCents: Number(row.delivery_fee_cents),
    totalCents: Number(row.total_cents),
    createdAt: Date.parse(row.created_at),
    items: (row.items ?? []).map(item => ({ name: item.name, quantity: item.quantity, lineTotalCents: Number(item.line_total_cents), note: item.note })),
  }
}

// Müşteri adımları: mutfak durumu ve teslimat durumu tek çizgide gösterilir, kaynakları ayrıdır.
export function trackingSteps({ fulfillmentType, kitchenStatus, fulfillmentStatus }) {
  const finalSteps = fulfillmentType === 'pickup'
    ? [['awaiting_handoff', 'Teslim almaya hazır'], ['collected', 'Teslim alındı']]
    : [['awaiting_handoff', 'Kurye bekleniyor'], ['handed_to_courier', 'Kuryeye verildi'], ['delivered', 'Teslim edildi']]
  const steps = [['new', 'Alındı'], ['preparing', 'Hazırlanıyor'], ...finalSteps]
  const position = fulfillmentStatus === 'pending' ? (kitchenStatus === 'preparing' ? 1 : 0) : steps.findIndex(([key]) => key === fulfillmentStatus)
  return steps.map(([key, label], index) => ({ key, label, state: index < position ? 'done' : index === position ? 'current' : 'todo' }))
}

const emptyState = () => ({ channel: null, cart: null, orders: [], pending: null })

// Bekleyen gönderim kişisel veri içerir: yalnızca kısa süre tutulur, sonra silinir.
export function loadOnlineState(now = Date.now(), storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY))
    if (!saved) return emptyState()
    return {
      channel: ['pickup', 'delivery', 'dine_in'].includes(saved.channel) ? saved.channel : null,
      cart: saved.cart ?? null,
      orders: Array.isArray(saved.orders) ? saved.orders.filter(order => isTrackingToken(order.token)).slice(-MAX_TRACKED) : [],
      pending: saved.pending && now - saved.pending.createdAt < PENDING_MAX_AGE_MS ? saved.pending : null,
    }
  } catch {
    return emptyState()
  }
}

export function saveOnlineState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...state, orders: state.orders.slice(-MAX_TRACKED) }))
  } catch { /* Depolama kapalı olabilir; sipariş akışı bellekte sürer. */ }
}
