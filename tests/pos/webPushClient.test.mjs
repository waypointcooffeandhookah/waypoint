// Tarayıcı tarafı Web Push: izin akışı, iPhone Ana Ekran şartı, abonelik eşitleme ve service worker.
// Gerçek cihaz testinin yerini TUTMAZ; tarayıcı API'leri burada sahte nesnelerle taklit edilir.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { disablePush, enablePush, pushCapability, syncPush, urlBase64ToUint8Array } from '../../src/pos/waiter/webPush.js'

const KEY = Buffer.from(Uint8Array.from({ length: 65 }, (_, i) => (i ? i : 4))).toString('base64url')
const OTHER_KEY = Buffer.from(Uint8Array.from({ length: 65 }, (_, i) => (i ? 255 - i : 4))).toString('base64url')
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
}

function fakeWindow({ ua = UA.android, standalone = false, secure = true, permission = 'default', grant = 'granted', existingKey = null, push = true, ipadDesktop = false } = {}) {
  const log = []
  let subscription = existingKey ? makeSub(existingKey) : null
  function makeSub(key) {
    return {
      endpoint: `https://fcm.googleapis.com/fcm/send/${key.slice(0, 8)}`,
      options: { applicationServerKey: urlBase64ToUint8Array(key).buffer },
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } } },
      async unsubscribe() { log.push('unsubscribe'); subscription = null; return true },
    }
  }
  const registration = {
    pushManager: {
      async getSubscription() { return subscription },
      async subscribe(opts) {
        log.push(`subscribe:${opts.userVisibleOnly}`)
        subscription = makeSub(Buffer.from(opts.applicationServerKey).toString('base64url'))
        return subscription
      },
    },
  }
  let registered = Boolean(existingKey)
  const win = {
    isSecureContext: secure,
    navigator: {
      userAgent: ipadDesktop ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15' : ua,
      platform: ipadDesktop ? 'MacIntel' : 'x',
      maxTouchPoints: ipadDesktop ? 5 : 0,
      standalone,
      serviceWorker: push ? {
        async register(url, opts) { log.push(`register:${url}:${opts.scope}`); registered = true; return registration },
        ready: Promise.resolve(registration),
        async getRegistration() { return registered ? registration : undefined },
      } : undefined,
    },
    matchMedia: () => ({ matches: standalone }),
    PushManager: push ? function PushManager() {} : undefined,
    Notification: {
      permission,
      async requestPermission() { log.push('requestPermission'); this.permission = grant; return grant },
    },
  }
  const backend = {
    calls: [],
    async registerPushSubscription(sub) { log.push('server:register'); this.calls.push(['register', sub]) },
    async unregisterPushSubscription(endpoint) { log.push('server:unregister'); this.calls.push(['unregister', endpoint]) },
  }
  return { win, backend, log, current: () => subscription }
}

test('yetenek: yapılandırma, HTTPS, iPhone Safari sekmesi ve Ana Ekran uygulaması ayrımı', () => {
  assert.equal(pushCapability('', fakeWindow().win), 'unconfigured')
  assert.equal(pushCapability(KEY, fakeWindow({ secure: false }).win), 'insecure')
  assert.equal(pushCapability(KEY, fakeWindow({ ua: UA.iphone }).win), 'ios-install')
  assert.equal(pushCapability(KEY, fakeWindow({ ipadDesktop: true }).win), 'ios-install', 'masaüstü kimlikli iPad de Ana Ekran ister')
  assert.equal(pushCapability(KEY, fakeWindow({ ua: UA.iphone, standalone: true }).win), 'default')
  assert.equal(pushCapability(KEY, fakeWindow({ ua: UA.iphone, standalone: true, push: false }).win), 'unsupported', 'iOS < 16.4')
  assert.equal(pushCapability(KEY, fakeWindow({ permission: 'denied' }).win), 'denied')
  assert.equal(pushCapability(KEY, fakeWindow({ permission: 'granted' }).win), 'granted')
})

test('açma: izin her şeyden önce istenir; reddedilirse SW kaydı ve sunucu çağrısı yapılmaz', async () => {
  const denied = fakeWindow({ grant: 'denied' })
  assert.deepEqual(await enablePush({ backend: denied.backend, publicKey: KEY, win: denied.win }), { state: 'denied' })
  assert.deepEqual(denied.log, ['requestPermission'])

  const ok = fakeWindow()
  const result = await enablePush({ backend: ok.backend, publicKey: KEY, win: ok.win })
  assert.equal(result.state, 'active')
  assert.deepEqual(ok.log, ['requestPermission', 'register:/sw.js:/', 'subscribe:true', 'server:register'])
  const [, sent] = ok.backend.calls[0]
  assert.deepEqual(Object.keys(sent).sort(), ['auth', 'endpoint', 'p256dh', 'userAgent'])
  assert.ok(sent.endpoint.startsWith('https://fcm.googleapis.com/'))
})

test('açma: sunucu anahtarı değiştiyse eski abonelik bırakılıp yenisi alınır', async () => {
  const env = fakeWindow({ permission: 'granted', existingKey: OTHER_KEY })
  await enablePush({ backend: env.backend, publicKey: KEY, win: env.win })
  assert.deepEqual(env.log.filter(x => !x.startsWith('register:')), ['requestPermission', 'unsubscribe', 'subscribe:true', 'server:register'])
})

test('eşitleme: abonelik yoksa kendiliğinden oluşturmaz; varsa sunucuya tazeler; izin yoksa hiçbir şey yapmaz', async () => {
  const none = fakeWindow({ permission: 'granted' })
  assert.equal(await syncPush({ backend: none.backend, publicKey: KEY, win: none.win }), null)
  assert.deepEqual(none.log, [])

  const has = fakeWindow({ permission: 'granted', existingKey: KEY })
  assert.ok(await syncPush({ backend: has.backend, publicKey: KEY, win: has.win }))
  assert.deepEqual(has.log, ['server:register'])

  const revoked = fakeWindow({ permission: 'denied', existingKey: KEY })
  assert.equal(await syncPush({ backend: revoked.backend, publicKey: KEY, win: revoked.win }), null)
  assert.deepEqual(revoked.log, [])
})

test('kapatma/çıkış: önce sunucu kaydı silinir, sonra cihaz aboneliği; sunucu hatası cihazı açık bırakmaz', async () => {
  const env = fakeWindow({ permission: 'granted', existingKey: KEY })
  assert.equal(await disablePush({ backend: env.backend, win: env.win }), true)
  assert.deepEqual(env.log, ['server:unregister', 'unsubscribe'])

  const failing = fakeWindow({ permission: 'granted', existingKey: KEY })
  failing.backend.unregisterPushSubscription = async () => { throw new Error('offline') }
  assert.equal(await disablePush({ backend: failing.backend, win: failing.win }), true)
  assert.equal(failing.current(), null)

  const hanging = fakeWindow({ permission: 'granted', existingKey: KEY })
  hanging.backend.unregisterPushSubscription = () => new Promise(() => {})
  assert.equal(await disablePush({ backend: hanging.backend, win: hanging.win, timeoutMs: 20 }), true, 'askıda kalan istek çıkışı kilitlemez')

  const nothing = fakeWindow({ push: false })
  assert.equal(await disablePush({ backend: nothing.backend, win: nothing.win }), false)
})

// ── Service worker ──────────────────────────────────────────────
function loadServiceWorker(scope = 'https://staging.example.pages.dev/') {
  const listeners = {}
  const shown = []
  const opened = []
  const clients = []
  const self = {
    registration: { scope, showNotification: async (title, options) => shown.push({ title, options }) },
    clients: {
      matchAll: async () => clients,
      openWindow: async url => opened.push(url),
      claim: async () => {},
    },
    addEventListener: (type, fn) => { listeners[type] = fn },
    skipWaiting: () => {},
  }
  vm.runInNewContext(readFileSync(new URL('../../src/pwa/sw.js', import.meta.url), 'utf8'), { self, URL, Date })
  const fire = async (type, event) => {
    let pending
    listeners[type]({ ...event, waitUntil: p => { pending = p } })
    await pending
  }
  return { fire, shown, opened, clients, listeners }
}

const pushEvent = data => ({ data: { json: () => (typeof data === 'string' ? JSON.parse(data) : data) } })

test('service worker: push her zaman görünür bildirim gösterir; tag korunur; açık sekmeye haber verilir', async () => {
  const sw = loadServiceWorker()
  const messages = []
  // vm bağlamındaki nesnelerin prototipi farklıdır; düz nesneye çevrilerek karşılaştırılır.
  sw.clients.push({ url: 'https://staging.example.pages.dev/garson', postMessage: m => messages.push(JSON.parse(JSON.stringify(m))) })
  await sw.fire('push', pushEvent({ title: 'Masa 5 — Siparişiniz Hazır!', body: '2 × Köfte', tag: 'waypoint-ready-42', url: 'garson/masa/t5', at: '2026-11-03T10:00:00Z' }))
  assert.equal(sw.shown[0].title, 'Masa 5 — Siparişiniz Hazır!')
  assert.equal(sw.shown[0].options.tag, 'waypoint-ready-42')
  assert.equal(sw.shown[0].options.data.url, 'https://staging.example.pages.dev/garson/masa/t5')
  assert.deepEqual(messages, [{ type: 'waypoint-push', tag: 'waypoint-ready-42' }])
  assert.ok(!('fetch' in sw.listeners), 'önbellek/fetch işleyicisi yok')
})

test('service worker: bozuk yük yine bildirim gösterir; dış adrese yönlendirme kapsam içine çekilir', async () => {
  const sw = loadServiceWorker()
  await sw.fire('push', { data: { json: () => { throw new Error('bad') } } })
  assert.equal(sw.shown[0].title, 'Waypoint — Yeni bildirim')
  await sw.fire('push', pushEvent({ title: 'x', url: 'https://evil.example/phish' }))
  assert.equal(sw.shown[1].options.data.url, 'https://staging.example.pages.dev/garson')
  await sw.fire('push', pushEvent({ title: 'y', url: '//evil.example/x' }))
  assert.equal(sw.shown[2].options.data.url, 'https://staging.example.pages.dev/garson')
})

test('service worker: bildirime dokunma açık uygulamayı masaya götürür, yoksa yeni pencere açar', async () => {
  const sw = loadServiceWorker()
  const notification = { data: { url: 'https://staging.example.pages.dev/garson/masa/t5' }, close() { this.closed = true } }
  await sw.fire('notificationclick', { notification })
  assert.deepEqual(sw.opened, ['https://staging.example.pages.dev/garson/masa/t5'])
  assert.ok(notification.closed)

  const navigated = []
  sw.clients.push({ url: 'https://staging.example.pages.dev/garson', focus: async () => {}, navigate: async url => navigated.push(url) })
  await sw.fire('notificationclick', { notification })
  assert.deepEqual(navigated, ['https://staging.example.pages.dev/garson/masa/t5'])
  assert.equal(sw.opened.length, 1)
})
