// POS ekranlarının ortak Türkçe metinleri.
const ORDER_ERRORS = {
  item_unavailable: 'Sepetteki bir ürün artık mevcut değil. Ürünü çıkarıp tekrar deneyin.',
  invalid_quantity: 'Adetler 1 ile 20 arasında olmalı.',
  invalid_line: 'Sepette geçersiz bir satır var.',
  too_many_lines: 'Bir siparişte en fazla 30 farklı ürün olabilir.',
  empty_order: 'Sepet boş.',
  note_too_long: 'Not çok uzun.',
  table_not_found: 'Masa bulunamadı veya kullanım dışı.',
  invalid_table: 'Masa kodu geçersiz. Lütfen masadaki QR kodu yeniden okutun.',
  invalid_price: 'Sepetteki bir ürünün fiyatı doğrulanamadı. Personelimize danışın.',
  bill_closed: 'Bu masanın adisyonu kapatılmış.',
  forbidden: 'Bu işlem için yetkiniz yok. Yeniden giriş yapın.',
  rate_limited: 'Çok sık sipariş gönderildi, biraz sonra tekrar deneyin.',
  idempotency_key_conflict: 'Gönderim çakıştı. Sepeti kontrol edip yeniden gönderin.',
}

export const orderErrorMessage = code => ORDER_ERRORS[code] ?? 'Sipariş kabul edilmedi. Lütfen tekrar deneyin.'

const STATUS_ERRORS = {
  invalid_transition: 'Sipariş başka bir ekranda güncellenmiş. Liste yenilendi.',
  order_not_found: 'Sipariş bulunamadı. Liste yenilendi.',
  bill_closed: 'Bu masanın adisyonu kapatılmış.',
  forbidden: 'Bu işlem için yetkiniz yok.',
}

export const statusErrorMessage = code => STATUS_ERRORS[code] ?? 'Durum güncellenemedi. Bağlantınızı kontrol edip tekrar deneyin.'

export const STATUS_LABELS = {
  new: 'Yeni',
  preparing: 'Hazırlanıyor',
  ready: 'Hazır',
  served: 'Servis edildi',
  cancelled: 'İptal',
}

export const SOURCE_LABELS = { qr: 'QR Müşteri', waiter: 'Garson' }

export const formatClock = time => new Date(time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })

export function formatElapsed(time, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - time) / 60000))
  if (minutes < 1) return 'şimdi'
  if (minutes < 60) return `${minutes} dk`
  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`
}
