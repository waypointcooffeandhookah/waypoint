import test from 'node:test'
import assert from 'node:assert/strict'
import { readBillSnapshot } from '../../src/pos/backend/billSnapshot.js'

const summary = (order_count, subtotal_cents) => ({ order_count, subtotal_cents, bill_id: 'b' })
const order = (subtotal_cents, status = 'new') => ({ subtotal_cents, status })
const sequence = values => { let i = 0; return async () => values[Math.min(i++, values.length - 1)] }

test('adisyon: özet ve siparişler uyuşuyorsa tek okuma yeterli', async () => {
  const result = await readBillSnapshot(sequence([summary(2, 300)]), sequence([[order(100), order(200)]]))
  assert.equal(result.summary.order_count, 2)
  assert.equal(result.orders.length, 2)
})

test('adisyon: okumalar arasına giren sipariş eski toplamla gösterilmez', async () => {
  const result = await readBillSnapshot(
    sequence([summary(1, 100), summary(2, 300)]),
    sequence([[order(100), order(200)], [order(100), order(200)]]))
  assert.equal(result.summary.subtotal_cents, 300)
})

test('adisyon: iptal edilen sipariş toplama girmez', async () => {
  let reads = 0
  const result = await readBillSnapshot(async () => { reads++; return summary(1, 100) }, sequence([[order(100), order(500, 'cancelled')]]))
  assert.equal(reads, 1)
  assert.equal(result.orders.length, 2)
})

test('adisyon: yoksa null, sürekli uyuşmazsa sonsuza dek okumaz', async () => {
  assert.equal(await readBillSnapshot(async () => null, async () => assert.fail('okunmamalı')), null)
  let reads = 0
  const result = await readBillSnapshot(async () => { reads++; return summary(1, 100) }, async () => [order(1), order(2)])
  assert.equal(reads, 3)
  assert.ok(result)
})
