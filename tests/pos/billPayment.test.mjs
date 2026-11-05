import test from 'node:test'
import assert from 'node:assert/strict'
import { centsToInput, changeDue, closeBlocker, parseLira, paymentProblem, paymentTotals, splitShare } from '../../src/pos/waiter/billPayment.js'
import { createDemoBackend } from '../../src/pos/backend/demoBackend.js'
import { createDemoStore } from '../../src/pos/backend/demoStore.js'

test('tutar: Türkçe biçimler kuruşa çevrilir; geçersiz/sıfır reddedilir', () => {
  assert.equal(parseLira('437,50'), 43750)
  assert.equal(parseLira('437.5'), 43750)
  assert.equal(parseLira('₺ 1.250,00'), 125000)
  assert.equal(parseLira('1.250'), 125000)
  assert.equal(parseLira('250'), 25000)
  for (const bad of ['', '0', 'abc', '12,345', '-5', '1,2,3']) assert.equal(parseLira(bad), null, bad)
  assert.equal(centsToInput(43750), '437,50')
  assert.equal(centsToInput(40000), '400')
})

test('kişi başı bölme fazla ödeme üretmez; para üstü ve toplamlar doğru', () => {
  assert.equal(splitShare(100000, 3), 33334)
  assert.equal(splitShare(100, 3), 34)
  assert.ok(splitShare(100000, 3) * 2 < 100000, 'iki kişi ödeyince kalan pozitif')
  assert.equal(changeDue(50000, 43750), 6250)
  assert.equal(changeDue(40000, 43750), null, 'eksik verilen paraya para üstü yok')
  assert.deepEqual(paymentTotals([{ method: 'cash', amountCents: 100 }, { method: 'card', amountCents: 250 }, { method: 'cash', amountCents: 50 }]), { cash: 150, card: 250 })
  assert.equal(paymentProblem(null, 100), 'invalid_amount')
  assert.equal(paymentProblem(101, 100), 'overpayment')
  assert.equal(paymentProblem(100, 100), null)
})

test('kapatma engeli: servis edilmemiş sipariş veya kalan bakiye', () => {
  const orders = status => [{ status: 'served' }, { status }]
  assert.equal(closeBlocker({ orders: orders('ready'), balanceCents: 0 }), 'orders_in_progress')
  assert.equal(closeBlocker({ orders: orders('cancelled'), balanceCents: 100 }), 'balance_due')
  assert.equal(closeBlocker({ orders: orders('cancelled'), balanceCents: 0 }), null)
})

test('demo: parçalı ödeme (nakit + kart), tekrar anahtarı, fazla ödeme reddi, kapatma kuralları', async () => {
  const catalogItems = [{ id: 'k', name: 'Kahve', priceCents: 10000, available: true }]
  const backend = createDemoBackend({ catalogItems, latencyMs: 0, store: createDemoStore() })
  const order = await backend.submit({ key: 'o1', payload: { tableId: 'demo-masa-1', lines: [{ menuItemId: 'k', quantity: 3 }], note: null } })
  assert.equal(order.state, 'confirmed')
  let bill = await backend.getTableBill('demo-masa-1')
  assert.equal(bill.balanceCents, 30000)
  assert.equal((await backend.closeBill(bill.sessionId)).code, 'orders_in_progress')
  await backend.setOrderStatus(order.order.id, 'preparing'); await backend.setOrderStatus(order.order.id, 'ready'); await backend.setOrderStatus(order.order.id, 'served')
  assert.equal((await backend.closeBill(bill.sessionId)).code, 'balance_due')
  assert.equal((await backend.recordBillPayment(bill.billId, 40000, 'cash', 'p0')).code, 'overpayment')
  assert.equal((await backend.recordBillPayment(bill.billId, 10000, 'cash', 'p1')).state, 'confirmed')
  assert.equal((await backend.recordBillPayment(bill.billId, 10000, 'cash', 'p1')).state, 'confirmed', 'aynı anahtar tekrar')
  assert.equal((await backend.recordBillPayment(bill.billId, 20000, 'card', 'p2')).state, 'confirmed')
  bill = await backend.getTableBill('demo-masa-1')
  assert.equal(bill.balanceCents, 0)
  assert.deepEqual(paymentTotals(bill.payments), { cash: 10000, card: 20000 })
  assert.equal((await backend.closeBill(bill.sessionId)).state, 'confirmed')
  assert.equal(await backend.getTableBill('demo-masa-1'), null)
})
