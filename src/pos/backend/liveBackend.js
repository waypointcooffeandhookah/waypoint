// Canlı veri kaynağı: Milestone 1 migration'ı uygulanmış Supabase.
import { submitOrder, reconcileOrder } from '../orderSubmission.js'
import { staffOrderTransport, updateOrderStatus } from '../posApi.js'
import { statusResult } from '../orderStatus.js'
import { mapKitchenOrder, SERVED_WINDOW_MS } from '../kitchen/kitchenOrders.js'
import { randomUUID } from '../../utils/uuid.js'
import { readBillSnapshot } from './billSnapshot.js'
import { HISTORY_LIMIT, HISTORY_WINDOW_MS, READY_NOTIFICATION_SELECT, mapNotificationRow } from '../waiter/notifications.js'

const mapOrder = order => ({
  id: order.id,
  orderNumber: order.order_number,
  source: order.source,
  status: order.status,
  createdAt: Date.parse(order.created_at),
  note: order.note,
  subtotalCents: Number(order.subtotal_cents),
  items: [...(order.order_items ?? [])]
    .sort((a, b) => a.position - b.position)
    .map(item => ({ name: item.item_name, quantity: item.quantity, lineTotalCents: Number(item.line_total_cents), note: item.note })),
})

export function createLiveBackend(supabase) {
  return {
    mode: 'live',

    async listTables() {
      const [tables, bills, ready] = await Promise.all([
        supabase.from('restaurant_tables').select('id, label, sort_order').eq('is_active', true).order('sort_order').order('label'),
        supabase.from('bill_summaries').select('table_id, total_cents, order_count').eq('status', 'open'),
        supabase.from('orders').select('table_id').eq('status', 'ready'),
      ])
      if (tables.error) throw tables.error
      if (bills.error) throw bills.error
      if (ready.error) throw ready.error
      const open = new Map(bills.data.map(bill => [bill.table_id, bill]))
      return tables.data.map(table => {
        const bill = open.get(table.id)
        return {
          id: table.id, label: table.label, occupied: Boolean(bill), totalCents: Number(bill?.total_cents ?? 0), orderCount: bill?.order_count ?? 0,
          readyCount: ready.data.filter(order => order.table_id === table.id).length,
        }
      })
    },

    async getTableBill(tableId) {
      const snapshot = await readBillSnapshot(
        async () => {
          const { data, error } = await supabase.from('bill_summaries')
            .select('bill_id, subtotal_cents, total_cents, paid_cents, balance_cents, order_count')
            .eq('table_id', tableId).eq('status', 'open').maybeSingle()
          if (error) throw error
          return data
        },
        async bill => {
          const { data, error } = await supabase.from('orders')
            .select('id, order_number, source, status, created_at, note, subtotal_cents, order_items(position, item_name, quantity, line_total_cents, note)')
            .eq('bill_id', bill.bill_id).order('created_at')
          if (error) throw error
          return data
        })
      if (!snapshot) return null
      const { summary: bill, orders } = snapshot
      return {
        billId: bill.bill_id, totalCents: Number(bill.total_cents), paidCents: Number(bill.paid_cents),
        balanceCents: Number(bill.balance_cents), orderCount: bill.order_count, orders: orders.map(mapOrder),
      }
    },

    submit: submission => submitOrder(submission, staffOrderTransport),
    reconcile: submission => reconcileOrder(submission, staffOrderTransport),

    // Mutfak fiyat görmez; yalnızca hazırlık için gerekli alanlar okunur (RLS: tüm personel).
    async listKitchenOrders() {
      const since = new Date(Date.now() - SERVED_WINDOW_MS).toISOString()
      const { data, error } = await supabase.from('orders')
        .select('id, order_number, source, status, created_at, updated_at, note, table_id, restaurant_tables(label), order_items(position, item_name, quantity, note)')
        .or(`status.in.(new,preparing,ready),and(status.eq.served,updated_at.gte.${since})`)
        .order('created_at').limit(200)
      if (error) throw error
      return data.map(mapKitchenOrder)
    },

    // Hazır bildirimleri kalıcı durum geçmişinden okunur (RLS: yalnızca personel).
    async listReadyNotifications() {
      const since = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString()
      const { data, error } = await supabase.from('order_status_history')
        .select(READY_NOTIFICATION_SELECT)
        .eq('to_status', 'ready').gte('changed_at', since)
        .order('id', { ascending: false }).limit(HISTORY_LIMIT)
      if (error) throw error
      return data.map(mapNotificationRow)
    },

    async setOrderStatus(orderId, status) {
      try {
        return statusResult(await updateOrderStatus(orderId, status))
      } catch {
        return { state: 'error' }
      }
    },

    // Realtime yalnızca "yeniden oku" sinyalidir; kaynak her zaman veritabanı kayıtlarıdır.
    subscribe(onChange, onConnection) {
      const channel = supabase.channel(`pos-orders-${randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange)
        .subscribe(status => onConnection(status === 'SUBSCRIBED' ? 'connected' : 'disconnected'))
      return () => supabase.removeChannel(channel)
    },
  }
}
