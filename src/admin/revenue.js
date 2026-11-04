// Ciro raporunun saf mantığı (testli). Yalnızca okunan kayıtlardan hesaplar; hiçbir şey yazmaz.
// Tarihler yöneticinin cihaz saatine göre (işletme Türkiye'de; cihaz da öyle varsayılır).

export const PERIODS = [['today', 'Bugün'], ['yesterday', 'Dün'], ['week', 'Bu hafta'], ['month', 'Bu ay'], ['custom', 'Tarih seç']]
export const CHANNEL_LABELS = { dine_in: 'Masa', pickup: 'Paket / Gel Al', delivery: 'Kurye' }
export const METHOD_LABELS = { cash: 'Nakit', card: 'Kart' }

const dayStart = date => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
const pad = value => String(value).padStart(2, '0')
export const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

function parseDateKey(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? '')
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return dateKey(date) === text ? date : null
}

// Dönem → [from, to) yarı açık aralık (ISO). Özel aralıkta bitiş günü dahildir; en fazla 366 gün.
export function periodRange(period, now = new Date(), custom = {}) {
  const today = dayStart(now)
  let from
  let to
  if (period === 'today') [from, to] = [today, addDays(today, 1)]
  else if (period === 'yesterday') [from, to] = [addDays(today, -1), today]
  else if (period === 'week') {
    from = addDays(today, -((today.getDay() + 6) % 7)) // Pazartesi
    to = addDays(today, 1)
  } else if (period === 'month') [from, to] = [new Date(today.getFullYear(), today.getMonth(), 1), addDays(today, 1)]
  else if (period === 'custom') {
    const start = parseDateKey(custom.from)
    const end = parseDateKey(custom.to)
    if (!start || !end) return { error: 'Başlangıç ve bitiş tarihini seçin.' }
    if (end < start) return { error: 'Bitiş tarihi başlangıçtan önce olamaz.' }
    if ((end - start) / 86400000 > 366) return { error: 'En fazla bir yıllık aralık seçilebilir.' }
    ;[from, to] = [start, addDays(end, 1)]
  } else return { error: 'Geçersiz dönem.' }
  return { from: from.toISOString(), to: to.toISOString(), days: Math.round((to - from) / 86400000) }
}

const one = value => (Array.isArray(value) ? value[0] : value) ?? null
const cents = value => Number(value ?? 0)

// orders: dönemde verilen siparişler (+ order_items, order_fulfillments).
// payments: dönemde alınan masa ödemeleri. onlinePaid: dönemde tahsil edilen paket/kurye ödemeleri.
export function summarizeRevenue({ orders = [], payments = [], onlinePaid = [] }) {
  const byMethod = { cash: 0, card: 0, other: 0 }
  for (const payment of payments) byMethod[payment.method in METHOD_LABELS ? payment.method : 'other'] += cents(payment.amount_cents)
  for (const row of onlinePaid) byMethod[row.paid_method in METHOD_LABELS ? row.paid_method : 'other'] += cents(row.total_cents)
  const tableCollected = payments.reduce((sum, payment) => sum + cents(payment.amount_cents), 0)
  const onlineCollected = onlinePaid.reduce((sum, row) => sum + cents(row.total_cents), 0)

  const channels = Object.fromEntries(Object.keys(CHANNEL_LABELS).map(key => [key, { orders: 0, sales: 0 }]))
  const products = new Map()
  const daily = new Map()
  let sales = 0
  let orderCount = 0
  let deliveryFees = 0
  let cancelled = 0
  let cancelledAmount = 0
  for (const order of orders) {
    if (order.status === 'cancelled') {
      cancelled++
      cancelledAmount += cents(order.subtotal_cents)
      continue
    }
    const amount = cents(order.subtotal_cents)
    const channel = channels[order.fulfillment_type] ?? channels.dine_in
    channel.orders++
    channel.sales += amount
    sales += amount
    orderCount++
    deliveryFees += cents(one(order.order_fulfillments)?.delivery_fee_cents)
    const day = dateKey(new Date(order.created_at))
    const bucket = daily.get(day) ?? { day, orders: 0, sales: 0 }
    bucket.orders++
    bucket.sales += amount
    daily.set(day, bucket)
    for (const item of order.order_items ?? []) {
      const product = products.get(item.item_name) ?? { name: item.item_name, quantity: 0, sales: 0 }
      product.quantity += Number(item.quantity ?? 0)
      product.sales += cents(item.line_total_cents)
      products.set(item.item_name, product)
    }
  }

  return {
    collected: tableCollected + onlineCollected,
    tableCollected,
    onlineCollected,
    byMethod,
    sales,
    deliveryFees,
    orderCount,
    averageOrder: orderCount ? Math.round(sales / orderCount) : 0,
    cancelled,
    cancelledAmount,
    channels,
    topProducts: [...products.values()].sort((a, b) => b.sales - a.sales || b.quantity - a.quantity || a.name.localeCompare(b.name, 'tr')).slice(0, 10),
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
  }
}

// PostgREST bir istekte en fazla 1000 satır döndürür; dönem uzunsa sayfa sayfa okunur.
export async function fetchAllRows(makeQuery, pageSize = 1000, maxRows = 20000) {
  const rows = []
  for (let start = 0; start < maxRows; start += pageSize) {
    const { data, error } = await makeQuery().range(start, start + pageSize - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < pageSize) return rows
  }
  throw new Error('too_many_rows')
}
