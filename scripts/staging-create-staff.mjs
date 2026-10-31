// Staging personel hesaplarını Supabase Authentication Admin API ile oluşturur (auth.users'a SQL yazılmaz).
// Çalıştırma: npm run staging:staff → yönetici anahtarı gizli olarak sorulur, başka yoldan kabul edilmez.
// Anahtar hiçbir yere yazılmaz. Üretilen şifreler ekrana basılmaz; yalnızca git dışı
// .staging-credentials.local dosyasına kaydedilir. Var olan hesaplar değiştirilmez.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { STAGING_URL, checkAdminKey, guardedFetch, provisionStaff } from './staging-staff.lib.mjs'

const root = new URL('../', import.meta.url)
const CREDENTIALS = new URL('.staging-credentials.local', root)
const TEMP = new URL('.staging-credentials.tmp.local', root)

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    let value = ''
    const finish = settle => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.off('data', onData)
      process.stdout.write('\n')
      settle()
    }
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\u0003') return finish(() => reject(new Error('İptal edildi.')))
        if (char === '\r' || char === '\n') return finish(() => resolve(value.replaceAll('\u001b[200~', '').replaceAll('\u001b[201~', '').trim()))
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else value += char
      }
    }
    process.stdout.write(label)
    process.stdin.setRawMode(true)
    process.stdin.setEncoding('utf8')
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

const readCredentials = () => existsSync(CREDENTIALS) ? JSON.parse(readFileSync(CREDENTIALS, 'utf8')) : {}

function saveCredentials(credentials) {
  writeFileSync(TEMP, JSON.stringify(credentials, null, 2), { mode: 0o600 })
  renameSync(TEMP, CREDENTIALS)
}

try {
  if (!process.stdin.isTTY) throw new Error('Anahtar girişi için etkileşimli terminal gerekir.')
  const credentials = readCredentials()
  // Hesap oluşturmadan önce: şifreler kaydedilemeyecekse hiç başlama.
  saveCredentials(credentials)
  console.log(`Hedef: ${STAGING_URL}`)
  const key = await promptHidden('Staging sb_secret_ anahtarı (yazarken görünmez): ')
  if (checkAdminKey(key) === 'legacy') console.log('Not: eski service_role anahtarı kullanılıyor; sb_secret_ tercih edilir.')
  const admin = createClient(STAGING_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: guardedFetch },
  })
  await provisionStaff(admin, credentials, saveCredentials, console.log)
  console.log('Tamamlandı. Şifreler .staging-credentials.local dosyasında (git dışı).')
  process.exit(0)
} catch (error) {
  console.error(`Hata: ${error instanceof SyntaxError ? '.staging-credentials.local okunamadı; dosyaya dokunulmadı.' : error.message}`)
  process.exit(1)
}
