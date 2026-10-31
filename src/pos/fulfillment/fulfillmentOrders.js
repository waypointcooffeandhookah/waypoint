// Paket ve kurye yönetim ekranının saf mantığı. Yetki ve geçişlerin sahibi sunucudur.
export const FULFILLMENT_ROLES = ['cashier', 'manager', 'admin']
export const FULFILLMENT_WINDOW_MS = 48 * 60 * 60 * 1000
export const FULFILLMENT_LIMIT = 200

export const FULFILLMENT_SELECT = 'order_id, status, customer_name, customer_phone, payment_method, payment_status, paid_method, delivery_fee_cents, total_cents, street, district, postal_code, building, floor, door, apartment, instructions, courier_name, created_at, orders!inner(order_number, status, fulfillment_type, note, subtotal_cents, order_items(position, item_name, quantity, note))'

export const FULFILLMENT_STATUS_LABELS = {
  pending: 'Mutfakta', awaiting_handoff: 'Teslim bekliyor', handed_to_courier: 'Kuryede',
  delivered: 'Teslim edildi', collected: 'Teslim alındı', cancelled: 'İptal',
}
export const COLUMNS = [['incoming', 'Gelen'], ['preparing', 'Hazırlanıyor'], ['awaiting', 'Hazır / Bekliyor'], ['out', 'Kuryede'], ['done', 'Tamamlanan']]

export function mapFulfillmentRow(row) {
  const order = row.orders
  return {
    id: row.order_id,
    orderNumber: order.order_number,
    type: order.fulfillment_type,
    kitchenStatus: order.status,
    status: row.status,
    note: order.note,
    createdAt: Date.parse(row.created_at),
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    paidMethod: row.paid_method,
    subtotalCents: Number(order.subtotal_cents),
    deliveryFeeCents: Number(row.delivery_fee_cents),
    totalCents: Number(row.total_cents),
    address: order.fulfillment_type !== 'delivery' ? null : {
      street: row.street, district: row.district, postalCode: row.postal_code, building: row.building,
      floor: row.floor, door: row.door, apartment: row.apartment, instructions: row.instructions,
    },
    courierName: row.courier_name,
    items: [...(order.order_items ?? [])].sort((a, b) => a.position - b.position).map(item => ({ name: item.item_name, quantity: item.quantity, note: item.note })),
  }
}

export function columnOf(order) {
  if (['delivered', 'collected', 'cancelled'].includes(order.status)) return 'done'
  if (order.status === 'handed_to_courier') return 'out'
  if (order.status === 'awaiting_handoff') return 'awaiting'
  return order.kitchenStatus === 'preparing' ? 'preparing' : 'incoming'
}

export function groupFulfillment(orders) {
  const groups = Object.fromEntries(COLUMNS.map(([key]) => [key, []]))
  for (const order of orders) groups[columnOf(order)].push(order)
  // Bekleyende en eski üstte, tamamlananda en yeni üstte (liste en yeniden gelir).
  for (const key of ['incoming', 'preparing', 'awaiting', 'out']) groups[key].reverse()
  return groups
}

// Sıradaki teslimat adımı: yalnızca mutfak hazır dedikten sonra açılır.
export function nextFulfillmentStep(order) {
  if (order.type === 'pickup') return order.status === 'awaiting_handoff' ? { status: 'collected', label: 'Müşteri teslim aldı' } : null
  if (order.status === 'awaiting_handoff') return { status: 'handed_to_courier', label: 'Kuryeye verildi', needsCourier: true }
  if (order.status === 'handed_to_courier') return { status: 'delivered', label: 'Teslim edildi' }
  return null
}

// Mutfak başladıysa iptal yalnızca yöneticide; sunucu da aynı kuralı uygular.
export function canCancel(order, role) {
  if (['delivered', 'collected', 'cancelled', 'handed_to_courier'].includes(order.status)) return false
  return order.kitchenStatus === 'new' || role === 'manager' || role === 'admin'
}

export const addressLines = address => [
  address.street,
  [address.building && `Bina ${address.building}`, address.floor && `Kat ${address.floor}`, address.door && `Kapı ${address.door}`].filter(Boolean).join(' · '),
  address.apartment,
  [address.district, address.postalCode].filter(Boolean).join(' '),
].filter(Boolean)
