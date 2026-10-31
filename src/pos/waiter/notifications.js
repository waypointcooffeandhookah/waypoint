// Garson "sipariş hazır" bildirimlerinin saf mantığı. Kaynak ayrı bir tablo değil, kalıcı durum
// geçmişidir (order_status_history, RLS: yalnızca personel). Bildirim kimliği geçmiş satırıdır:
// aynı olay iki kez bildirilmez, kopukken olanlar yeniden okumada bulunur.
export const HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000
export const HISTORY_LIMIT = 50
const SEEN_LIMIT = 200
const STORAGE_PREFIX = 'waypoint-waiter-notifications-v1:'
export const SOUND_PREF_KEY = 'waypoint-waiter-sound'

export const READY_NOTIFICATION_SELECT = 'id, order_id, changed_at, orders!inner(order_number, status, source, table_id, restaurant_tables(label), order_items(position, item_name, quantity))'

export function mapNotificationRow(row) {
  const order = row.orders
  return {
    id: String(row.id),
    orderId: row.order_id,
    orderNumber: order.order_number,
    status: order.status,
    source: order.source,
    tableId: order.table_id,
    tableLabel: order.restaurant_tables?.label ?? '',
    at: Date.parse(row.changed_at),
    items: [...(order.order_items ?? [])].sort((a, b) => a.position - b.position).map(item => ({ name: item.item_name, quantity: item.quantity })),
  }
}

// İlk açılışta eski kayıtlar için uyarı verilmez; daha önce görülen olay bir daha uyarmaz.
// Kopukken hazır olup hâlâ bekleyen sipariş yeni sayılır, servis edilmişse yalnızca geçmişte kalır.
export function reconcileNotifications(state, rows) {
  const seen = new Set(state.seen)
  const fresh = state.initialized ? rows.filter(row => !seen.has(row.id) && row.status === 'ready') : []
  const known = new Set(rows.map(row => row.id))
  const older = state.seen.filter(id => !known.has(id))
  return { fresh, state: { ...state, initialized: true, seen: [...known, ...older].slice(0, SEEN_LIMIT) } }
}

// Yalnızca hâlâ teslim alınmayı bekleyen okunmamışlar sayılır: başka cihazda servis edilince düşer.
export const unreadCount = (rows, read) => rows.filter(row => row.status === 'ready' && !read.includes(row.id)).length

const emptyState = () => ({ initialized: false, seen: [], read: [] })
export const notificationStorageKey = (mode, staffId) => `${STORAGE_PREFIX}${mode}:${staffId}`

export function loadNotificationState(key, storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(key))
    return saved && Array.isArray(saved.seen) && Array.isArray(saved.read) ? { ...emptyState(), ...saved } : emptyState()
  } catch {
    return emptyState()
  }
}

export function saveNotificationState(key, state, storage = globalThis.localStorage) {
  try {
    storage.setItem(key, JSON.stringify({ ...state, read: state.read.slice(0, SEEN_LIMIT) }))
  } catch { /* Depolama kapalı olabilir; bildirimler bellekte sürer. */ }
}

export const notificationTitle = item => `${item.tableLabel} — Siparişiniz Hazır!`
export const notificationLines = item => item.items.map(line => `${line.quantity} × ${line.name}`)

// Tarayıcı bildirimi yalnızca HTTPS/localhost'ta ve izinle çalışır.
export function browserNotificationStatus(win = globalThis.window) {
  if (!win?.isSecureContext) return 'insecure'
  if (!win.Notification) return 'unsupported'
  return win.Notification.permission
}

// Android Chrome kurucuyu reddeder (service worker ister); uygulama içi bildirim yine çalışır.
export function showBrowserNotification(item, win = globalThis.window) {
  if (browserNotificationStatus(win) !== 'granted' || !win.document?.hidden) return false
  try {
    const shown = new win.Notification(notificationTitle(item), { body: notificationLines(item).join('\n'), tag: `waypoint-ready-${item.id}` })
    shown.onclick = () => { win.focus(); shown.close() }
    return true
  } catch {
    return false
  }
}
