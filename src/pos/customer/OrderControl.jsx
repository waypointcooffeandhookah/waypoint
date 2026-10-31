import { Minus, Plus, ShoppingBag } from 'lucide-react'

// Ürün kartı ve vitrin içindeki ekleme düğmesi. Kartın kendi tıklamasını tetiklemez.
export default function OrderControl({ ordering, item, wide = false }) {
  if (!ordering.orderable(item)) return null
  const quantity = ordering.quantity(item.id)
  const stop = event => event.stopPropagation()

  if (!quantity) {
    return wide ? (
      <button type="button" className="pos-btn pos-btn-primary qr-add-wide" disabled={ordering.locked}
        onClick={event => { stop(event); ordering.add(item) }} onKeyDown={stop}>
        <ShoppingBag size={18} aria-hidden="true" /> Sepete Ekle
      </button>
    ) : (
      <button type="button" className="qr-add" disabled={ordering.locked} aria-label={`${item.name} sepete ekle`}
        onClick={event => { stop(event); ordering.add(item) }} onKeyDown={stop}>
        <Plus size={20} strokeWidth={2.4} aria-hidden="true" />
      </button>
    )
  }

  const decrease = event => {
    stop(event)
    const line = ordering.cart.lines.findLast(entry => entry.menuItemId === item.id)
    ordering.dispatch({ type: 'setQuantity', lineId: line.lineId, quantity: line.quantity - 1 })
  }
  return (
    <div className={`pos-stepper qr-stepper${wide ? ' wide' : ''}`} role="group" aria-label={`${item.name} adedi`} onClick={stop} onKeyDown={stop}>
      <button type="button" onClick={decrease} disabled={ordering.locked} aria-label="Azalt"><Minus size={16} /></button>
      <span>{quantity}</span>
      <button type="button" onClick={event => { stop(event); ordering.add(item) }} disabled={ordering.locked || quantity >= 20} aria-label="Artır"><Plus size={16} /></button>
    </div>
  )
}
