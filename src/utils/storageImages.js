import { supabase } from '../supabaseClient'

export const IMAGE_BUCKET = 'menu-images'
export async function uploadMenuImage(file, path) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG veya WebP görseli seçin.')
  if (file.size > 5 * 1024 * 1024) throw new Error('Görsel en fazla 5 MB olabilir.')
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]
  const objectPath = path || `uploads/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(objectPath, file, { upsert: Boolean(path), cacheControl: '3600', contentType: file.type })
  if (error) throw new Error(`Görsel yüklenemedi: ${error.message}. Storage kurulumu ve yönetici yetkisini kontrol edin.`)
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(objectPath).data.publicUrl
}
