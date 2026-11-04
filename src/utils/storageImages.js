import { supabase } from '../supabaseClient'
import { randomUUID } from './uuid'

export const IMAGE_BUCKET = 'menu-images'
export const MAX_EDGE = 1600 // ürün penceresi (tam ekran telefon @3x için yeterli)
export const THUMB_EDGE = 320 // menü kartı 96px @3x
const YEAR = '31536000'


// Kenar sınırına sığdırır; büyütmez.
export function fitSize(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function encode(bitmap, maxEdge, quality) {
  const { width, height } = fitSize(bitmap.width, bitmap.height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality))
  // WebP kodlayamayan eski tarayıcı PNG döndürür; o durumda dosya sıkıştırılmadan yüklenir.
  return blob?.type === 'image/webp' ? blob : null
}

// Telefon fotoğrafı (2–5 MB) yüklemeden önce tarayıcıda küçültülür: tam görsel ~150 KB, kart görseli ~15 KB.
async function compress(file) {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    try {
      const full = await encode(bitmap, MAX_EDGE, 0.82)
      const thumb = full && await encode(bitmap, THUMB_EDGE, 0.8)
      return full && thumb ? { full, thumb } : null
    } finally { bitmap.close?.() }
  } catch { return null }
}

export async function uploadMenuImage(file, path) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG veya WebP görseli seçin.')
  if (file.size > 15 * 1024 * 1024) throw new Error('Görsel en fazla 15 MB olabilir.')
  const bucket = supabase.storage.from(IMAGE_BUCKET)
  const fail = error => new Error(`Görsel yüklenemedi: ${error.message}. Storage kurulumu ve yönetici yetkisini kontrol edin.`)
  const small = path ? null : await compress(file)
  if (small) {
    const id = randomUUID()
    const thumb = await bucket.upload(`uploads/${id}.thumb.webp`, small.thumb, { cacheControl: YEAR, contentType: 'image/webp' })
    if (thumb.error) throw fail(thumb.error)
    const full = await bucket.upload(`uploads/${id}.webp`, small.full, { cacheControl: YEAR, contentType: 'image/webp' })
    if (full.error) throw fail(full.error)
    return bucket.getPublicUrl(`uploads/${id}.webp`).data.publicUrl
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('Bu tarayıcı görseli küçültemedi; en fazla 5 MB yükleyin.')
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]
  const objectPath = path || `uploads/${randomUUID()}.${ext}`
  const { error } = await bucket.upload(objectPath, file, { upsert: Boolean(path), cacheControl: path ? '3600' : YEAR, contentType: file.type })
  if (error) throw fail(error)
  return bucket.getPublicUrl(objectPath).data.publicUrl
}
