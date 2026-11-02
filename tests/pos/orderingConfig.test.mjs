// İstemci: sipariş alımı ile kanal ayarının ayrı okunması (saf mantık).
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOrderingConfig } from '../../src/pos/customer/orderingConfig.js'
import { classifyTable } from '../../src/pos/customer/qrOrders.js'
import { orderingBlockedMessage } from '../../src/pos/messages.js'

test('alım kapalı: kanallar yönetici ayarından görünür, gönderim "blocked" ile kapalı', () => {
  const closed = { pickup: false, delivery: false, dine_in: false, auto_open: true, blocked: 'ordering_closed', accepting: false, channels: { pickup: true, delivery: true, dine_in: true } }
  assert.deepEqual(normalizeOrderingConfig(closed), { pickup: true, delivery: true, dine_in: true, auto_open: true, blocked: 'ordering_closed' })
})

test('yöneticinin kapattığı kanal açılmaz; hiç çevrimiçi kanal yoksa arayüz yüklenmez', () => {
  const value = normalizeOrderingConfig({ blocked: 'ordering_closed', accepting: false, channels: { pickup: false, delivery: true, dine_in: false } })
  assert.deepEqual([value.pickup, value.delivery, value.dine_in], [false, true, false])
  assert.equal(normalizeOrderingConfig({ blocked: null, accepting: true, channels: { pickup: false, delivery: false, dine_in: true } }), null)
  assert.equal(normalizeOrderingConfig({ channels: { pickup: 'evet', delivery: 1 } }), null, 'yalnızca true açıktır')
})

test('alım açık ve eski sunucu yanıtı ("channels" yok) eskisi gibi okunur', () => {
  assert.deepEqual(normalizeOrderingConfig({ pickup: true, delivery: false, dine_in: true, auto_open: false, blocked: null, accepting: true, channels: { pickup: true, delivery: false, dine_in: true } }),
    { pickup: true, delivery: false, dine_in: true, auto_open: false, blocked: null })
  assert.deepEqual(normalizeOrderingConfig({ pickup: true, delivery: true, dine_in: true, auto_open: true, blocked: null }), { pickup: true, delivery: true, dine_in: true, auto_open: true, blocked: null })
  assert.equal(normalizeOrderingConfig({ pickup: false, delivery: false, blocked: 'ordering_closed' }), null, 'eski sunucu kapalıyken kanal bildirmez')
  for (const bad of [null, undefined, 'x', 3]) assert.equal(normalizeOrderingConfig(bad), null)
})

test('QR masa: alım kapalıyken masa hazır ama gönderim kapalı; uyarı metni açık', () => {
  assert.deepEqual(classifyTable({ data: { table_label: 'Masa 2', blocked: 'ordering_closed' }, error: null }), { state: 'ready', label: 'Masa 2', blocked: 'ordering_closed' })
  assert.deepEqual(classifyTable({ data: { table_label: 'Masa 2' }, error: null }), { state: 'ready', label: 'Masa 2' })
  assert.match(orderingBlockedMessage('ordering_closed'), /^Sipariş sistemi geçici olarak kapalı/)
  assert.match(orderingBlockedMessage('outside_hours'), /çalışma saatlerimiz dışında/)
  assert.match(orderingBlockedMessage('bilinmeyen'), /geçici olarak kapalı/)
  assert.equal(orderingBlockedMessage(null), null)
})
