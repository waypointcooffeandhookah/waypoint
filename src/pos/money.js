// Tutarlar her yerde tamsayı kuruş olarak taşınır; TL yalnızca gösterimde.
const formatter = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 })

export function priceToCents(price) {
  const value = typeof price === 'string' ? Number(price.replace(',', '.')) : Number(price)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

export function formatCents(cents) {
  return formatter.format(Number(cents) / 100)
}

// Sepette yalnızca tahmini toplam içindir; kesin tutarı sunucu hesaplar.
export function estimateTotalCents(lines) {
  return lines.reduce((sum, line) => sum + (priceToCents(line.price) ?? 0) * line.quantity, 0)
}
