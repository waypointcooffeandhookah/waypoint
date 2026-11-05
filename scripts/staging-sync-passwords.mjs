// YALNIZCA STAGING: .staging-credentials.local içindeki garson ve mutfak şifrelerini Supabase hesaplarına yazar.
// Kullanım (terminalde, token ortamda tanımlıyken):  node scripts/staging-sync-passwords.mjs
// Şifreler ekrana yazılmaz. service_role anahtarı Management API'den bellekte alınır, hiçbir yere kaydedilmez.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const REF = 'jnnjijmdzcjglclcnwtm'
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) { console.error('SUPABASE_ACCESS_TOKEN tanımlı değil'); process.exit(2) }
const creds = JSON.parse(readFileSync(new URL('../.staging-credentials.local', import.meta.url), 'utf8'))
const anonKey = readFileSync(new URL('../.env.staging.local', import.meta.url), 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()

const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } })
const serviceKey = (await response.json()).find?.(key => key.name === 'service_role')?.api_key
if (!serviceKey) { console.error('service_role anahtarı alınamadı'); process.exit(1) }
const admin = createClient(`https://${REF}.supabase.co`, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: list, error: listError } = await admin.auth.admin.listUsers()
console.log(`Supabase'de ${list?.users?.length ?? 0} hesap görüldü`)
if (listError) throw listError

for (const role of ['waiter', 'kitchen']) {
  const user = list.users.find(item => item.email === creds[role]?.email)
  if (!user) { console.log(`${role}: hesap bulunamadı`); continue }
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: creds[role].password })
  console.log(`${role} (${user.email}): ${error ? `✖ ${error.message}` : '✔ şifre güncellendi'}`)
  const db = createClient(`https://${REF}.supabase.co`, anonKey, { auth: { persistSession: false } })
  const login = await db.auth.signInWithPassword(creds[role])
  console.log(`   giriş denemesi: ${login.error ? `✖ ${login.error.message}` : '✔ çalışıyor'}`)
  if (!login.error) await db.auth.signOut()
}
