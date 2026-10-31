// DEMO veri kaynağı: POS şeması canlı veritabanında yokken arayüzü göstermek içindir.
// Hiçbir şey sunucuya yazılmaz; veriler demoStore'da, yalnızca bu tarayıcıda yaşar.
// Davranış gerçek RPC ile aynı kuralları izler (sunucu fiyatı, idempotency, iptal hariç toplam).
import { createDemoStore } from './demoStore.js'
import { NEXT_STATUS } from '../orderStatus.js'
import { SERVED_WINDOW_MS } from '../kitchen/kitchenOrders.js'
import { demoTableIdOf } from '../customer/qrOrders.js'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const TABLES = Array.from({ length: 12 }, (_, i) => ({ id: `demo-masa-${i + 1}`, label: `Masa ${i + 1}` }))
// Migration'daki QR hız sınırıyla aynı: masa başına 5 dakikada 12 sipariş.
const QR_RATE_LIMIT = 12
const QR_RATE_WINDOW_MS = 5 * 60000

export function createDemoBackend({ catalogItems = [], latencyMs = 450, now = () => Date.now(), store = createDemoStore() } = {}) {
  const byId = new Map(catalogItems.map(item => [item.id, item]))

  function createOrder(state, tableId, source, lines, note, key, createdAt = now()) {
    const items = lines.map(line => {
      const item = byId.get(line.menuItemId)
      return { name: item.name, quantity: line.quantity, lineTotalCents: item.priceCents * line.quantity, note: line.note || null }
    })
    const order = {
      id: `demo-siparis-${++state.orderNumber}`, orderNumber: state.orderNumber, idempotencyKey: key, key, source, status: 'new', createdAt, updatedAt: createdAt,
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

  // Garson ve müşteri aynı sipariş yolundan geçer. Fiyat yalnızca katalogdan gelir.
  async function place(source, tableId, key, payload) {
    await wait(latencyMs)
    try {
      // Anahtar kontrolü yazmayla aynı adımdadır: iki sekme aynı siparişi iki kez oluşturamaz.
      return await transact(state => {
        const previous = allOrders(state).find(({ order }) => order.idempotencyKey === key)
        if (previous) {
          if (previous.tableId !== tableId) return { state: 'rejected', code: 'idempotency_key_conflict' }
          return { state: 'confirmed', order: { ...previous.order, duplicate: true } }
        }
        if (!TABLES.some(table => table.id === tableId)) return { state: 'rejected', code: source === 'qr' ? 'invalid_table' : 'table_not_found' }
        if (!payload.lines.length) return { state: 'rejected', code: 'empty_order' }
        if (payload.lines.length > 30) return { state: 'rejected', code: 'too_many_lines' }
        if (payload.note?.length > 300 || payload.lines.some(line => line.note?.length > 200)) return { state: 'rejected', code: 'note_too_long' }
        for (const line of payload.lines) {
          if (!byId.get(line.menuItemId)?.available) return { state: 'rejected', code: 'item_unavailable' }
          if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) return { state: 'rejected', code: 'invalid_quantity' }
        }
        if (source === 'qr') {
          const recent = state.bills[tableId]?.orders.filter(order => order.source === 'qr' && now() - order.createdAt < QR_RATE_WINDOW_MS).length ?? 0
          if (recent >= QR_RATE_LIMIT) return { state: 'rejected', code: 'rate_limited' }
        }
        return { state: 'confirmed', order: createOrder(state, tableId, source, payload.lines, payload.note, key) }
      })
    } catch (error) {
      return { state: 'uncertain', error } // Depolama yazılamadı.
    }
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

    async listReadyNotifications() {
      await wait(latencyMs / 3)
      return allOrders(await load())
        .filter(({ order }) => order.readyAt)
        .sort((a, b) => b.order.readyAt - a.order.readyAt)
        .map(({ tableId, order }) => ({
          id: `ready-${order.id}`, orderId: order.id, orderNumber: order.orderNumber, status: order.status, source: order.source,
          tableId, tableLabel: TABLES.find(table => table.id === tableId)?.label ?? tableId, at: order.readyAt,
          items: order.items.map(item => ({ name: item.name, quantity: item.quantity })),
        }))
    },

    submit: ({ key, payload }) => place('waiter', payload.tableId, key, payload),

    async reconcile(submission) {
      return this.submit(submission)
    },

    // Müşteri tarafı: gerçekteki get_qr_table / place_qr_order / get_qr_orders karşılığı.
    qr(token) {
      const tableId = demoTableIdOf(token)
      const submit = ({ key, payload }) => place('qr', tableId, key, payload)
      return {
        mode: 'demo',
        async getTable() {
          const table = TABLES.find(t => t.id === tableId)
          return table ? { state: 'ready', label: table.label } : { state: 'invalid' }
        },
        submit,
        reconcile: submit,
        async listOrders(keys) {
          await wait(latencyMs / 3)
          const wanted = new Set(keys)
          return allOrders(await load())
            .filter(({ tableId: id, order }) => id === tableId && wanted.has(order.idempotencyKey))
            .map(({ order }) => ({ ...order, key: order.idempotencyKey }))
            .sort((a, b) => a.createdAt - b.createdAt)
        },
        subscribe: (onChange, onConnection) => {
          onConnection('connected')
          return store.subscribe(onChange)
        },
      }
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
          if (status === 'ready') order.readyAt = now()
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
