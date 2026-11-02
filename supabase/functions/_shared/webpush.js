// Bağımlılıksız Web Push: RFC 8291 (aes128gcm yük şifreleme) + RFC 8292 (VAPID).
// Yalnızca WebCrypto kullanır; aynı dosya Supabase Edge (Deno) ve Node testlerinde çalışır.
// Özel VAPID anahtarı yalnızca sunucu ortam değişkeninden gelir; tarayıcı paketine girmez.

const enc = new TextEncoder()
const subtle = () => globalThis.crypto.subtle

export function b64urlEncode(bytes) {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('invalid_base64url')
  const pad = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')
  return Uint8Array.from(atob(pad), c => c.charCodeAt(0))
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}

async function hmac(key, data) {
  const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await subtle().sign('HMAC', k, data))
}

// Push servisleri: yalnızca bilinen sağlayıcılara istek atılır (SSRF koruması). Veritabanı da aynı listeyi uygular.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/]

export function isAllowedPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && endpoint.length <= 1024 &&
      PUSH_HOSTS.some(re => re.test(url.hostname))
  } catch {
    return false
  }
}

// VAPID anahtarları: genel anahtar 65 bayt sıkıştırılmamış P-256 noktası, özel anahtar 32 bayt "d" (base64url).
export async function importVapidKeys(publicKey, privateKey) {
  const pub = b64urlDecode(publicKey)
  const d = b64urlDecode(privateKey)
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error('invalid_vapid_keys')
  const jwk = { kty: 'EC', crv: 'P-256', d: b64urlEncode(d), x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)), ext: false }
  const key = await subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  return { publicKey, key }
}

export async function vapidAuthorization(endpoint, vapid, subject, now = Date.now()) {
  if (!/^(mailto:|https:\/\/)/.test(subject)) throw new Error('invalid_vapid_subject')
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }
  const body = b64urlEncode(enc.encode(JSON.stringify(claims)))
  const signature = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.key, enc.encode(`${header}.${body}`))
  return `vapid t=${header}.${body}.${b64urlEncode(signature)}, k=${vapid.publicKey}`
}

// RFC 8291: tek kayıtlı aes128gcm gövdesi. salt/ephemeral yalnızca testte sabitlenir.
export async function encryptPayload(plaintext, p256dh, authSecret, { salt, ephemeral } = {}) {
  const uaPublic = b64urlDecode(p256dh)
  const auth = b64urlDecode(authSecret)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || auth.length !== 16) throw new Error('invalid_subscription_keys')
  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext
  if (data.length > 3000) throw new Error('payload_too_large')

  const pair = ephemeral ?? await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublic = new Uint8Array(await subtle().exportKey('raw', pair.publicKey))
  const uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256))

  const prkKey = await hmac(auth, shared)
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])))
  const saltBytes = salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16))
  const prk = await hmac(saltBytes, ikm)
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12)

  const aes = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(data, new Uint8Array([2]))))
  const rs = new Uint8Array([0, 0, 0x10, 0]) // 4096
  return concat(saltBytes, rs, new Uint8Array([asPublic.length]), asPublic, cipher)
}

// Sonuç sınıflandırması: kalıcı olarak geçersiz abonelik silinir, geçici hatalar yeniden denenir.
export function classifyPushResponse(status) {
  if (status >= 200 && status < 300) return 'sent'
  if (status === 404 || status === 410) return 'gone'
  if (status === 429 || status >= 500) return 'retry'
  return 'failed'
}

// Topic: aynı sipariş için teslim edilmemiş eski mesajın yerine yenisi geçer (RFC 8030, en fazla 32 karakter).
// UUID'nin tireleri atılır: 32 onaltılık karakter tam sığar, kesilip başka siparişle çakışmaz.
export const pushTopic = key => String(key).replace(/[^A-Za-z0-9_]/g, '').slice(0, 32)

export async function sendWebPush({ subscription, payload, vapid, subject, ttl = 600, topic, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!isAllowedPushEndpoint(subscription.endpoint)) return { outcome: 'gone', status: 0, error: 'endpoint_not_allowed' }
  let body
  try {
    body = await encryptPayload(JSON.stringify(payload), subscription.p256dh, subscription.auth)
  } catch (error) {
    return { outcome: error.message === 'invalid_subscription_keys' ? 'gone' : 'failed', status: 0, error: error.message }
  }
  const headers = {
    Authorization: await vapidAuthorization(subscription.endpoint, vapid, subject),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: 'high',
  }
  if (topic) headers.Topic = pushTopic(topic)
  try {
    const response = await fetchImpl(subscription.endpoint, {
      method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
    })
    return { outcome: classifyPushResponse(response.status), status: response.status, error: response.ok ? null : `http_${response.status}` }
  } catch (error) {
    return { outcome: 'retry', status: 0, error: String(error?.name || 'network_error').slice(0, 100) }
  }
}
