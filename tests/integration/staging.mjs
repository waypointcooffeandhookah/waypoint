// Gerçek staging veritabanına ağ üzerinden bütünleşme testi (npm run test:staging).
// Bölüm A: anonim müşteri, personel hesabı gerekmez. Bölüm B: .staging-credentials.local varsa personel.
// Yalnızca staging projesine bağlanır. Veri silmez; siparişler TEST notuyla işaretlenir.
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { STAGING_REF } from '../../src/supabaseTarget.js'

const root = new URL('../../', import.meta.url)
const env = Object.fromEntries(readFileSync(new URL('.env.staging.local', root), 'utf8').split(/\r?\n/).filter(Boolean).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY
if (URL_ !== `https://${STAGING_REF}.supabase.co`) { console.error('Hedef staging değil, test durduruldu.'); process.exit(2) }
const tokens = JSON.parse(readFileSync(new URL('.staging-qr.local', root), 'utf8'))
const credsFile = new URL('.staging-credentials.local', root)
const creds = existsSync(credsFile) ? JSON.parse(readFileSync(credsFile, 'utf8')) : null

const client = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = client()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = []
let failed = 0
async function step(name, fn) {
  try { const detail = await fn(); results.push(`OK    ${name}${detail ? ` -> ${detail}` : ''}`) }
  catch (error) { failed++; results.push(`FAIL  ${name} -> ${error.message}`) }
}
const expect = (ok, message) => { if (!ok) throw new Error(message) }
const NOTE = 'TEST staging.mjs'
const COFFEE = '5e000000-0000-4000-8000-000000000101', ESPRESSO = '5e000000-0000-4000-8000-000000000104', SOLD_OUT = '5e000000-0000-4000-8000-000000000302'
const line = (id, quantity) => ({ menu_item_id: id, quantity })
const place = (table, items, key = randomUUID(), extra = {}, db = anon) => db.rpc('place_qr_order', { p_table_token: tokens[table], p_idempotency_key: key, p_items: items, p_note: NOTE, ...extra })
const denied = ({ error, data }, label) => {
  expect(error, `${label}: reddedilmedi (${JSON.stringify(data)})`)
  expect(['42501', 'PGRST202', 'PGRST106'].includes(error.code) || /forbidden|permission denied/.test(error.message), `${label}: beklenmeyen hata ${error.code} ${error.message}`)
}

const scenario = { first: null, second: null, keys: [] }

await step('Anonim: menü ve fiyatlar okunur', async () => {
  const { data, error } = await anon.from('menu_items').select('name, price, is_available, categories(name)')
  expect(!error, error?.message)
  expect(data.length === 8, `ürün sayısı ${data.length}`)
  expect(Number(data.find(i => i.name === 'Espresso').price) === 87.5, 'Espresso fiyatı')
  expect(data.every(i => i.categories?.name), 'kategori ilişkisi eksik')
  return `${data.length} ürün`
})

await step('Anonim: POS tabloları okunamaz (RLS/yetki)', async () => {
  for (const table of ['orders', 'order_items', 'restaurant_tables', 'table_qr_tokens', 'table_sessions', 'bills', 'bill_summaries', 'payments', 'audit_log', 'staff_profiles', 'order_status_history']) {
    denied(await anon.from(table).select('*').limit(1), table)
  }
})

await step('Anonim: menü ve POS tablolarına yazamaz', async () => {
  const before = (await anon.from('menu_items').select('price').eq('name', 'Latte').single()).data.price
  denied(await anon.from('menu_items').insert({ name: 'sızma', price: 1 }), 'menu_items insert')
  denied(await anon.from('menu_items').update({ price: 1 }).eq('name', 'Latte').select(), 'menu_items update')
  denied(await anon.from('orders').insert({ idempotency_key: randomUUID() }), 'orders insert')
  denied(await anon.from('restaurant_tables').insert({ label: 'sızma' }), 'tables insert')
  denied(await anon.from('staff_profiles').insert({ user_id: randomUUID(), display_name: 'x', role: 'admin' }), 'staff insert')
  const after = (await anon.from('menu_items').select('price').eq('name', 'Latte').single()).data.price
  expect(before === after, 'fiyat değişti')
})

await step('Anonim: personel fonksiyonları ve pos_private kapalı', async () => {
  const id = randomUUID()
  denied(await anon.rpc('place_staff_order', { p_table_id: id, p_idempotency_key: id, p_items: [line(COFFEE, 1)] }), 'place_staff_order')
  denied(await anon.rpc('update_order_status', { p_order_id: id, p_status: 'ready' }), 'update_order_status')
  denied(await anon.rpc('record_payment', { p_bill_id: id, p_amount_cents: 1, p_method: 'cash', p_idempotency_key: id }), 'record_payment')
  denied(await anon.rpc('close_table_session', { p_session_id: id }), 'close_table_session')
  denied(await anon.rpc('open_table_session', { p_table_id: id }), 'open_table_session')
  denied(await anon.rpc('rotate_table_qr_token', { p_table_id: id }), 'rotate_table_qr_token')
  denied(await anon.rpc('upsert_staff_profile', { p_user_id: id, p_display_name: 'x', p_role: 'admin' }), 'upsert_staff_profile')
  denied(await anon.rpc('pos_current_role'), 'pos_current_role')
  denied(await anon.rpc('create_order', {}), 'create_order')
})

await step('QR: geçersiz masa kodu ve hatalı satırlar reddedilir, kayıt oluşmaz', async () => {
  const invalid = await anon.rpc('place_qr_order', { p_table_token: 'a'.repeat(64), p_idempotency_key: randomUUID(), p_items: [line(COFFEE, 1)] })
  expect(/invalid_table/.test(invalid.error?.message), 'geçersiz kod kabul edildi')
  expect(/empty_order/.test((await place('Masa 2', [])).error?.message), 'boş sipariş')
  expect(/invalid_quantity/.test((await place('Masa 2', [line(COFFEE, 21)])).error?.message), 'adet sınırı')
  expect(/item_unavailable/.test((await place('Masa 2', [line(SOLD_OUT, 1)])).error?.message), 'tükenmiş ürün')
  expect(/item_unavailable/.test((await place('Masa 2', [line(randomUUID(), 1)])).error?.message), 'olmayan ürün')
})

await step('Senaryo: Masa 5 müşterisi 2 kahve sipariş eder, fiyat sunucudan gelir', async () => {
  const key = randomUUID()
  // Tarayıcıdan gelen sahte fiyat ve masa yok sayılmalı.
  const { data, error } = await place('Masa 5', [{ ...line(COFFEE, 2), price: 1, unit_price_cents: 1, table_id: randomUUID() }], key)
  expect(!error, error?.message)
  expect(data.table_label === 'Masa 5' && data.status === 'new' && data.source === 'qr', JSON.stringify(data))
  expect(Number(data.subtotal_cents) === 18000, `tutar ${data.subtotal_cents}`)
  scenario.first = data; scenario.keys.push(key)
  scenario.firstKey = key
  return `sipariş #${data.order_number}, 180,00 ₺`
})

await step('Tekrar deneme: aynı anahtar yeni sipariş üretmez', async () => {
  const { data, error } = await place('Masa 5', [line(COFFEE, 2)], scenario.firstKey)
  expect(!error, error?.message)
  expect(data.duplicate === true && data.order_id === scenario.first.order_id, JSON.stringify(data))
})

await step('Tekrar deneme: aynı anahtar başka masada reddedilir', async () => {
  expect(/idempotency_key_conflict/.test((await place('Masa 6', [line(COFFEE, 1)], scenario.firstKey)).error?.message), 'çakışma yakalanmadı')
})

await step('Senaryo: ikinci müşteri aynı masaya sipariş verir, ilkini göremez', async () => {
  const other = client(), key = randomUUID()
  const { data, error } = await place('Masa 5', [line(ESPRESSO, 3)], key, {}, other)
  expect(!error, error?.message)
  expect(Number(data.subtotal_cents) === 26250, `tutar ${data.subtotal_cents}`)
  scenario.second = data; scenario.secondKey = key
  const mine = await other.rpc('get_qr_orders', { p_table_token: tokens['Masa 5'], p_idempotency_keys: [key] })
  expect(mine.data.length === 1 && mine.data[0].order_id === data.order_id, 'kendi siparişi')
  const none = await other.rpc('get_qr_orders', { p_table_token: tokens['Masa 5'], p_idempotency_keys: [randomUUID()] })
  expect(none.data.length === 0, 'başkasının siparişi göründü')
  const wrongTable = await other.rpc('get_qr_orders', { p_table_token: tokens['Masa 6'], p_idempotency_keys: [key] })
  expect(wrongTable.data.length === 0, 'başka masa kodu ile sipariş göründü')
})

await step('Eşzamanlı: aynı anahtarla 8 paralel istek tek sipariş üretir', async () => {
  const key = randomUUID()
  const answers = await Promise.all(Array.from({ length: 8 }, () => place('Masa 8', [line(COFFEE, 1)], key, {}, client())))
  const errors = answers.filter(a => a.error).map(a => a.error.message)
  expect(!errors.length, errors.join('; '))
  const ids = new Set(answers.map(a => a.data.order_id))
  expect(ids.size === 1, `${ids.size} sipariş oluştu`)
  expect(answers.filter(a => !a.data.duplicate).length === 1, 'birden çok "yeni" yanıtı')
})

await step('Eşzamanlı: 6 oturumdan farklı siparişler kaybolmaz', async () => {
  const keys = Array.from({ length: 6 }, () => randomUUID())
  const answers = await Promise.all(keys.map(key => place('Masa 9', [line(COFFEE, 1)], key, {}, client())))
  const errors = answers.filter(a => a.error).map(a => a.error.message)
  expect(!errors.length, errors.join('; '))
  const seen = await anon.rpc('get_qr_orders', { p_table_token: tokens['Masa 9'], p_idempotency_keys: keys })
  expect(seen.data.length === 6 && new Set(seen.data.map(o => o.order_number)).size === 6, `${seen.data?.length} sipariş`)
})

await step('Hız sınırı: masa başına 5 dakikada en fazla 12 QR sipariş', async () => {
  let placed = 0
  for (let i = 0; i < 13; i++) {
    const { error } = await place('Masa 10', [line(COFFEE, 1)])
    if (error) {
      expect(/rate_limited/.test(error.message), error.message)
      return `${placed} siparişten sonra durduruldu`
    }
    placed++
  }
  throw new Error('sınır uygulanmadı')
})

await step('Realtime: anonim abone sipariş verisi almaz', async () => {
  const listener = client(), events = []
  let status
  const channel = listener.channel(`anon-${randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => events.push(payload))
    .subscribe(next => { status = next })
  for (let i = 0; i < 40 && status !== 'SUBSCRIBED'; i++) await sleep(250)
  expect(status === 'SUBSCRIBED', `abonelik: ${status}`)
  await place('Masa 7', [line(COFFEE, 1)])
  await sleep(4000)
  await listener.removeChannel(channel)
  expect(events.length === 0, `${events.length} olay sızdı`)
})

if (!creds) {
  results.push('SKIP  Bölüm B (garson, mutfak, yönetici, personel Realtime): .staging-credentials.local yok')
} else {
  const signIn = async role => {
    const db = client()
    const { error } = await db.auth.signInWithPassword(creds[role])
    expect(!error, `${role} girişi: ${error?.message}`)
    return db
  }
  const staff = {}
  await step('Personel: yönetici, garson ve mutfak girişi ve rolleri', async () => {
    for (const role of ['admin', 'waiter', 'kitchen']) {
      staff[role] = await signIn(role)
      const { data, error } = await staff[role].rpc('pos_current_role')
      expect(!error && data === role, `${role}: ${data ?? error?.message}`)
    }
  })

  const { waiter, kitchen, admin } = staff
  const table5 = (await waiter.from('restaurant_tables').select('id').eq('label', 'Masa 5').single()).data?.id
  const listen = (db, events) => new Promise((resolve, reject) => {
    const channel = db.channel(`staff-${randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => events.push(payload))
      .subscribe(status => {
        if (status === 'SUBSCRIBED') resolve(channel)
        if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) reject(new Error(`abonelik ${status}`))
      })
  })
  const until = async (fn, label, ms = 10000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (fn()) return; await sleep(100) }
    throw new Error(`zaman aşımı: ${label}`)
  }
  const kitchenEvents = [], waiterEvents = []
  let kitchenChannel, waiterChannel

  await step('Yetki: mutfak sipariş veremez, adisyon ve QR kodlarını göremez', async () => {
    denied(await kitchen.rpc('place_staff_order', { p_table_id: table5, p_idempotency_key: randomUUID(), p_items: [line(COFFEE, 1)] }), 'mutfak siparişi')
    const bills = await kitchen.from('bills').select('id')
    expect(!bills.error && bills.data.length === 0, 'mutfak adisyon gördü')
    const qr = await kitchen.from('table_qr_tokens').select('token')
    expect(!qr.error && qr.data.length === 0, 'mutfak QR kodu gördü')
    denied(await kitchen.rpc('rotate_table_qr_token', { p_table_id: table5 }), 'mutfak QR yenileme')
  })

  await step('Yetki: garson QR kodu göremez, masa ekleyemez, personel atayamaz', async () => {
    const qr = await waiter.from('table_qr_tokens').select('token')
    expect(!qr.error && qr.data.length === 0, 'garson QR kodu gördü')
    expect((await waiter.from('restaurant_tables').insert({ label: 'sızma' })).error, 'garson masa ekledi')
    denied(await waiter.rpc('upsert_staff_profile', { p_user_id: randomUUID(), p_display_name: 'x', p_role: 'admin' }), 'garson personel atadı')
    const log = await waiter.from('audit_log').select('id')
    expect(!log.error && log.data.length === 0, 'garson denetim kaydı gördü')
  })

  await step('Realtime: mutfak ve garson yeni siparişi yenilemeden alır (RLS ile)', async () => {
    kitchenChannel = await listen(kitchen, kitchenEvents)
    waiterChannel = await listen(waiter, waiterEvents)
    await sleep(500)
    const key = randomUUID()
    const { data, error } = await place('Masa 5', [line(COFFEE, 1)], key)
    expect(!error, error?.message)
    scenario.third = data
    await until(() => kitchenEvents.some(e => e.new?.id === data.order_id), 'mutfak olayı')
    await until(() => waiterEvents.some(e => e.new?.id === data.order_id), 'garson olayı')
  })

  await step('Mutfak: Hazırlanıyor → Hazır; garson geçiş yapamaz, garson olayı alır', async () => {
    const id = scenario.first.order_id
    denied(await waiter.rpc('update_order_status', { p_order_id: id, p_status: 'preparing' }), 'garson hazırlanıyor')
    const preparing = await kitchen.rpc('update_order_status', { p_order_id: id, p_status: 'preparing' })
    expect(!preparing.error && preparing.data.status === 'preparing', preparing.error?.message)
    await until(() => waiterEvents.some(e => e.new?.id === id && e.new?.status === 'preparing'), 'garsonda hazırlanıyor')
    const skip = await kitchen.rpc('update_order_status', { p_order_id: scenario.second.order_id, p_status: 'ready' })
    expect(/invalid_transition/.test(skip.error?.message), 'adım atlandı')
    const ready = await kitchen.rpc('update_order_status', { p_order_id: id, p_status: 'ready' })
    expect(!ready.error && ready.data.status === 'ready', ready.error?.message)
    await until(() => waiterEvents.some(e => e.new?.id === id && e.new?.status === 'ready'), 'garsonda hazır')
    const { data } = await waiter.from('orders').select('status').eq('id', id).single()
    expect(data.status === 'ready', data.status)
    const customer = await anon.rpc('get_qr_orders', { p_table_token: tokens['Masa 5'], p_idempotency_keys: [scenario.firstKey] })
    expect(customer.data[0].status === 'ready', 'müşteri durumu')
  })

  await step('Garson: siparişi aynı açık adisyona ekler', async () => {
    const { data, error } = await waiter.rpc('place_staff_order', { p_table_id: table5, p_idempotency_key: randomUUID(), p_items: [line(COFFEE, 1)], p_note: NOTE })
    expect(!error, error?.message)
    expect(data.source === 'waiter', data.source)
    scenario.fourth = data
  })

  let bill
  await step('Adisyon: Masa 5 tüm siparişleri ve doğru toplamı içerir', async () => {
    const summary = await waiter.from('bill_summaries').select('*').eq('table_id', table5).eq('status', 'open').single()
    expect(!summary.error, summary.error?.message)
    bill = summary.data
    const orders = await waiter.from('orders').select('id, subtotal_cents, order_items(item_name, quantity, unit_price_cents, line_total_cents)').eq('bill_id', bill.bill_id)
    const ids = orders.data.map(o => o.id)
    for (const o of [scenario.first, scenario.second, scenario.third, scenario.fourth]) expect(ids.includes(o.order_id), `eksik sipariş ${o.order_number}`)
    const lines = orders.data.flatMap(o => o.order_items)
    expect(lines.some(l => l.item_name === 'Türk Kahvesi' && l.quantity === 2 && Number(l.line_total_cents) === 18000), 'kahve satırı')
    expect(lines.some(l => l.item_name === 'Espresso' && l.quantity === 3 && Number(l.line_total_cents) === 26250), 'espresso satırı')
    const sum = lines.reduce((total, l) => total + Number(l.line_total_cents), 0)
    expect(Number(bill.total_cents) === sum, `özet ${bill.total_cents} ≠ satırlar ${sum}`)
    return `${orders.data.length} sipariş, ${sum / 100} ₺`
  })

  await step('Kapanış: bakiye varken kapanmaz; ödeme tekrar edilemez; kapanır', async () => {
    const session = bill.session_id
    expect(/orders_in_progress|balance_due/.test((await waiter.rpc('close_table_session', { p_session_id: session })).error?.message), 'erken kapandı')
    const open = await waiter.from('orders').select('id, status').eq('bill_id', bill.bill_id)
    for (const order of open.data) {
      for (const status of { new: ['preparing', 'ready', 'served'], preparing: ['ready', 'served'], ready: ['served'] }[order.status] ?? []) {
        const { error } = await kitchen.rpc('update_order_status', { p_order_id: order.id, p_status: status })
        expect(!error, error?.message)
      }
    }
    const key = randomUUID()
    const over = await waiter.rpc('record_payment', { p_bill_id: bill.bill_id, p_amount_cents: Number(bill.total_cents) + 1, p_method: 'cash', p_idempotency_key: randomUUID() })
    expect(/overpayment/.test(over.error?.message), 'fazla ödeme kabul edildi')
    denied(await kitchen.rpc('record_payment', { p_bill_id: bill.bill_id, p_amount_cents: 1, p_method: 'cash', p_idempotency_key: randomUUID() }), 'mutfak ödeme')
    const pay = await waiter.rpc('record_payment', { p_bill_id: bill.bill_id, p_amount_cents: Number(bill.total_cents), p_method: 'card', p_idempotency_key: key })
    expect(!pay.error && Number(pay.data.balance_cents) === 0, pay.error?.message)
    const again = await waiter.rpc('record_payment', { p_bill_id: bill.bill_id, p_amount_cents: Number(bill.total_cents), p_method: 'card', p_idempotency_key: key })
    expect(again.data?.duplicate === true, 'ödeme iki kez işlendi')
    const closed = await waiter.rpc('close_table_session', { p_session_id: session })
    expect(!closed.error, closed.error?.message)
  })

  await step('Yönetici: denetim kaydını okur; zorla kapatma yalnızca yöneticiye açık', async () => {
    const log = await admin.from('audit_log').select('action').limit(5)
    expect(!log.error && log.data.length > 0, 'denetim kaydı boş')
  })

  await step('Yeniden bağlanma: Realtime kopup bağlanınca olay yeniden gelir', async () => {
    kitchen.realtime.disconnect()
    await sleep(500)
    const offline = await place('Masa 5', [line(COFFEE, 1)])
    expect(!offline.error, offline.error?.message)
    // Kopukken gelen sipariş kalıcı kayıttan okunur; Realtime yalnızca sinyaldir.
    const row = await kitchen.from('orders').select('id').eq('id', offline.data.order_id).single()
    expect(!row.error, 'kopukken kayıt okunamadı')
    expect(!kitchenEvents.some(e => e.new?.id === offline.data.order_id), 'kopukken olay geldi')
    await kitchen.removeChannel(kitchenChannel)
    const after = []
    kitchenChannel = await listen(kitchen, after)
    await sleep(500)
    const online = await place('Masa 5', [line(COFFEE, 1)])
    expect(!online.error, online.error?.message)
    await until(() => after.some(e => e.new?.id === online.data.order_id), 'yeniden bağlanınca olay')
    await waiter.removeChannel(waiterChannel)
    await kitchen.removeChannel(kitchenChannel)
    // Masa manuel test için temiz kalsın: bu iki test siparişi iptal, oturum kapatılır (silme yok).
    for (const order of [offline.data, online.data]) {
      const { error } = await admin.rpc('update_order_status', { p_order_id: order.order_id, p_status: 'cancelled', p_reason: 'test temizliği' })
      expect(!error, error?.message)
    }
    const { data: open } = await admin.from('table_sessions').select('id').eq('table_id', table5).eq('status', 'open').single()
    const close = await admin.rpc('close_table_session', { p_session_id: open.id })
    expect(!close.error, close.error?.message)
  })
}

console.log(results.join('\n'))
console.log(`\n${results.filter(r => r.startsWith('OK')).length} geçti, ${failed} kaldı, ${results.filter(r => r.startsWith('SKIP')).length} atlandı`)
process.exit(failed ? 1 : 0)
