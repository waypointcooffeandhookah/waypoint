// Staging veritabanının ücretsiz, YALNIZCA OKUYAN mantıksal yedeği:  npm run backup:staging [-- --hedef <klasör>]
//
// pg_dump/Docker/veritabanı şifresi gerektirmez: yönetici hesabıyla (RLS altında) tüm public tabloları sayfa sayfa
// JSON olarak indirir, menü görsellerini (Storage) indirir, satır sayılarını sunucudaki gerçek sayılarla karşılaştırır
// ve her dosyanın SHA-256 özetini manifest.json'a yazar. Şema depodaki SQL dosyalarından yeniden kurulur
// (sıra: GERI_YUKLEME.md). Varsayılan hedef deponun DIŞINDADIR (../waypoint-yedekler) ve GitHub'a gitmez.
// Yalnızca staging projesine bağlanır; üretim adresi reddedilir.
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { PRODUCTION_REF, STAGING_REF } from '../src/supabaseTarget.js'

const TABLES = ['categories', 'menu_items', 'menu_promotion', 'social_settings', 'restaurant_tables', 'table_qr_tokens', 'staff_profiles',
  'fulfillment_settings', 'delivery_zones', 'table_sessions', 'bills', 'orders', 'order_items', 'order_fulfillments',
  'order_status_history', 'payments', 'audit_log']
const ORDER_KEYS = ['id', 'order_id', 'user_id', 'table_id', 'created_at']
const PAGE = 1000

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const targetArg = args.includes('--hedef') ? args[args.indexOf('--hedef') + 1] : null
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const out = resolve(targetArg ?? join(repo, '..', 'waypoint-yedekler'), `staging-${stamp}`)
const inside = relative(repo, out)
if (!inside.startsWith('..') && !isAbsolute(inside)) { console.error('✖ Yedek deponun içine yazılamaz (GitHub\'a gitmemeli).'); process.exit(2) }

const env = Object.fromEntries(readFileSync(join(repo, '.env.staging.local'), 'utf8').split(/\r?\n/).filter(line => line.includes('='))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]))
if (!env.VITE_SUPABASE_URL?.includes(STAGING_REF) || env.VITE_SUPABASE_URL.includes(PRODUCTION_REF)) { console.error('✖ Hedef staging projesi değil; durduruldu.'); process.exit(2) }
const creds = JSON.parse(readFileSync(join(repo, '.staging-credentials.local'), 'utf8'))
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const signIn = await db.auth.signInWithPassword(creds.admin)
if (signIn.error) { console.error(`✖ Yönetici girişi: ${signIn.error.message}`); process.exit(1) }

mkdirSync(join(out, 'data'), { recursive: true })
mkdirSync(join(out, 'storage'), { recursive: true })
const files = {}
const save = (relative, content) => {
  writeFileSync(join(out, relative), content)
  files[relative] = createHash('sha256').update(content).digest('hex')
}
let problems = 0
const report = (ok, label) => { if (!ok) problems++; console.log(`${ok ? '✔' : '✖'} ${label}`) }

async function dumpTable(table) {
  const { count, error: countError } = await db.from(table).select('*', { count: 'exact', head: true })
  if (countError) throw new Error(`${table}: ${countError.message}`)
  const probe = await db.from(table).select('*').limit(1)
  if (probe.error) throw new Error(`${table}: ${probe.error.message}`)
  const orderKey = ORDER_KEYS.find(key => probe.data[0] && key in probe.data[0])
  const rows = []
  for (let from = 0; from < Math.max(count, 1); from += PAGE) {
    let query = db.from(table).select('*').range(from, from + PAGE - 1)
    if (orderKey) query = query.order(orderKey, { ascending: true })
    const { data, error } = await query
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < PAGE) break
  }
  const unique = new Set(rows.map(row => JSON.stringify(row))).size
  save(`data/${table}.json`, JSON.stringify(rows, null, 1))
  report(rows.length === count && unique === count, `${table}: ${rows.length}/${count} satır`)
  return { rows: rows.length, expected: count, order_key: orderKey ?? null }
}

const tables = {}
for (const table of TABLES) {
  try { tables[table] = await dumpTable(table) } catch (error) { report(false, error.message); tables[table] = { error: error.message } }
}

// Menü görselleri: Storage listesi + kayıtlardaki görsel adresleri (liste yetkisi yoksa yine iner).
const bucket = 'menu-images'
const objectPaths = new Set()
async function listAll(prefix = '') {
  const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) return
  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.id) objectPaths.add(path); else await listAll(path)
  }
}
await listAll()
const marker = `/storage/v1/object/public/${bucket}/`
for (const table of ['menu_items', 'categories']) {
  try {
    for (const row of JSON.parse(readFileSync(join(out, 'data', `${table}.json`), 'utf8'))) {
      const url = row.image_url ?? ''
      if (url.includes(marker)) objectPaths.add(decodeURIComponent(url.slice(url.indexOf(marker) + marker.length).split('?')[0]))
    }
  } catch { /* tablo indirilemediyse yukarıda raporlandı */ }
}
let downloaded = 0
for (const path of [...objectPaths].sort()) {
  const { data, error } = await db.storage.from(bucket).download(path)
  if (error) { report(false, `görsel indirilemedi: ${path} (${error.message})`); continue }
  mkdirSync(dirname(join(out, 'storage', bucket, path)), { recursive: true })
  save(`storage/${bucket}/${path}`, Buffer.from(await data.arrayBuffer()))
  downloaded++
}
report(downloaded === objectPaths.size && downloaded > 0, `menü görselleri: ${downloaded}/${objectPaths.size}`)
await db.auth.signOut()

let commit = null
try { commit = execSync('git rev-parse HEAD', { cwd: repo }).toString().trim() } catch { /* git yoksa boş */ }
const manifest = { created_at: new Date().toISOString(), project_ref: STAGING_REF, repo_commit: commit, tables, storage: { bucket, objects: downloaded },
  not_included: ['auth.users / auth.identities (3 personel hesabı; şifreler .staging-credentials.local içinde, kimlikler staff_profiles.user_id)',
    'Vault sırları (staging Vault şu an boş)', 'sistem şemaları (auth, storage iç tabloları, realtime)'],
  files }
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
writeFileSync(join(out, 'GERI_YUKLEME.md'), readFileSync(join(repo, 'docs', 'STAGING_BACKUP.md'), 'utf8'))
console.log(`\n${problems ? `✖ ${problems} sorun` : '✔ Yedek tamam'}: ${out}`)
process.exit(problems ? 1 : 0)
