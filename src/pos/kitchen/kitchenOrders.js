// Mutfak ekranının saf mantığı (arayüzden bağımsız, testlerle doğrulanır).
export const KITCHEN_COLUMNS = ['new', 'preparing', 'ready', 'served']
export const SERVED_WINDOW_MS = 2 * 60 * 60 * 1000
export const LATE_MINUTES = 15

// En eski bekleyen en üstte; servis edilenlerde en son biten en üstte.
export function groupByStatus(orders) {
  const groups = Object.fromEntries(KITCHEN_COLUMNS.map(status => [status, []]))
  for (const order of orders) groups[order.status]?.push(order)
  groups.served.reverse()
  return groups
}

// İlk yüklemede uyarı verilmez; yalnızca sonradan gelen "yeni" siparişler döner.
export function findNewArrivals(knownIds, orders) {
  if (!knownIds) return []
  return orders.filter(order => order.status === 'new' && !knownIds.has(order.id))
}

export const isLate = (order, now = Date.now()) => order.status !== 'served' && now - order.createdAt >= LATE_MINUTES * 60000

export function mapKitchenOrder(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    source: row.source,
    status: row.status,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    note: row.note,
    tableId: row.table_id,
    tableLabel: row.restaurant_tables?.label ?? '—',
    items: [...(row.order_items ?? [])]
      .sort((a, b) => a.position - b.position)
      .map(item => ({ name: item.item_name, quantity: item.quantity, note: item.note })),
  }
}
