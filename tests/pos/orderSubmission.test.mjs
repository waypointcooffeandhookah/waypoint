import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSubmission, submitOrder, reconcileOrder, isDefinitiveRejection, loadPending, savePending, clearPending } from '../../src/pos/orderSubmission.js'
import { priceToCents, estimateTotalCents } from '../../src/pos/money.js'

function memory() {
  const data = new Map()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}
// Sunucuyu taklit eder: aynı anahtar her zaman aynı siparişi döndürür.
function fakeServer() {
  const orders = new Map()
  return {
    orders,
    persist: ({ key }) => {
      if (!orders.has(key)) orders.set(key, { order_id: `o-${orders.size + 1}`, idempotency_key: key, status: 'new' })
      return orders.get(key)
    },
  }
}
const submission = () => createSubmission({ tableToken: 't', lines: [{ menuItemId: 'a', quantity: 1 }] })

test('onay yalnızca sunucu siparişi döndürdüğünde verilir', async () => {
  const server = fakeServer()
  const result = await submitOrder(submission(), { send: async s => ({ data: server.persist(s), error: null }) })
  assert.equal(result.state, 'confirmed')
  assert.equal(server.orders.size, 1)
})

test('zaman aşımı ve ağ hatası "belirsiz" durumdur, başarı veya hata gösterilmez', async () => {
  const hang = (_s, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
  assert.equal((await submitOrder(submission(), { send: hang, timeoutMs: 10 })).state, 'uncertain')
  assert.equal((await submitOrder(submission(), { send: async () => ({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }) })).state, 'uncertain')
  assert.equal((await submitOrder(submission(), { send: async () => ({ data: null, error: { message: 'Gateway', code: '504' } }) })).state, 'uncertain')
})

test('sunucunun bilinçli reddi kodu ile döner', async () => {
  const result = await submitOrder(submission(), { send: async () => ({ data: null, error: { code: 'P0001', message: 'pos:item_unavailable' } }) })
  assert.deepEqual([result.state, result.code], ['rejected', 'item_unavailable'])
  assert.equal(isDefinitiveRejection({ code: '42501' }), true)
  assert.equal(isDefinitiveRejection({ code: '08006' }), false)
})

test('kayıt sunucuya ulaştı ama yanıt kayboldu: mutabakat tekrar göndermeden onaylar', async () => {
  const server = fakeServer()
  const s = submission()
  const lost = await submitOrder(s, { send: async sub => { server.persist(sub); throw new Error('network lost') } })
  assert.equal(lost.state, 'uncertain')

  let resent = 0
  const result = await reconcileOrder(s, {
    lookup: async sub => ({ data: server.orders.get(sub.key) ?? null, error: null }),
    send: async sub => { resent++; return { data: server.persist(sub), error: null } },
  })
  assert.equal(result.state, 'confirmed')
  assert.equal(resent, 0)
  assert.equal(server.orders.size, 1)
})

test('kayıt sunucuya hiç ulaşmadı: mutabakat aynı anahtarla bir kez yeniden gönderir', async () => {
  const server = fakeServer()
  const s = submission()
  const result = await reconcileOrder(s, {
    lookup: async sub => ({ data: server.orders.get(sub.key) ?? null, error: null }),
    send: async sub => ({ data: server.persist(sub), error: null }),
  })
  assert.equal(result.state, 'confirmed')
  assert.equal(server.orders.size, 1)
})

test('sorgu da başarısızsa yeniden gönderilmez, durum belirsiz kalır', async () => {
  let sent = 0
  const result = await reconcileOrder(submission(), {
    lookup: async () => ({ data: null, error: { message: 'offline', code: '' } }),
    send: async () => { sent++; return { data: null, error: null } },
  })
  assert.equal(result.state, 'uncertain')
  assert.equal(sent, 0)
})

test('bekleyen gönderimler menü önbelleğinden ayrı saklanır ve temizlenir', () => {
  const storage = memory()
  const a = submission(), b = submission()
  savePending(a, storage); savePending(b, storage); savePending(a, storage)
  assert.deepEqual(loadPending(storage).map(s => s.key), [b.key, a.key])
  clearPending(a.key, storage)
  assert.deepEqual(loadPending(storage).map(s => s.key), [b.key])
  storage.setItem('waypoint-pos-pending-v1', 'bozuk')
  assert.deepEqual(loadPending(storage), [])
  const blocked = { getItem() { throw Error('blocked') }, setItem() { throw Error('full') } }
  assert.deepEqual(loadPending(blocked), [])
  assert.doesNotThrow(() => savePending(a, blocked))
})

test('para kuruş tamsayı olarak hesaplanır', () => {
  assert.equal(priceToCents('0.1'), 10)
  assert.equal(priceToCents('19,99'), 1999)
  assert.equal(priceToCents(-1), null)
  assert.equal(estimateTotalCents([{ price: 0.1, quantity: 3 }, { price: '0.2', quantity: 1 }]), 50)
})
