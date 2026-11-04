import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllRows, periodRange, summarizeRevenue } from '../../src/admin/revenue.js'

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h)

test('dönem: bugün, dün, hafta (Pazartesi), ay; yarı açık aralık', () => {
  const now = at(2026, 11, 5, 15) // Perşembe
  const today = periodRange('today', now)
  assert.equal(today.from, at(2026, 11, 5, 0).toISOString())
  assert.equal(today.to, at(2026, 11, 6, 0).toISOString())
  assert.equal(periodRange('yesterday', now).from, at(2026, 11, 4, 0).toISOString())
  assert.equal(periodRange('yesterday', now).to, today.from)
  const week = periodRange('week', now)
  assert.equal(week.from, at(2026, 11, 2, 0).toISOString(), 'hafta Pazartesi başlar')
  assert.equal(week.days, 4)
  assert.equal(periodRange('week', at(2026, 11, 8)).from, at(2026, 11, 2, 0).toISOString(), 'Pazar aynı haftadadır')
  assert.equal(periodRange('month', now).from, at(2026, 11, 1, 0).toISOString())
})

test('dönem: özel aralıkta bitiş günü dahil; hatalı tarihler reddedilir', () => {
  const range = periodRange('custom', new Date(), { from: '2026-10-01', to: '2026-10-31' })
  assert.equal(range.from, at(2026, 10, 1, 0).toISOString())
  assert.equal(range.to, at(2026, 11, 1, 0).toISOString())
  assert.equal(range.days, 31)
  assert.ok(periodRange('custom', new Date(), { from: '2026-10-05', to: '2026-10-01' }).error)
  assert.ok(periodRange('custom', new Date(), { from: '2026-02-30', to: '2026-03-01' }).error)
  assert.ok(periodRange('custom', new Date(), { from: '', to: '2026-03-01' }).error)
  assert.ok(periodRange('custom', new Date(), { from: '2024-01-01', to: '2026-01-01' }).error)
  assert.ok(periodRange('bilinmeyen').error)
})

test('ciro: tahsilat, satış, kanal, iptal, teslimat ücreti ve en çok satanlar ayrı hesaplanır', () => {
  const orders = [
    { status: 'served', fulfillment_type: 'dine_in', subtotal_cents: 30000, created_at: at(2026, 11, 4).toISOString(),
      order_items: [{ item_name: 'Çay', quantity: 4, line_total_cents: 10000 }, { item_name: 'Nargile', quantity: 1, line_total_cents: 20000 }] },
    { status: 'ready', fulfillment_type: 'pickup', subtotal_cents: 5000, created_at: at(2026, 11, 5).toISOString(),
      order_items: [{ item_name: 'Çay', quantity: 2, line_total_cents: 5000 }], order_fulfillments: { delivery_fee_cents: 0 } },
    { status: 'served', fulfillment_type: 'delivery', subtotal_cents: 20000, created_at: at(2026, 11, 5).toISOString(),
      order_items: [{ item_name: 'Nargile', quantity: 1, line_total_cents: 20000 }], order_fulfillments: [{ delivery_fee_cents: 3000 }] },
    { status: 'cancelled', fulfillment_type: 'dine_in', subtotal_cents: 99900, created_at: at(2026, 11, 5).toISOString(),
      order_items: [{ item_name: 'Pahalı', quantity: 9, line_total_cents: 99900 }] },
  ]
  const payments = [{ amount_cents: 20000, method: 'cash' }, { amount_cents: 10000, method: 'card' }]
  const onlinePaid = [{ total_cents: 23000, paid_method: 'cash' }]
  const report = summarizeRevenue({ orders, payments, onlinePaid })
  assert.equal(report.collected, 53000)
  assert.equal(report.tableCollected, 30000)
  assert.equal(report.onlineCollected, 23000)
  assert.deepEqual(report.byMethod, { cash: 43000, card: 10000, other: 0 })
  assert.equal(report.sales, 55000, 'iptal satışa girmez')
  assert.equal(report.orderCount, 3)
  assert.equal(report.averageOrder, 18333)
  assert.equal(report.deliveryFees, 3000)
  assert.equal(report.cancelled, 1)
  assert.equal(report.cancelledAmount, 99900)
  assert.deepEqual(report.channels, { dine_in: { orders: 1, sales: 30000 }, pickup: { orders: 1, sales: 5000 }, delivery: { orders: 1, sales: 20000 } })
  assert.deepEqual(report.topProducts.map(p => [p.name, p.quantity, p.sales]), [['Nargile', 2, 40000], ['Çay', 6, 15000]])
  assert.ok(!report.topProducts.some(p => p.name === 'Pahalı'), 'iptal edilen ürün listede yok')
  assert.deepEqual(report.daily.map(d => [d.day, d.orders, d.sales]), [['2026-11-04', 1, 30000], ['2026-11-05', 2, 25000]])
})

test('ciro: boş dönem sıfır döner, bölme hatası yok', () => {
  const report = summarizeRevenue({})
  assert.equal(report.collected, 0)
  assert.equal(report.averageOrder, 0)
  assert.deepEqual(report.topProducts, [])
})

test('sayfalı okuma: 1000 satırlık sınırı aşan dönem eksiksiz okunur; hata yutulmaz', async () => {
  const all = Array.from({ length: 2345 }, (_, i) => i)
  const calls = []
  const make = () => ({ range: async (from, to) => { calls.push([from, to]); return { data: all.slice(from, to + 1), error: null } } })
  assert.deepEqual(await fetchAllRows(make), all)
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]])
  const failing = () => ({ range: async () => ({ data: null, error: new Error('rls') }) })
  await assert.rejects(fetchAllRows(failing), /rls/)
  const endless = () => ({ range: async (from, to) => ({ data: Array(to - from + 1).fill(0), error: null }) })
  await assert.rejects(fetchAllRows(endless, 10, 30), /too_many_rows/)
})
