// Adisyon ödemesi ve kapatmanın saf mantığı (testli). Asıl kural sahibi sunucudur:
// record_payment fazla ödemeyi, close_table_session açık sipariş ve kalan bakiyeyi reddeder.

export const METHOD_LABELS = { cash: 'Nakit', card: 'Kart' }

// "437,50", "437.5", "₺ 1.250,00" → kuruş. Geçersiz/sıfır tutar null.
export function parseLira(text) {
  let value = String(text ?? '').replace(/[₺\s]/g, '')
  if (!value) return null
  if (/,\d{1,2}$/.test(value)) value = value.replace(/\./g, '').replace(',', '.') // Türkçe: binlik nokta, ondalık virgül
  else if (/^\d{1,3}(\.\d{3})+$/.test(value)) value = value.replace(/\./g, '') // yalnızca binlik nokta
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null
  const cents = Math.round(Number(value) * 100)
  return cents > 0 ? cents : null
}

// Kuruşu giriş kutusu için yazar: 43750 → "437,50", 40000 → "400".
export const centsToInput = cents => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ','))

// Kişi başı: kalan n'e bölünür, kuruş yukarı yuvarlanır; son kişi kalanı öder (fazla ödeme olmaz).
export const splitShare = (balanceCents, people) => (people >= 1 ? Math.min(balanceCents, Math.ceil(balanceCents / people)) : balanceCents)

export function changeDue(givenCents, amountCents) {
  if (!givenCents || !amountCents) return null
  return givenCents >= amountCents ? givenCents - amountCents : null
}

export function paymentTotals(payments = []) {
  const totals = { cash: 0, card: 0 }
  for (const payment of payments) totals[payment.method] = (totals[payment.method] ?? 0) + payment.amountCents
  return totals
}

// Kapatma engeli: servis edilmemiş sipariş veya kalan bakiye (sunucuyla aynı kural).
export function closeBlocker(bill) {
  if (!bill) return 'no_bill'
  if (bill.orders.some(order => ['new', 'preparing', 'ready'].includes(order.status))) return 'orders_in_progress'
  if (bill.balanceCents > 0) return 'balance_due'
  return null
}

export function paymentProblem(amountCents, balanceCents) {
  if (!amountCents) return 'invalid_amount'
  if (amountCents > balanceCents) return 'overpayment'
  return null
}
