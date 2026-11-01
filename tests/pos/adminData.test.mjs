import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { centsToLira, conflictingPostal, formToSettings, liraToCents, parseDistricts, parsePostalCodes, posErrorMessage, settingsToForm, startOfToday, summarizeOrders, tableQrUrl, validateSettingsForm } from '../../src/admin/adminData.js'
import { classifyTable } from '../../src/pos/customer/qrOrders.js'

const row = { dine_in_enabled: true, pickup_enabled: true, allow_pay_at_pickup: true, delivery_enabled: true, allow_cash_on_delivery: false, accepting_orders: true, auto_open_order_type: false, hours_enabled: true, operating_hours: { 1: { open: '09:00', close: '23:00' } } }

test('ayar formu: kayıt ile form arasında kayıpsız döner; kapalı gün gönderilmez', () => {
  const form = settingsToForm(row)
  assert.equal(form.delivery_enabled, false, 'ödeme kapalıysa kanal kapalı görünür')
  assert.equal(form.days[1].open, true)
  assert.equal(form.days[2].open, false)
  const sent = formToSettings(form)
  assert.deepEqual(sent.operating_hours, { 1: { open: '09:00', close: '23:00' } })
  assert.equal(sent.auto_open_order_type, false)
  assert.ok(!('days' in sent))
})

test('ayar doğrulama: aynı saat ve gün seçilmeden saat sınırı reddedilir', () => {
  const form = settingsToForm(row)
  assert.equal(validateSettingsForm(form), null)
  assert.match(validateSettingsForm({ ...form, days: { ...form.days, 1: { open: true, from: '10:00', to: '10:00' } } }), /Pazartesi/)
  assert.match(validateSettingsForm({ ...form, days: { ...form.days, 1: { open: false, from: '09:00', to: '23:00' } } }), /en az bir gün/)
})

test('özet: iptal ayrı sayılır, türler ve durumlar doğru toplanır', () => {
  const summary = summarizeOrders([
    { status: 'new', fulfillment_type: 'dine_in' }, { status: 'ready', fulfillment_type: 'pickup' },
    { status: 'served', fulfillment_type: 'delivery' }, { status: 'cancelled', fulfillment_type: 'delivery' },
  ])
  assert.deepEqual([summary.total, summary.cancelled, summary.new, summary.ready, summary.dine_in, summary.pickup, summary.delivery], [3, 1, 1, 1, 1, 1, 1])
  assert.equal(new Date(startOfToday(new Date(2026, 10, 1, 15, 30))).getHours(), 0)
})

test('bölge girişi: posta kodu ve tutar doğrulanır; ücret varsayılmaz', () => {
  assert.deepEqual(parsePostalCodes('34000, 34001;34000'), ['34000', '34001'])
  assert.equal(parsePostalCodes('34'), null)
  assert.equal(parsePostalCodes(''), null)
  assert.deepEqual(parseDistricts('Kadıköy, Üsküdar,'), ['Kadıköy', 'Üsküdar'])
  assert.equal(liraToCents('30,50'), 3050)
  assert.equal(liraToCents('0'), 0)
  assert.equal(liraToCents(''), null)
  assert.equal(liraToCents('-5'), null)
  assert.equal(centsToLira(3000), '30')
  assert.equal(centsToLira(3050), '30,50')
})

test('bölge çakışması: aynı kod iki açık bölgede olamaz; kapalı bölge ve kendisi sayılmaz', () => {
  const zones = [{ id: 'a', is_active: true, postal_codes: ['34000'] }, { id: 'b', is_active: false, postal_codes: ['34001'] }]
  assert.equal(conflictingPostal(['34000'], zones), '34000')
  assert.equal(conflictingPostal(['34001', '34002'], zones), null)
  assert.equal(conflictingPostal(['34000'], zones, 'a'), null)
})

test('QR adresi taban yolunu korur; hata iletileri teknik ayrıntı göstermez', () => {
  assert.equal(tableQrUrl('abc', 'https://x.example', '/waypoint/'), 'https://x.example/waypoint/masa/abc')
  assert.match(posErrorMessage({ message: 'pos:forbidden' }), /yetkiniz yok/)
  assert.doesNotMatch(posErrorMessage({ message: 'relation public.x does not exist' }), /relation/)
})

test('masa QR: sipariş kapalıyken menü açılır, sipariş kapalı görünür; geçersiz kod ayrı kalır', () => {
  for (const code of ['ordering_closed', 'outside_hours', 'channel_closed']) assert.deepEqual(classifyTable({ error: { message: `pos:${code}` } }), { state: 'unavailable' })
  assert.deepEqual(classifyTable({ error: { message: 'pos:invalid_table' } }), { state: 'invalid' })
})

test('rotalar: tek yönetim girişi korumalıdır; POS yoksa mevcut menü yönetimi aynen açılır', () => {
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')
  assert.match(app, /path="\/admin\/:section" element=\{<ProtectedRoute><AdminApp \/><\/ProtectedRoute>\}/)
  const shell = readFileSync(new URL('../../src/admin/AdminApp.jsx', import.meta.url), 'utf8')
  assert.match(shell, /mode === 'legacy'\) return <AdminPage \/>/)
  assert.match(shell, /<AdminPage embedded \/>/)
})
