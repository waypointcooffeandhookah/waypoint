// İşletmenin profil ve WhatsApp bağlantıları.
export const INSTAGRAM_URL = 'https://www.instagram.com/waypoint_coffe_and_hookah/'
export const WHATSAPP_URL = 'https://wa.me/905550109134'

export function normalizeInstagram(value) {
  const text = value.trim()
  if (!text) return ''
  if (/^@?[a-zA-Z0-9._]{1,30}$/.test(text)) return `https://www.instagram.com/${text.replace(/^@/, '')}/`
  try {
    const url = new URL(text)
    if (url.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(url.hostname) && /^\/[a-zA-Z0-9._]{1,30}\/?$/.test(url.pathname)) return `https://www.instagram.com${url.pathname.replace(/\/$/, '')}/`
  } catch { /* Invalid URL. */ }
  throw new Error('Geçerli bir Instagram profili girin.')
}
export function normalizeWhatsApp(value) {
  if (!value.trim()) return ''
  let digits = value.replace(/[\s()+-]/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (/^05\d{9}$/.test(digits)) digits = `90${digits.slice(1)}`
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error('Geçerli bir telefon numarası girin.')
  return digits
}
