import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyVisit, clearVisit, isVisitToken, loadVisit, saveVisit, visitStateKey } from '../../src/pos/customer/qrOrders.js'

const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) } }
const visit = `qv_${'a'.repeat(64)}`
const data = { visit, table_key: 't1', table_label: 'Masa 9', expires_at: '2026-11-05T12:00:00Z' }

test('bilet: kaydedilir, okunur, süresi istemci saatine göre işaretlenir, silinir', () => {
  const store = memory()
  const saved = saveVisit(data, store)
  assert.deepEqual(saved, { visit, tableKey: 't1', label: 'Masa 9', expiresAt: Date.parse(data.expires_at) })
  assert.equal(loadVisit(Date.parse('2026-11-05T11:59:00Z'), store).expired, false)
  assert.equal(loadVisit(Date.parse('2026-11-05T12:00:00Z'), store).expired, true)
  clearVisit(store)
  assert.equal(loadVisit(Date.now(), store), null)
  assert.equal(visitStateKey('t1'), 'table:t1', 'sepet masaya bağlı: tekrar okutunca korunur')
})

test('bilet: çıplak masa kodu veya bozuk kayıt bilet sayılmaz; depolama hatası akışı bozmaz', () => {
  assert.equal(isVisitToken('a'.repeat(64)), false)
  assert.equal(isVisitToken(visit), true)
  assert.equal(saveVisit({ ...data, visit: 'a'.repeat(64) }, memory()), null)
  const broken = memory(); broken.setItem('waypoint-qr-visit-v1', '{bozuk')
  assert.equal(loadVisit(Date.now(), broken), null)
  const throwing = { getItem() { throw new Error('kapalı') }, setItem() { throw new Error('kapalı') }, removeItem() { throw new Error('kapalı') } }
  assert.ok(saveVisit(data, throwing), 'kaydedilemese de bilet bu açılışta kullanılır')
  assert.equal(loadVisit(Date.now(), throwing), null)
  clearVisit(throwing)
})

test('bilet yanıtı: süresi dolmuş/geçersiz bilet "tekrar okut", diğer hatalar eski davranış', () => {
  assert.deepEqual(classifyVisit({ data: { table_label: 'Masa 9', expires_at: data.expires_at }, error: null }), { state: 'ready', label: 'Masa 9', blocked: null, expiresAt: Date.parse(data.expires_at) })
  for (const code of ['qr_visit_expired', 'qr_visit_invalid', 'qr_visit_required']) assert.deepEqual(classifyVisit({ error: { message: `pos:${code}` } }), { state: 'expired' })
  assert.deepEqual(classifyVisit({ error: { message: 'pos:invalid_table' } }), { state: 'invalid' })
  assert.deepEqual(classifyVisit({ error: { message: 'pos:channel_closed' } }), { state: 'unavailable' })
  assert.deepEqual(classifyVisit({ error: { message: 'Failed to fetch' } }), { state: 'unreachable' })
})
