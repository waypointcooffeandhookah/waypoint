// Masa, paket ve kurye akışının gerçek staging testi (npm run test:multichannel).
// Yalnızca staging'e bağlanır; kurgusal müşteri ve adres kullanır, veri silmez.
import { readFileSync } from 'node:fs'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { PRODUCTION_REF, STAGING_REF } from '../../src/supabaseTarget.js'
import { READY_NOTIFICATION_SELECT } from '../../src/pos/waiter/notifications.js'
import { FULFILLMENT_SELECT } from '../../src/pos/fulfillment/fulfillmentOrders.js'

const root = new URL('../../', import.meta.url)
const env = Object.fromEntries(readFileSync(new URL('.env.staging.local', root), 'utf8').split(/\r?\n/).filter(Boolean).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
if (env.VITE_SUPABASE_URL !== `https://${STAGING_REF}.supabase.co`) { console.error('Hedef staging değil.'); process.exit(2) }
const tokens = JSON.parse(readFileSync(new URL('.staging-qr.local', root), 'utf8'))
const creds = JSON.parse(readFileSync(new URL('.staging-credentials.local', root), 'utf8'))

const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const anon = client()
const results = []
let failed = 0
async function step(name, fn) {
  try { const detail = await fn(); results.push(`OK    ${name}${detail ? ` -> ${detail}` : ''}`) }
  catch (error) { failed++; results.push(`FAIL  ${name} -> ${error.message}`) }
}
const expect = (ok, message) => { if (!ok) throw new Error(message) }
const signIn = async role => {
  const db = client()
  const { error } = await db.auth.signInWithPassword(creds[role])
  if (error) throw new Error(`${role} girişi başarısız`)
  return db
}
const admin = await signIn('admin'), waiter = await signIn('waiter'), kitchen = await signIn('kitchen')

const COFFEE = '5e000000-0000-4000-8000-000000000101', ESPRESSO = '5e000000-0000-4000-8000-000000000104', SOLD_OUT = '5e000000-0000-4000-8000-000000000302'
const phone = () => `0555${randomInt(1000000, 9999999)}`
const SECRET_STREET = `Kurgusal Gizli Sokak ${randomInt(1000, 9999)}`
const NAME = 'Kurgusal Müşteri'
const customer = (extra = {}) => ({ name: NAME, phone: phone(), ...extra })
const address = (extra = {}) => ({ street: SECRET_STREET, district: 'Deneme', postal_code: '99001', building: '3', floor: '2', door: '5', instructions: 'Test notu', ...extra })
const line = (id, quantity) => ({ menu_item_id: id, quantity })
const place = (type, items, extra = {}, db = anon) => db.rpc('place_online_order', {
  p_fulfillment_type: type, p_idempotency_key: randomUUID(), p_items: items, p_customer: customer(),
  p_address: type === 'delivery' ? address() : null, p_note: 'TEST multichannel', ...extra,
})
const code = ({ error }) => /^pos:([a-z_]+)/.exec(error?.message ?? '')?.[1] ?? error?.code ?? 'yok'
const walk = async (db, id, statuses) => {
  for (const status of statuses) {
    const { error } = await db.rpc('update_order_status', { p_order_id: id, p_status: status })
    expect(!error, `${status}: ${error?.message}`)
  }
}
const track = async token => (await anon.rpc('get_order_tracking', { p_tracking_token: token })).data
const shared = {}

await step('Katalog: üretimle aynı ürün, kategori, fiyat ve stok; görseller bayt bayt aynı (üretim yalnızca okunur)', async () => {
  const prodOrigin = `https://${PRODUCTION_REF}.supabase.co`, prodKey = /eyJ[\w.-]+/.exec(readFileSync(new URL('src/config.js', root), 'utf8'))[0]
  const prodGet = async path => (await fetch(`${prodOrigin}/rest/v1/${path}`, { method: 'GET', headers: { apikey: prodKey, Authorization: `Bearer ${prodKey}` } })).json()
  const [prodCats, prodItems] = [await prodGet('categories?select=*'), await prodGet('menu_items?select=*')]
  const stagingCats = (await anon.from('categories').select('*')).data
  const stagingItems = (await anon.from('menu_items').select('*, categories(name)')).data
  expect(prodItems.length === 104 && prodCats.length === 11, `üretim ${prodCats.length}/${prodItems.length}`)
  expect(stagingCats.length === 11, `staging kategori ${stagingCats.length}`)
  const prodCatName = new Map(prodCats.map(cat => [cat.id, cat.name]))
  const byName = new Map(stagingItems.map(item => [item.name, item]))
  expect(byName.size === stagingItems.length, 'staging ürünlerinde kopya ad')
  expect(prodCats.every(cat => stagingCats.some(row => row.name === cat.name && row.sort_order === cat.sort_order)), 'kategori sırası')
  const hashes = new Map()
  const imageHash = async url => {
    if (!hashes.has(url)) {
      const response = await fetch(url)
      expect(response.ok && /^image\//.test(response.headers.get('content-type') ?? ''), `bozuk görsel: ${url}`)
      hashes.set(url, createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex'))
    }
    return hashes.get(url)
  }
  for (const item of prodItems) {
    const row = byName.get(item.name)
    expect(row, `eksik ürün: ${item.name}`)
    expect(Number(row.price) === Number(item.price) && row.is_available === item.is_available && row.description === item.description, `alan farkı: ${item.name}`)
    expect(row.categories.name === prodCatName.get(item.category_id), `kategori farkı: ${item.name}`)
    if (!item.image_url) { expect(!row.image_url, `uydurma görsel: ${item.name}`); continue }
    expect(row.image_url.startsWith(env.VITE_SUPABASE_URL), `üretime bağlı görsel: ${item.name}`)
    expect(await imageHash(row.image_url) === await imageHash(item.image_url), `farklı fotoğraf: ${item.name}`)
  }
  const extra = stagingItems.filter(item => !prodItems.some(prod => prod.name === item.name))
  expect(extra.length === 1 && extra[0].categories.name === 'Taze Meyve Suları' && extra[0].is_available === false, `beklenmeyen ürün: ${extra.map(i => i.name)}`)
  return `${prodItems.length} ürün, ${prodCats.length} kategori, ${hashes.size / 2} görsel aynı`
})

await step('1. Masa 5 siparişi mutfağa ve masa adisyonuna gider', async () => {
  const { data, error } = await anon.rpc('place_qr_order', { p_table_token: tokens['Masa 5'], p_idempotency_key: randomUUID(), p_items: [line(COFFEE, 2)], p_note: 'TEST multichannel' })
  expect(!error, error?.message)
  shared.dine = data
  const row = await kitchen.from('orders').select('fulfillment_type, bill_id, restaurant_tables(label)').eq('id', data.order_id).single()
  expect(row.data.fulfillment_type === 'dine_in' && row.data.restaurant_tables.label === 'Masa 5', JSON.stringify(row.data))
  const bill = await waiter.from('bill_summaries').select('bill_id, order_count').eq('bill_id', row.data.bill_id).single()
  expect(!bill.error && bill.data.order_count >= 1, 'adisyonda yok')
  return `#${data.order_number}`
})

await step('2. Paket: masasız mutfağa düşer, numara ve takip kodu üretilir, adisyon açılmaz', async () => {
  const { data, error } = await place('pickup', [line(COFFEE, 2)])
  expect(!error, error?.message)
  shared.pickup = data
  expect(Number(data.total_cents) === 16000 && Number(data.delivery_fee_cents) === 0, `toplam ${data.total_cents}`)
  expect(/^[0-9a-f]{64}$/.test(data.tracking_token), 'takip kodu')
  const row = await kitchen.from('orders').select('table_id, session_id, bill_id, fulfillment_type').eq('id', data.order_id).single()
  expect(row.data.table_id === null && row.data.session_id === null && row.data.bill_id === null && row.data.fulfillment_type === 'pickup', JSON.stringify(row.data))
  return `#${data.order_number}`
})

await step('3 ve 5. Kurye: geçerli adresle mutfağa düşer; ücret ve toplam sunucuda doğru hesaplanır', async () => {
  const { data, error } = await place('delivery', [{ ...line(ESPRESSO, 2), price: 1, unit_price_cents: 1 }], { p_address: address({ fee_cents: 0 }) })
  expect(!error, error?.message)
  shared.delivery = data
  expect(Number(data.subtotal_cents) === 20000 && Number(data.delivery_fee_cents) === 3000 && Number(data.total_cents) === 23000, `${data.subtotal_cents}+${data.delivery_fee_cents}=${data.total_cents}`)
  return `200,00 + 30,00 = 230,00 ₺, #${data.order_number}`
})

await step('4. Geçersiz adres ve kurallar reddedilir, kayıt oluşmaz', async () => {
  const cases = [
    ['out_of_area', { p_address: address({ postal_code: '11111' }) }],
    ['out_of_area', { p_address: address({ postal_code: '99099' }) }],
    ['out_of_area', { p_address: address({ district: 'Başka İlçe' }) }],
    ['invalid_address', { p_address: address({ street: 'x' }) }],
    ['invalid_address', { p_address: null }],
    ['invalid_phone', { p_customer: { name: NAME, phone: '12' } }],
    ['invalid_name', { p_customer: { name: 'A', phone: phone() } }],
  ]
  for (const [expected, extra] of cases) expect(code(await place('delivery', [line(ESPRESSO, 2)], extra)) === expected, `${expected} beklendi: ${JSON.stringify(extra).slice(0, 60)}`)
  expect(code(await place('delivery', [line(COFFEE, 1)])) === 'below_minimum', 'asgari tutar')
  expect(code(await place('pickup', [line(SOLD_OUT, 1)])) === 'item_unavailable', 'tükenmiş ürün')
  expect(code(await place('dine_in', [line(COFFEE, 1)])) === 'invalid_fulfillment', 'masasız masa siparişi')
  const quote = (await anon.rpc('check_delivery_address', { p_postal_code: '99001', p_district: 'DENEME' })).data
  expect(quote.in_area === true && Number(quote.fee_cents) === 3000, 'bölge sorgusu')
  expect((await anon.rpc('check_delivery_address', { p_postal_code: '11111', p_district: 'Deneme' })).data.in_area === false, 'alan dışı sorgu')
})

await step('6. Mutfak üç türü ayırır ve müşteri bilgisini okuyamaz', async () => {
  const rows = await kitchen.from('orders').select('id, fulfillment_type').in('id', [shared.dine.order_id, shared.pickup.order_id, shared.delivery.order_id])
  expect(new Set(rows.data.map(row => row.fulfillment_type)).size === 3, 'türler ayrılmadı')
  expect(!JSON.stringify(rows.data).includes(SECRET_STREET), 'adres sızdı')
  const details = await kitchen.from('order_fulfillments').select('customer_name, street')
  expect(!details.error && details.data.length === 0, 'mutfak müşteri bilgisi gördü')
})

await step('8. Müşteri kendi siparişini kodla izler; kişisel veri dönmez, başka kod çalışmaz', async () => {
  const tracking = await track(shared.delivery.tracking_token)
  expect(tracking.fulfillment_type === 'delivery' && tracking.kitchen_status === 'new' && tracking.payment_status === 'unpaid', JSON.stringify(tracking))
  const raw = JSON.stringify(tracking)
  expect(!raw.includes(SECRET_STREET) && !raw.includes(NAME), 'takipte kişisel veri')
  expect(code(await anon.rpc('get_order_tracking', { p_tracking_token: 'b'.repeat(64) })) === 'invalid_tracking', 'sahte kod')
  expect(code(await anon.rpc('get_order_tracking', { p_tracking_token: shared.delivery.order_id })) === 'invalid_tracking', 'sipariş kimliği kod sayıldı')
})

await step('9. Yetkisiz kullanıcı adres okuyamaz ve teslimatı değiştiremez', async () => {
  for (const table of ['order_fulfillments', 'delivery_zones', 'fulfillment_settings']) expect((await anon.from(table).select('*').limit(1)).error, `anonim ${table} okudu`)
  const id = shared.delivery.order_id
  expect((await anon.rpc('update_fulfillment_status', { p_order_id: id, p_status: 'delivered' })).error, 'anonim teslimat')
  expect((await anon.rpc('record_fulfillment_payment', { p_order_id: id, p_method: 'cash' })).error, 'anonim ödeme')
  for (const db of [waiter, kitchen]) {
    expect((await db.from('order_fulfillments').select('street')).data.length === 0, 'personel adres gördü')
    expect(code(await db.rpc('update_fulfillment_status', { p_order_id: id, p_status: 'delivered' })) === 'forbidden', 'yetkisiz teslimat')
    expect(code(await db.rpc('record_fulfillment_payment', { p_order_id: id, p_method: 'cash' })) === 'forbidden', 'yetkisiz ödeme')
    expect(code(await db.rpc('assign_order_courier', { p_order_id: id, p_courier_name: 'Sahte Kurye' })) === 'forbidden', 'yetkisiz kurye')
    expect((await db.from('delivery_zones').update({ fee_cents: 0 }).neq('fee_cents', -1).select('id')).data?.length === 0, 'bölge ücreti değişti')
  }
  const seen = await admin.from('order_fulfillments').select(FULFILLMENT_SELECT).eq('order_id', id).single()
  expect(!seen.error && seen.data.street === SECRET_STREET, `yönetici adresi okuyamadı: ${seen.error?.message}`)
})

await step('Realtime: anonim abone satır verisi almaz, yetkili personel sinyal alır', async () => {
  const listener = client(), events = [], staffEvents = []
  let anonStatus, staffStatus
  const a = listener.channel(`anon-${randomUUID()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, p => events.push(p)).subscribe(s => { anonStatus = s })
  const b = admin.channel(`staff-${randomUUID()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, p => staffEvents.push(p)).subscribe(s => { staffStatus = s })
  for (let i = 0; i < 40 && (anonStatus !== 'SUBSCRIBED' || staffStatus !== 'SUBSCRIBED'); i++) await sleep(250)
  await sleep(2000)
  const street = `Gerçek Zamanlı Sokak ${randomInt(1000, 9999)}`
  const { data, error } = await place('delivery', [line(ESPRESSO, 2)], { p_address: address({ street }) })
  expect(!error, error?.message)
  await sleep(5000)
  shared.realtimeOrder = data
  await listener.removeChannel(a); await admin.removeChannel(b)
  expect(staffEvents.some(e => e.new?.id === data.order_id), 'personel sinyal almadı')
  expect(!JSON.stringify(staffEvents).includes(street), 'Realtime adres taşıdı')
  for (const event of events) expect(Object.keys(event.new ?? {}).length === 0 && !JSON.stringify(event).includes(data.order_id), 'anonim satır verisi aldı')
  return `anonim: ${events.length} içeriksiz bildirim`
})

await step('7. Mutfak ve teslimat durumları ayrı ilerler; mutfak son adımı yapamaz', async () => {
  const id = shared.delivery.order_id
  expect(code(await admin.rpc('update_fulfillment_status', { p_order_id: id, p_status: 'handed_to_courier', p_courier_name: 'Kurgusal Kurye' })) === 'invalid_transition', 'mutfak bitmeden kuryeye verildi')
  await walk(kitchen, id, ['preparing', 'ready'])
  expect((await track(shared.delivery.tracking_token)).fulfillment_status === 'awaiting_handoff', 'teslim bekliyor olmadı')
  expect(code(await kitchen.rpc('update_order_status', { p_order_id: id, p_status: 'served' })) === 'invalid_transition', 'mutfak servis yaptı')
  expect(code(await waiter.rpc('update_order_status', { p_order_id: id, p_status: 'served' })) === 'invalid_transition', 'garson servis yaptı')
  expect(code(await admin.rpc('update_fulfillment_status', { p_order_id: id, p_status: 'handed_to_courier' })) === 'courier_required', 'kurye adı zorunlu')
  await admin.rpc('assign_order_courier', { p_order_id: id, p_courier_name: 'Kurgusal Kurye' })
  expect((await track(shared.delivery.tracking_token)).fulfillment_status === 'awaiting_handoff', 'atama sevk sayıldı')
  expect(!(await admin.rpc('update_fulfillment_status', { p_order_id: id, p_status: 'handed_to_courier' })).error, 'kuryeye verilemedi')
  let tracking = await track(shared.delivery.tracking_token)
  expect(tracking.fulfillment_status === 'handed_to_courier' && tracking.kitchen_status === 'served', JSON.stringify(tracking))
  expect(!JSON.stringify(tracking).includes('Kurgusal Kurye'), 'kurye adı müşteriye sızdı')
  expect(tracking.payment_status === 'unpaid', 'ödeme kendiliğinden işlendi')
  expect(!(await admin.rpc('record_fulfillment_payment', { p_order_id: id, p_method: 'cash' })).error, 'ödeme')
  expect(!(await admin.rpc('update_fulfillment_status', { p_order_id: id, p_status: 'delivered' })).error, 'teslim')
  tracking = await track(shared.delivery.tracking_token)
  expect(tracking.fulfillment_status === 'delivered' && tracking.payment_status === 'paid', JSON.stringify(tracking))
  const pid = shared.pickup.order_id
  await walk(kitchen, pid, ['preparing', 'ready'])
  expect(code(await admin.rpc('update_fulfillment_status', { p_order_id: pid, p_status: 'handed_to_courier', p_courier_name: 'X Y' })) === 'invalid_transition', 'pakete kurye')
  expect(!(await admin.rpc('update_fulfillment_status', { p_order_id: pid, p_status: 'collected' })).error, 'teslim alındı')
  expect((await track(shared.pickup.tracking_token)).fulfillment_status === 'collected', 'paket tamamlanmadı')
})

await step('İptal: garson paket iptal edemez; yönetici eder, müşteri görür, ödeme alınamaz', async () => {
  const { data } = await place('pickup', [line(COFFEE, 1)])
  expect(code(await waiter.rpc('update_order_status', { p_order_id: data.order_id, p_status: 'cancelled' })) === 'forbidden', 'garson iptal etti')
  expect(!(await admin.rpc('update_order_status', { p_order_id: data.order_id, p_status: 'cancelled', p_reason: 'test' })).error, 'iptal')
  expect((await track(data.tracking_token)).fulfillment_status === 'cancelled', 'müşteri görmedi')
  expect(code(await admin.rpc('record_fulfillment_payment', { p_order_id: data.order_id, p_method: 'cash' })) === 'invalid_transition', 'iptale ödeme')
  const { error } = await admin.rpc('update_order_status', { p_order_id: shared.realtimeOrder.order_id, p_status: 'cancelled', p_reason: 'test' })
  expect(!error, error?.message)
})

await step('10. Çift gönderim: 8 paralel istek tek sipariş; aynı anahtar başka kanalda reddedilir', async () => {
  const key = randomUUID(), person = customer()
  const answers = await Promise.all(Array.from({ length: 8 }, () => place('pickup', [line(COFFEE, 1)], { p_idempotency_key: key, p_customer: person }, client())))
  const errors = answers.filter(a => a.error).map(a => a.error.message)
  expect(!errors.length, errors.join('; '))
  expect(new Set(answers.map(a => a.data.order_id)).size === 1, 'çift sipariş')
  expect(answers.filter(a => !a.data.duplicate).length === 1, 'birden çok yeni yanıt')
  expect(code(await place('delivery', [line(ESPRESSO, 2)], { p_idempotency_key: key })) === 'idempotency_key_conflict', 'kanal çakışması')
  await admin.rpc('update_order_status', { p_order_id: answers[0].data.order_id, p_status: 'cancelled', p_reason: 'test' })
})

await step('Eşzamanlı masa ve paket: masa adisyonu paketten etkilenmez', async () => {
  const before = (await waiter.from('orders').select('bill_id').eq('id', shared.dine.order_id).single()).data.bill_id
  const summary = async () => (await waiter.from('bill_summaries').select('total_cents, order_count').eq('bill_id', before).single()).data
  const start = await summary()
  const { data } = await place('pickup', [line(COFFEE, 5)])
  expect(JSON.stringify(await summary()) === JSON.stringify(start), 'paket adisyonu değiştirdi')
  await admin.rpc('update_order_status', { p_order_id: data.order_id, p_status: 'cancelled', p_reason: 'test' })
})

await step('11. Garson bildirimi korunur: masa bildirimi gelir, paket ve kurye gelmez', async () => {
  await walk(kitchen, shared.dine.order_id, ['preparing', 'ready'])
  const notifications = await waiter.from('order_status_history').select(READY_NOTIFICATION_SELECT).eq('to_status', 'ready').eq('orders.fulfillment_type', 'dine_in').order('id', { ascending: false }).limit(50)
  expect(!notifications.error, notifications.error?.message)
  const ids = notifications.data.map(row => row.order_id)
  expect(ids.includes(shared.dine.order_id), 'masa bildirimi yok')
  expect(!ids.includes(shared.delivery.order_id) && !ids.includes(shared.pickup.order_id), 'paket veya kurye garson bildirimine düştü')
  await walk(waiter, shared.dine.order_id, ['served'])
  // Masa açık kalmasın: ödenip normal yoldan kapatılır.
  const { data: open } = await waiter.from('bill_summaries').select('bill_id, session_id, balance_cents').eq('bill_id', (await waiter.from('orders').select('bill_id').eq('id', shared.dine.order_id).single()).data.bill_id).single()
  const paid = await waiter.rpc('record_payment', { p_bill_id: open.bill_id, p_amount_cents: Number(open.balance_cents), p_method: 'cash', p_idempotency_key: randomUUID() })
  expect(!paid.error, paid.error?.message)
  const closed = await waiter.rpc('close_table_session', { p_session_id: open.session_id })
  expect(!closed.error, closed.error?.message)
})

console.log(results.join('\n'))
console.log(`\n${results.filter(r => r.startsWith('OK')).length} geçti, ${failed} kaldı`)
process.exit(failed ? 1 : 0)
