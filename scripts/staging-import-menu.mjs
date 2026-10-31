// Üretim menüsünü staging'e aktarır. Üretim yalnızca okunur: herkese açık anon anahtar ve yalnızca GET/HEAD.
// Çalıştırma: npm run staging:menu (yalnızca karşılaştırma) · npm run staging:menu -- --apply (uygular)
// Staging'e yerel yönetici hesabıyla (RLS) yazar; kimlik bilgisi yazdırılmaz. Silme yapmaz, tekrar çalıştırılabilir.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { STAGING_REF, PRODUCTION_REF } from '../src/supabaseTarget.js'
import { getItemImage } from '../src/utils/imageUtils.js'
import { guardedFetch } from './staging-staff.lib.mjs'
import { countActions, planCatalogImport, storagePath } from './staging-menu-import.lib.mjs'

const APPLY = process.argv.includes('--apply')
const root = new URL('../', import.meta.url)
const PROD_ORIGIN = `https://${PRODUCTION_REF}.supabase.co`, STAGING_ORIGIN = `https://${STAGING_REF}.supabase.co`
const prodKey = /eyJ[\w.-]+/.exec(readFileSync(new URL('src/config.js', root), 'utf8'))[0]
const env = Object.fromEntries(readFileSync(new URL('.env.staging.local', root), 'utf8').split(/\r?\n/).filter(Boolean).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
if (env.VITE_SUPABASE_URL !== STAGING_ORIGIN) throw new Error('.env.staging.local staging projesini göstermiyor.')

// Üretime yazma isteği teknik olarak gönderilemez.
async function prodGet(path) {
  const response = await fetch(`${PROD_ORIGIN}${path}`, { method: 'GET', headers: { apikey: prodKey, Authorization: `Bearer ${prodKey}` } })
  if (!response.ok) throw new Error(`Üretim okunamadı ${path}: ${response.status}`)
  return response
}
const prodTable = async name => (await prodGet(`/rest/v1/${name}?select=*&order=created_at.asc,id.asc&limit=5000`)).json()
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
const readProduction = async () => ({
  categories: await prodTable('categories'),
  items: await prodTable('menu_items'),
  promotion: await (await prodGet('/rest/v1/menu_promotion?select=*')).json(),
})

const db = createClient(STAGING_ORIGIN, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: guardedFetch } })
const readStaging = async () => {
  const [categories, items] = await Promise.all([db.from('categories').select('*'), db.from('menu_items').select('*')])
  if (categories.error || items.error) throw new Error('Staging okunamadı')
  return { categories: categories.data, items: items.data }
}
const fail = (label, error) => { if (error) throw new Error(`${label}: ${error.message}`) }
const stagingImageInfo = async path => {
  const response = await fetch(`${STAGING_ORIGIN}/storage/v1/object/public/menu-images/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'HEAD', cache: 'no-store' })
  return response.ok ? Number(response.headers.get('content-length')) : null
}

const production = await readProduction()
const before = hash(production)
const plan = planCatalogImport({ production, staging: await readStaging(), productionOrigin: PROD_ORIGIN, stagingOrigin: STAGING_ORIGIN })

console.log(`Üretim: ${production.categories.length} kategori, ${production.items.length} ürün (özet ${before})`)
console.log('Kategori planı:', countActions(plan.categories))
console.log('Ürün planı:', countActions(plan.items))
console.log('Gizlenecek test ürünü:', plan.fixtures.map(item => `${item.name}${item.needsMove ? ' (taşınacak)' : ''}`).join(', ') || 'yok')
console.log('Üretimde karşılığı olmayan diğer staging ürünü:', plan.unmatched.map(item => item.name).join(', ') || 'yok')

const noUrl = production.items.filter(item => !item.image_url)
const resolved = noUrl.map(item => ({ name: item.name, file: getItemImage({ ...item, image_url: null }) }))
const missingLocal = resolved.filter(({ file }) => !file || (!/^https?:/.test(file) && !existsSync(new URL(`public/${file.replace(/^\/?(waypoint\/)?/, '')}`, root))))
console.log(`Görsel: ${plan.imagePaths.length} benzersiz Storage görseli, ${noUrl.length} ürün URL'siz (yerel çözücü: ${[...new Set(resolved.map(r => r.file))].join(', ') || '-'})`)
console.log('Yerel çözücüde bulunamayan:', missingLocal.map(r => r.name).join(', ') || 'yok')

if (!APPLY) {
  const missing = []
  for (const path of plan.imagePaths) if (await stagingImageInfo(path) === null) missing.push(path)
  console.log(`Staging'de eksik görsel: ${missing.length}/${plan.imagePaths.length}`)
  console.log('KURU ÇALIŞTIRMA: hiçbir şey yazılmadı. Uygulamak için --apply kullanın.')
  process.exit(0)
}

const { creds } = { creds: JSON.parse(readFileSync(new URL('.staging-credentials.local', root), 'utf8')).admin }
const signIn = await db.auth.signInWithPassword(creds)
if (signIn.error) throw new Error('Staging yönetici girişi başarısız.')

let copied = 0, skipped = 0
for (const path of plan.imagePaths) {
  const source = await prodGet(`/storage/v1/object/public/menu-images/${path.split('/').map(encodeURIComponent).join('/')}`)
  const bytes = new Uint8Array(await source.arrayBuffer())
  if (await stagingImageInfo(path) === bytes.length) { skipped++; continue }
  const { error } = await db.storage.from('menu-images').upload(path, bytes, { upsert: true, contentType: source.headers.get('content-type') ?? 'image/jpeg', cacheControl: '3600' })
  fail(`Görsel ${path}`, error)
  copied++
}
console.log(`Görsel kopyalandı: ${copied}, zaten vardı: ${skipped}`)

const changedCategories = plan.categories.filter(cat => cat.action !== 'same').map(cat => cat.row)
if (changedCategories.length) fail('Kategoriler', (await db.from('categories').upsert(changedCategories)).error)
const changedItems = plan.items.filter(item => item.action !== 'same').map(item => item.row)
if (changedItems.length) fail('Ürünler', (await db.from('menu_items').upsert(changedItems)).error)
for (const fixture of plan.fixtures.filter(item => item.needsMove)) {
  fail('Test ürünü', (await db.from('menu_items').update({ category_id: fixture.category_id, is_available: false }).eq('id', fixture.id)).error)
}
if (plan.promotion) fail('Tanıtım', (await db.from('menu_promotion').upsert(plan.promotion)).error)

// Doğrulama: aynı plan artık değişiklik üretmemeli, üretim değişmemiş olmalı, her görsel erişilebilir olmalı.
const after = planCatalogImport({ production, staging: await readStaging(), productionOrigin: PROD_ORIGIN, stagingOrigin: STAGING_ORIGIN })
console.log('Uygulama sonrası kategori:', countActions(after.categories), 'ürün:', countActions(after.items))
if (countActions(after.items).insert + countActions(after.items).update + countActions(after.categories).insert + countActions(after.categories).update) throw new Error('Plan uygulama sonrası boşalmadı.')
for (const row of [...production.items]) {
  const path = storagePath(row.image_url, PROD_ORIGIN)
  if (path && await stagingImageInfo(path) === null) throw new Error(`Görsel staging'de yok: ${row.name}`)
}
const prodAfter = hash(await readProduction())
console.log(`Üretim özeti önce ${before}, sonra ${prodAfter}: ${before === prodAfter ? 'değişmedi' : 'FARKLI'}`)
process.exit(before === prodAfter ? 0 : 1)
