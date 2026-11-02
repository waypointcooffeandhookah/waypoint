// Sipariş alımı ile kanal ayarını ayrı okur. Genel menü rotası bunu tembel yüklenen denetleyici üzerinden kullanır.
// get_ordering_config yanıtı: kanal görünürlüğü yöneticinin kanal ayarından, gönderim izni "blocked"
// alanından gelir. Sipariş alımı kapalıyken kanallar görünür kalır ama gönderim kapalıdır.
// Eski sunucu yanıtı ("channels" yok) eski anlamıyla okunur. Hiç açık kanal yoksa null.
export function normalizeOrderingConfig(data) {
  if (!data || typeof data !== 'object') return null
  const source = data.channels && typeof data.channels === 'object' ? data.channels : data
  const config = {
    pickup: source.pickup === true,
    delivery: source.delivery === true,
    dine_in: source.dine_in === true,
    auto_open: data.auto_open !== false,
    blocked: typeof data.blocked === 'string' && data.blocked ? data.blocked : (data.accepting === false ? 'ordering_closed' : null),
  }
  return config.pickup || config.delivery ? config : null
}
