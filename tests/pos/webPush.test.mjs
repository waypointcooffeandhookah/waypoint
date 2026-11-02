// Sunucu tarafı Web Push şifrelemesi ve VAPID imzası. Tarayıcı tarafı şifre çözme burada
// bağımsız olarak (RFC 8291 alıcı adımları) yazılmıştır; gönderici çıktısını doğrular.
import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto as crypto } from 'node:crypto'
import {
  b64urlDecode, b64urlEncode, classifyPushResponse, encryptPayload, importVapidKeys, isAllowedPushEndpoint,
  pushTopic, sendWebPush, vapidAuthorization,
} from '../../supabase/functions/_shared/webpush.js'

const enc = new TextEncoder()
const hmac = async (key, data) => new Uint8Array(await crypto.subtle.sign('HMAC',
  await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data))
const cat = (...p) => Uint8Array.from(p.flatMap(x => [...x]))

async function browserSubscription() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { pair, pub, auth, keys: { p256dh: b64urlEncode(pub), auth: b64urlEncode(auth) } }
}

// Alıcı (tarayıcı) tarafı: RFC 8291 §3.4 ve RFC 8188.
async function decrypt(body, sub) {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const cipher = body.slice(21 + idlen)
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, sub.pair.privateKey, 256))
  const ikm = await hmac(await hmac(sub.auth, shared), cat(enc.encode('WebPush: info\0'), sub.pub, asPublic, [1]))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16)
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher))
  assert.equal(plain.at(-1), 2, 'son kayıt ayracı')
  return { rs, idlen, text: new TextDecoder().decode(plain.slice(0, -1)) }
}

async function vapidPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d, verifyKey: pair.publicKey }
}

test('şifreleme: tarayıcı yükü çözebilir (aes128gcm, rs=4096, 65 baytlık geçici anahtar)', async () => {
  const sub = await browserSubscription()
  const message = JSON.stringify({ title: 'Masa 5 — Siparişiniz Hazır!', body: '2 × Köfte\n1 × Çay' })
  const body = await encryptPayload(message, sub.keys.p256dh, sub.keys.auth)
  const out = await decrypt(body, sub)
  assert.deepEqual([out.rs, out.idlen, out.text], [4096, 65, message])
  // Her gönderim farklı tuz ve geçici anahtar kullanır.
  const again = await encryptPayload(message, sub.keys.p256dh, sub.keys.auth)
  assert.notDeepEqual(body.slice(0, 86), again.slice(0, 86))
})

test('şifreleme: başka cihazın anahtarıyla çözülemez; bozuk anahtar ve büyük yük reddedilir', async () => {
  const sub = await browserSubscription()
  const other = await browserSubscription()
  const body = await encryptPayload('gizli', sub.keys.p256dh, sub.keys.auth)
  await assert.rejects(decrypt(body, other))
  await assert.rejects(encryptPayload('x', 'AAAA', sub.keys.auth), /invalid_subscription_keys/)
  await assert.rejects(encryptPayload('x', sub.keys.p256dh, b64urlEncode(new Uint8Array(8))), /invalid_subscription_keys/)
  await assert.rejects(encryptPayload('x'.repeat(3001), sub.keys.p256dh, sub.keys.auth), /payload_too_large/)
})

test('VAPID: ES256 imzası genel anahtarla doğrulanır; aud uç noktanın kökenidir; sub zorunlu', async () => {
  const keys = await vapidPair()
  const vapid = await importVapidKeys(keys.publicKey, keys.privateKey)
  const header = await vapidAuthorization('https://web.push.apple.com/QGx/abc', vapid, 'mailto:ops@example.com', 1_800_000_000_000)
  const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)
  assert.equal(k, keys.publicKey)
  const [h, p, s] = token.split('.')
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p)))
  assert.deepEqual(claims, { aud: 'https://web.push.apple.com', exp: 1_800_000_000 + 43200, sub: 'mailto:ops@example.com' })
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.verifyKey, b64urlDecode(s), enc.encode(`${h}.${p}`)))
  await assert.rejects(vapidAuthorization('https://fcm.googleapis.com/x', vapid, 'ops@example.com'), /invalid_vapid_subject/)
  await assert.rejects(importVapidKeys(keys.publicKey, 'kisa'), /invalid_vapid_keys/)
})

test('uç nokta listesi ve yanıt sınıflandırması', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QGx', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-db5p.notify.windows.com/w/?token=x']) assert.ok(isAllowedPushEndpoint(ok), ok)
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://fcm.googleapis.com:444/x', 'https://a@fcm.googleapis.com/x', 'https://169.254.169.254/', 'nonsense']) assert.ok(!isAllowedPushEndpoint(bad), bad)
  assert.deepEqual([201, 404, 410, 429, 500, 503, 400, 403, 413].map(classifyPushResponse), ['sent', 'gone', 'gone', 'retry', 'retry', 'retry', 'failed', 'failed', 'failed'])
  assert.equal(pushTopic('6f1c2d3e-aaaa-bbbb-cccc-1234567890ab'), '6f1c2d3eaaaabbbbcccc1234567890ab')
})

test('gönderim: doğru başlıklar, yönlendirme izlenmez; izinsiz uç noktaya istek atılmaz; ağ hatası yeniden denenir', async () => {
  const keys = await vapidPair()
  const vapid = await importVapidKeys(keys.publicKey, keys.privateKey)
  const sub = await browserSubscription()
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 201, ok: true } }
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...sub.keys }
  const payload = { title: 'Masa 1 — Siparişiniz Hazır!', tag: 'waypoint-ready-7' }

  const result = await sendWebPush({ subscription, payload, vapid, subject: 'mailto:ops@example.com', topic: 'abc-def', fetchImpl })
  assert.deepEqual(result, { outcome: 'sent', status: 201, error: null })
  const { init } = calls[0]
  assert.equal(init.redirect, 'manual')
  assert.equal(init.headers['Content-Encoding'], 'aes128gcm')
  assert.equal(init.headers.TTL, '600')
  assert.equal(init.headers.Urgency, 'high')
  assert.equal(init.headers.Topic, 'abcdef')
  assert.match(init.headers.Authorization, /^vapid t=.+, k=/)
  assert.deepEqual(JSON.parse((await decrypt(init.body, sub)).text), payload)

  const blocked = await sendWebPush({ subscription: { ...subscription, endpoint: 'https://evil.example/x' }, payload, vapid, subject: 'mailto:a@b.c', fetchImpl })
  assert.equal(blocked.outcome, 'gone')
  assert.equal(calls.length, 1)

  const gone = await sendWebPush({ subscription, payload, vapid, subject: 'mailto:a@b.c', fetchImpl: async () => ({ status: 410, ok: false }) })
  assert.equal(gone.outcome, 'gone')
  const offline = await sendWebPush({ subscription, payload, vapid, subject: 'mailto:a@b.c', fetchImpl: async () => { throw new TypeError('fetch failed') } })
  assert.equal(offline.outcome, 'retry')
})
