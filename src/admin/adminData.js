// Yönetim panelinin saf mantığı (testli). Doğrulamanın asıl sahibi sunucudur.
export const DAYS = [[1, 'Pazartesi'], [2, 'Salı'], [3, 'Çarşamba'], [4, 'Perşembe'], [5, 'Cuma'], [6, 'Cumartesi'], [0, 'Pazar']]
export const STAFF_ROLES = { admin: 'Yönetici', manager: 'Müdür', cashier: 'Kasa', waiter: 'Garson', kitchen: 'Mutfak' }
export const BLOCK_LABELS = { ordering_closed: 'Sipariş alımı kapalı', outside_hours: 'Çalışma saatleri dışında' }

export function settingsToForm(row) {
  const hours = row.operating_hours ?? {}
  return {
    dine_in_enabled: row.dine_in_enabled,
    pickup_enabled: row.pickup_enabled && row.allow_pay_at_pickup,
    delivery_enabled: row.delivery_enabled && row.allow_cash_on_delivery,
    accepting_orders: row.accepting_orders,
    auto_open_order_type: row.auto_open_order_type,
    hours_enabled: row.hours_enabled,
    days: Object.fromEntries(DAYS.map(([day]) => [day, hours[day]
      ? { open: true, from: hours[day].open, to: hours[day].close }
      : { open: false, from: '09:00', to: '23:00' }])),
  }
}

export function formToSettings(form) {
  const operating_hours = {}
  for (const [day] of DAYS) {
    const value = form.days[day]
    if (value.open) operating_hours[day] = { open: value.from, close: value.to }
  }
  return {
    dine_in_enabled: form.dine_in_enabled, pickup_enabled: form.pickup_enabled, delivery_enabled: form.delivery_enabled,
    accepting_orders: form.accepting_orders, auto_open_order_type: form.auto_open_order_type, hours_enabled: form.hours_enabled, operating_hours,
  }
}

export function validateSettingsForm(form) {
  for (const [day, label] of DAYS) {
    const value = form.days[day]
    if (value.open && (!value.from || !value.to || value.from === value.to)) return `${label}: açılış ve kapanış farklı olmalı.`
  }
  if (form.hours_enabled && !DAYS.some(([day]) => form.days[day].open)) return 'Saat sınırı açıkken en az bir gün seçin.'
  return null
}

export function summarizeOrders(rows) {
  const summary = { total: 0, cancelled: 0, new: 0, preparing: 0, ready: 0, served: 0, dine_in: 0, pickup: 0, delivery: 0 }
  for (const row of rows) {
    if (row.status === 'cancelled') { summary.cancelled++; continue }
    summary.total++
    summary[row.status]++
    summary[row.fulfillment_type ?? 'dine_in']++
  }
  return summary
}

export const startOfToday = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

export function parsePostalCodes(text) {
  const codes = [...new Set(text.split(/[\s,;]+/).map(code => code.trim()).filter(Boolean))]
  return codes.length && codes.every(code => /^\d{5}$/.test(code)) ? codes : null
}

export const parseDistricts = text => [...new Set(text.split(/[,;]+/).map(item => item.trim()).filter(Boolean))]

// "30" veya "30,50" → kuruş. Geçersiz tutar null döner; ücret varsayılmaz.
export function liraToCents(text) {
  const value = String(text).trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null
  return Math.round(Number(value) * 100)
}

// Aynı posta kodu iki açık bölgede olursa hangi ücretin geçerli olacağı belirsizleşir.
export function conflictingPostal(codes, zones, ownId = null) {
  return codes.find(code => zones.some(zone => zone.is_active && zone.id !== ownId && zone.postal_codes.includes(code))) ?? null
}

export const centsToLira = cents => (Number(cents) / 100).toFixed(2).replace('.', ',').replace(',00', '')

export const tableQrUrl = (token, origin, base) => `${origin}${base}masa/${token}`

export const POS_ERRORS = {
  forbidden: 'Bu işlem için yetkiniz yok.', last_admin: 'Son aktif yöneticinin rolü düşürülemez veya erişimi kapatılamaz. Önce başka birini Yönetici yapın.', invalid_hours: 'Çalışma saatlerini kontrol edin.', invalid_settings: 'Ayarlar geçersiz.',
  table_not_found: 'Masa bulunamadı.', session_closed: 'Oturum zaten kapalı.',
}
const DB_ERRORS = { 23505: 'Bu adda bir masa zaten var. Farklı bir ad yazın.', 23514: 'Masa adı 1–40 karakter olmalı.' }
export const posErrorMessage = error => POS_ERRORS[/^pos:([a-z_]+)/.exec(error?.message ?? '')?.[1]] ?? DB_ERRORS[error?.code] ?? 'İşlem tamamlanamadı. Bağlantınızı kontrol edip tekrar deneyin.'

// Masayı listede bir yukarı/aşağı taşır: aktif masalar 0'dan başlayarak yeniden numaralanır (eşit sıra kalmaz).
// Yalnızca sırası değişen masalar döner: [{ id, sort_order }].
export function moveTable(tables, id, direction) {
  const list = [...tables].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'tr', { numeric: true }))
  const index = list.findIndex(table => table.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= list.length) return []
  ;[list[index], list[target]] = [list[target], list[index]]
  return list.map((table, order) => ({ id: table.id, sort_order: order, before: table.sort_order }))
    .filter(row => row.sort_order !== row.before).map(({ id: rowId, sort_order }) => ({ id: rowId, sort_order }))
}

export const cleanTableLabel = text => String(text ?? '').replace(/\s+/g, ' ').trim()

// Personel hesabı (staff-account Edge Function) hata kodları.
const STAFF_ACCOUNT_MESSAGES = {
  invalid_email: 'Geçerli bir e-posta adresi girin.',
  invalid_name: 'Ad 1–60 karakter olmalı.',
  invalid_role: 'Bir rol seçin.',
  weak_password: 'Şifre en az 8 karakter olmalı.',
  already_staff: 'Bu e-posta zaten personel listesinde.',
  email_exists: 'Bu e-posta ile kayıtlı bir hesap var ama bulunamadı; tekrar deneyin.',
  forbidden: 'Bu işlem için yönetici yetkisi gerekli.',
  unauthorized: 'Oturumunuz kapanmış; yeniden giriş yapın.',
  not_staff: 'Bu kişi personel listesinde değil.',
  unreachable: 'Hesap servisine ulaşılamadı. Bağlantınızı kontrol edin.',
}
export const staffAccountMessage = code => STAFF_ACCOUNT_MESSAGES[code] ?? 'Hesap işlemi tamamlanamadı, tekrar deneyin.'

// Döner: { ok: true, data } veya { ok: false, code }
export async function callStaffAccount(supabase, body) {
  try {
    const { data, error } = await supabase.functions.invoke('staff-account', { body })
    if (!error) return { ok: true, data }
    const payload = await Promise.resolve(error.context?.json?.()).catch(() => null)
    return { ok: false, code: payload?.error ?? (error.context?.status ? 'failed' : 'unreachable') }
  } catch {
    return { ok: false, code: 'unreachable' }
  }
}
