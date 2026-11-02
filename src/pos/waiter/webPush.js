// Garson cihazı için arka plan Web Push aboneliği. Gönderim sunucudadır (push-dispatch);
// burası yalnızca izin, service worker kaydı ve aboneliğin sunucuya bildirilmesidir.
// Yalnızca staging derlemesinde service worker üretilir ve VITE_WEB_PUSH_PUBLIC_KEY tanımlıdır.
export const PUSH_SCOPE = import.meta.env?.BASE_URL ?? '/'
export const PUSH_SW_URL = `${PUSH_SCOPE}sw.js`

export function urlBase64ToUint8Array(text) {
  const base64 = (text + '='.repeat((4 - (text.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0))
}

export function isIos(win = globalThis.window) {
  const nav = win?.navigator ?? {}
  return /iPad|iPhone|iPod/.test(nav.userAgent ?? '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
}

export function isStandalone(win = globalThis.window) {
  return win?.navigator?.standalone === true || Boolean(win?.matchMedia?.('(display-mode: standalone)').matches)
}

// Durumlar: unconfigured | insecure | ios-install | unsupported | denied | default | granted
export function pushCapability(publicKey, win = globalThis.window) {
  if (!publicKey) return 'unconfigured'
  if (!win?.isSecureContext) return 'insecure'
  // iPhone/iPad: Web Push yalnızca Ana Ekran'a eklenmiş uygulamada (iOS/iPadOS 16.4+) vardır.
  if (isIos(win) && !isStandalone(win)) return 'ios-install'
  if (!win.navigator?.serviceWorker || !win.PushManager || !win.Notification) return 'unsupported'
  return win.Notification.permission
}

export function subscriptionKeys(subscription, userAgent = '') {
  const json = subscription.toJSON()
  return { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, userAgent: String(userAgent).slice(0, 200) }
}

function sameKey(current, expected) {
  if (!current) return false
  const bytes = new Uint8Array(current)
  return bytes.length === expected.length && bytes.every((b, i) => b === expected[i])
}

async function ensureSubscription(registration, publicKey) {
  const key = urlBase64ToUint8Array(publicKey)
  let subscription = await registration.pushManager.getSubscription()
  // Sunucu anahtarı değiştiyse eski abonelik çalışmaz: yenisi alınır.
  if (subscription && !sameKey(subscription.options?.applicationServerKey, key)) {
    await subscription.unsubscribe()
    subscription = null
  }
  return subscription ?? registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

// Kullanıcı dokunuşuyla çağrılmalıdır: iOS izin isteğini ancak doğrudan dokunuşta gösterir,
// bu yüzden izin isteği her şeyden önce yapılır.
export async function enablePush({ backend, publicKey, win = globalThis.window }) {
  const permission = await win.Notification.requestPermission()
  if (permission !== 'granted') return { state: permission }
  const registration = await win.navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SCOPE })
  await win.navigator.serviceWorker.ready
  const subscription = await ensureSubscription(registration, publicKey)
  await backend.registerPushSubscription(subscriptionKeys(subscription, win.navigator.userAgent))
  return { state: 'active', endpoint: subscription.endpoint }
}

// Açılışta: bu cihazda abonelik varsa sunucudaki kaydı tazeler (ve oturumdaki kişiye bağlar).
// Abonelik yoksa kendiliğinden oluşturmaz; açma her zaman kişinin dokunuşuyla olur.
export async function syncPush({ backend, publicKey, win = globalThis.window }) {
  if (pushCapability(publicKey, win) !== 'granted') return null
  const registration = await win.navigator.serviceWorker.getRegistration(PUSH_SCOPE)
  const existing = await registration?.pushManager.getSubscription()
  if (!existing) return null
  const subscription = await ensureSubscription(registration, publicKey)
  await backend.registerPushSubscription(subscriptionKeys(subscription, win.navigator.userAgent))
  return subscription.endpoint
}

// Kapatma ve çıkış: önce sunucu kaydı silinir (oturum hâlâ açıkken), sonra tarayıcı aboneliği.
// Böylece paylaşılan cihazda önceki garsona bildirim gitmez.
export async function disablePush({ backend, win = globalThis.window, timeoutMs = 4000 }) {
  const registration = await win?.navigator?.serviceWorker?.getRegistration?.(PUSH_SCOPE)
  const subscription = await registration?.pushManager?.getSubscription()
  if (!subscription) return false
  const timeout = new Promise(resolve => setTimeout(resolve, timeoutMs))
  try {
    await Promise.race([backend?.unregisterPushSubscription?.(subscription.endpoint), timeout])
  } catch { /* Sunucuya ulaşılamazsa bile cihaz aboneliği kaldırılır; sunucu 410 alınca kaydı siler. */ }
  await subscription.unsubscribe()
  return true
}
