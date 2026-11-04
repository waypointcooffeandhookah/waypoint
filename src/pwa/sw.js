/* Waypoint garson service worker — yalnızca staging derlemesine eklenir (vite.config.js: stagingPwa).
 * Önbellek ve fetch işleyicisi YOKTUR: uygulama dosyaları her zaman ağdan gelir, eski sürüm takılı kalmaz.
 * Görevleri: sunucudan gelen push'u bildirim olarak göstermek ve tıklanınca ilgili masayı açmak. */
const SCOPE = self.registration.scope
const FALLBACK_URL = new URL('garson', SCOPE).href

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')

// Yalnızca kendi kapsamındaki adreslere yönlendirilir; yükteki adres dış siteye götüremez.
function safeUrl(value) {
  try {
    const url = new URL(text(value, 300) || 'garson', SCOPE)
    return url.href.startsWith(SCOPE) ? url.href : FALLBACK_URL
  } catch {
    return FALLBACK_URL
  }
}

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  const title = text(data.title, 120) || 'Waypoint — Yeni bildirim'
  // iOS/Safari ve Chrome her push için görünür bildirim ister; aksi halde abonelik iptal edilebilir.
  // Aynı "tag" ikinci kez gelirse (ör. açık sekmedeki uygulama içi bildirimle aynı olay) yenisi eskisinin yerine geçer.
  const options = {
    body: text(data.body, 900),
    tag: text(data.tag, 80) || 'waypoint',
    icon: new URL('icon-192.png', SCOPE).href,
    badge: new URL('icon-192.png', SCOPE).href,
    timestamp: Date.parse(data.at) || Date.now(),
    data: { url: safeUrl(data.url) },
  }
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options)
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    clients.forEach(client => client.postMessage({ type: 'waypoint-push', tag: options.tag }))
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = safeUrl(event.notification.data?.url)
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = clients.find(client => client.url.startsWith(SCOPE))
    if (existing) {
      await existing.focus()
      if ('navigate' in existing) {
        try { await existing.navigate(target); return } catch { /* Kontrol edilmeyen pencere; yeni pencere açılır. */ }
      } else return
    }
    await self.clients.openWindow(target)
  })())
})

// Tarayıcı aboneliği kendiliğinden yenilerse açık uygulama yeniden eşitler (syncPush).
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(clients => clients.forEach(client => client.postMessage({ type: 'waypoint-push-resync' }))))
})
