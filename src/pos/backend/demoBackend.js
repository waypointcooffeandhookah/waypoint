// DEMO veri kaynağı: POS şeması canlı veritabanında yokken arayüzü göstermek içindir.
// Hiçbir şey sunucuya yazılmaz; veriler demoStore'da, yalnızca bu tarayıcıda yaşar.
// Davranış gerçek RPC ile aynı kuralları izler (sunucu fiyatı, idempotency, iptal hariç toplam).
import { createDemoStore } from './demoStore.js'
import { NEXT_STATUS } from '../orderStatus.js'
import { SERVED_WINDOW_MS } from '../kitchen/kitchenOrders.js'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const TABLES = Array.from({ length: 12 }, (_, i) => ({ id: `demo-masa-${i + 1}`, label: `Masa ${i + 1}` }))

export function createDemoBackend({ catalogItems = [], latencyMs = 450, now = () => Date.now(), store = createDemoStore() } = {}) {
  const byId = new Map(catalogItems.map(item => [item.id, item]))

  function createOrder(state, tableId, source, lines, note, key, createdAt = now()) {
    const items = lines.map(line => {
      const item = byId.get(line.menuItemId)
      return { name: item.name, quantity: line.quantity, lineTotalCents: item.priceCents * line.quantity, note: line.note || null }
    })
    const order = {
      id: `demo-siparis-${++state.orderNumber}`, orderNumber: state.orderNumber, idempotencyKey: key, source, status: 'new', createdAt, updatedAt: createdAt,
      note: note || null, items, subtotalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0), demo: true,
    }
    state.bills[tableId] ??= { billId: `demo-adisyon-${tableId}`, openedAt: createdAt, orders: [], paidCents: 0 }
    state.bills[tableId].orders.push(order)
    return order
  }

  // Birkaç dolu masa ile başla (QR ve garson kaynaklı örnek siparişler).
  function initialState() {
    const state = { orderNumber: 1040, bills: {} }
    const sample = catalogItems.filter(item => item.available).slice(0, 6)
    if (sample.length >= 3) {
      const minutesAgo = m => now() - m * 60000
      createOrder(state, 'demo-masa-3', 'qr', [{ menuItemId: sample[0].id, quantity: 2 }], null, 'demo-seed-1', minutesAgo(18)).status = 'served'
      createOrder(state, 'demo-masa-3', 'waiter', [{ menuItemId: sample[1].id, quantity: 1, note: 'Az şekerli' }], null, 'demo-seed-2', minutesAgo(9)).status = 'preparing'
      createOrder(state, 'demo-masa-7', 'waiter', [{ menuItemId: sample[2].id, quantity: 3 }], 'Masaya peçete', 'demo-seed-3', minutesAgo(4))
      createOrder(state, 'demo-masa-9', 'qr', [{ menuItemId: sample[0].id, quantity: 1 }], null, 'demo-seed-4', minutesAgo(1))
    }
    return state
  }

  const transact = fn => store.update(current => {
    const state = current ?? initialState()
    return { state, result: fn(state) }
  })
  const load = async () => store.read() ?? transact(state => state)
  const allOrders = state => Object.entries(state.bills).flatMap(([tableId, bill]) => bill.orders.map(order => ({ tableId, order })))

  const summarize = bill => {
    const active = bill.orders.filter(order => order.status !== 'cancelled')
    const totalCents = active.reduce((sum, order) => sum + order.subtotalCents, 0)
    return { totalCents, orderCount: active.length, paidCents: bill.paidCents, balanceCents: totalCents - bill.paidCents }
  }

  return {
    mode: 'demo',

    async listTables() {
      await wait(latencyMs / 3)
      const state = await load()
      return TABLES.map(table => {
        const bill = state.bills[table.id]
        return {
          ...table, occupied: Boolean(bill), openedAt: bill?.openedAt ?? null,
          readyCount: bill?.orders.filter(order => order.status === 'ready').length ?? 0,
          ...(bill ? summarize(bill) : { totalCents: 0, orderCount: 0 }),
        }
      })
    },

    async getTableBill(tableId) {
      await wait(latencyMs / 3)
      const bill = (await load()).bills[tableId]
      if (!bill) return null
      return { billId: bill.billId, openedAt: bill.openedAt, ...summarize(bill), orders: bill.orders }
    },

    async listKitchenOrders() {
      await wait(latencyMs / 3)
      const since = now() - SERVED_WINDOW_MS
      return allOrders(await load())
        .filter(({ order }) => ['new', 'preparing', 'ready'].includes(order.status) || (order.status === 'served' && order.updatedAt >= since))
        .map(({ tableId, order }) => ({ ...order, tableId, tableLabel: TABLES.find(table => table.id === tableId)?.label ?? tableId }))
        .sort((a, b) => a.createdAt - b.createdAt)
    },

    async submit({ key, payload }) {
      await wait(latencyMs)
      try {
        // Anahtar kontrolü yazmayla aynı adımdadır: iki sekme aynı siparişi iki kez oluşturamaz.
        return await transact(state => {
          const previous = allOrders(state).find(({ order }) => order.idempotencyKey === key)
          if (previous) return { state: 'confirmed', order: { ...previous.order, duplicate: true } }
          if (!TABLES.some(table => table.id === payload.tableId)) return { state: 'rejected', code: 'table_not_found' }
          if (!payload.lines.length) return { state: 'rejected', code: 'empty_order' }
          for (const line of payload.lines) {
            if (!byId.get(line.menuItemId)?.available) return { state: 'rejected', code: 'item_unavailable' }
            if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) return { state: 'rejected', code: 'invalid_quantity' }
          }
          return { state: 'confirmed', order: createOrder(state, payload.tableId, 'waiter', payload.lines, payload.note, key) }
        })
      } catch (error) {
        return { state: 'uncertain', error } // Depolama yazılamadı.
      }
    },

    async reconcile(submission) {
      return this.submit(submission)
    },

    async setOrderStatus(orderId, status) {
      await wait(latencyMs / 3)
      try {
        return await transact(state => {
          const found = allOrders(state).find(({ order }) => order.id === orderId)
          if (!found) return { state: 'rejected', code: 'order_not_found' }
          const { order } = found
          if (order.status === status) return { state: 'confirmed', order: { ...order, duplicate: true } }
          if (NEXT_STATUS[order.status] !== status) return { state: 'rejected', code: 'invalid_transition' }
          order.status = status
          order.updatedAt = now()
          return { state: 'confirmed', order }
        })
      } catch {
        return { state: 'error' }
      }
    },

    subscribe(onChange, onConnection) {
      onConnection('connected')
      return store.subscribe(onChange)
    },

    resetDemo: () => store.update(() => ({ state: initialState() })),
  }
}
