// Adisyon özeti ve siparişler ayrı sorgularla okunur; arada yeni sipariş gelirse ikisi uyuşmaz.
// Para gösterimi tutarlı olmalı: uyuşana kadar yeniden okunur. Uyuşmazsa son okuma döner,
// sonraki yenileme (Realtime sinyali veya düzenli okuma) düzeltir.
const ATTEMPTS = 3

export async function readBillSnapshot(readSummary, readOrders) {
  for (let attempt = 1; ; attempt++) {
    const summary = await readSummary()
    if (!summary) return null
    const orders = await readOrders(summary)
    const active = orders.filter(order => order.status !== 'cancelled')
    const sum = active.reduce((total, order) => total + Number(order.subtotal_cents), 0)
    if ((active.length === summary.order_count && sum === Number(summary.subtotal_cents)) || attempt === ATTEMPTS) {
      return { summary, orders }
    }
  }
}
