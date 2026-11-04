// Yönetim panelinden eskiden sıkıştırılmadan yüklenmiş büyük menü fotoğraflarını küçültür (yalnızca staging).
//   node scripts/optimize-menu-images.mjs           → yalnızca rapor (hiçbir şey değiştirmez)
//   node scripts/optimize-menu-images.mjs --onay    → WebP (1600px) + kart görseli (320px) yükler, ürünün image_url'ini yeniye çevirir
// Eski dosyalar SİLİNMEZ (geri dönüş: image_url eski adrese yazılır). Yönetici oturumuyla, RLS içinde çalışır.
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { stagingAdmin } from '../tests/e2e/tableCleanup.mjs'

const APPLY = process.argv.includes('--onay')
const MIN_BYTES = 300 * 1024
const db = await stagingAdmin()
const { data: items, error } = await db.from('menu_items').select('id, name, image_url').like('image_url', '%/menu-images/uploads/%')
if (error) throw error

let before = 0
let after = 0
const changes = []
for (const item of items) {
  if (/\.webp$/.test(item.image_url)) continue
  const response = await fetch(item.image_url)
  if (!response.ok) { console.log(`atlandı (${response.status}): ${item.name}`); continue }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length < MIN_BYTES) continue
  const full = await sharp(bytes).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toBuffer()
  const thumb = await sharp(bytes).rotate().resize(320, 320, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80, effort: 6 }).toBuffer()
  before += bytes.length
  after += full.length
  changes.push({ item, full, thumb })
  console.log(`${item.name}: ${Math.round(bytes.length / 1024)} KB → ${Math.round(full.length / 1024)} KB (kart: ${Math.round(thumb.length / 1024)} KB)`)
}
console.log(`\n${changes.length} görsel: ${Math.round(before / 1024)} KB → ${Math.round(after / 1024)} KB`)

if (!APPLY) {
  console.log('Yalnızca rapor. Uygulamak için: node scripts/optimize-menu-images.mjs --onay')
} else {
  const bucket = db.storage.from('menu-images')
  for (const { item, full, thumb } of changes) {
    const id = randomUUID()
    for (const [path, body] of [[`uploads/${id}.thumb.webp`, thumb], [`uploads/${id}.webp`, full]]) {
      const { error: uploadError } = await bucket.upload(path, body, { contentType: 'image/webp', cacheControl: '31536000' })
      if (uploadError) throw new Error(`${item.name}: ${uploadError.message}`)
    }
    const url = bucket.getPublicUrl(`uploads/${id}.webp`).data.publicUrl
    const { error: updateError } = await db.from('menu_items').update({ image_url: url }).eq('id', item.id)
    if (updateError) throw new Error(`${item.name}: ${updateError.message}`)
    console.log(`✔ ${item.name} (eski: ${item.image_url.split('/').pop()})`)
  }
}
await db.auth.signOut()
