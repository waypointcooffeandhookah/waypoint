// Staging Web Push anahtarlarını üretir. Özel anahtar ve dağıtım sırrı yalnızca git dışı
// `.staging-push-secrets.local` dosyasına yazılır (gitignore: *.local; Vite fs.deny: .staging-*).
// Ekrana yalnızca tarayıcıya konabilecek GENEL anahtar basılır.
import { webcrypto as crypto } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'

const FILE = new URL('../.staging-push-secrets.local', import.meta.url)
if (existsSync(FILE)) {
  console.error('.staging-push-secrets.local zaten var. Anahtarları değiştirmek tüm cihaz aboneliklerini geçersiz kılar; önce dosyayı bilinçli olarak silin.')
  process.exit(1)
}

const b64url = bytes => Buffer.from(bytes).toString('base64url')
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey))
const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d
const dispatchSecret = b64url(crypto.getRandomValues(new Uint8Array(32)))

writeFileSync(FILE, [
  '# GİZLİ — commit etmeyin, paylaşmayın. Yalnızca `supabase secrets set` ve Vault için.',
  `VAPID_PUBLIC_KEY=${publicKey}`,
  `VAPID_PRIVATE_KEY=${privateKey}`,
  `PUSH_DISPATCH_SECRET=${dispatchSecret}`,
  '',
].join('\n'), { mode: 0o600 })

console.log('Yazıldı: .staging-push-secrets.local (gizli)')
console.log(`Netlify ortam değişkeni / .env.staging.local için GENEL anahtar:\nVITE_WEB_PUSH_PUBLIC_KEY=${publicKey}`)
