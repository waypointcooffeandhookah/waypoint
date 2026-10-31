import { Check } from 'lucide-react'
import { formatCents } from '../money'
import { formatClock } from '../messages'
import { CHANNELS, PAYMENT_LABELS, trackingSteps } from './onlineOrders'

// Takip kartı: kişisel veri içermez. Süre veya kurye vaadi yoktur, yalnızca kayıtlı durum gösterilir.
export default function TrackingCard({ order }) {
  const cancelled = order.fulfillmentStatus === 'cancelled'
  return (
    <div className={`qr-order qr-track${cancelled ? ' cancelled' : ''}`}>
      <div className="qr-order-head">
        <span className="qr-order-number">#{order.orderNumber}</span>
        <span className="qr-order-time">{formatClock(order.createdAt)}</span>
        <span className="qr-track-type">{CHANNELS[order.fulfillmentType]}</span>
      </div>
      {cancelled
        ? <p className="pos-alert" role="status">Bu sipariş iptal edildi.</p>
        : (
          <ol className="qr-track-steps">
            {trackingSteps(order).map(step => (
              <li key={step.key} className={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
                <span className="qr-step-dot">{step.state !== 'todo' && <Check size={12} strokeWidth={3} aria-hidden="true" />}</span>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
        )}
      <ul className="qr-order-items">
        {order.items.map((item, index) => (
          <li key={index}>
            <span className="qr-order-qty">{item.quantity}×</span>
            <span className="qr-order-name">{item.name}{item.note && <em>{item.note}</em>}</span>
            <span className="qr-order-amount">{formatCents(item.lineTotalCents)}</span>
          </li>
        ))}
      </ul>
      <dl className="qr-track-totals">
        {order.deliveryFeeCents > 0 && <div><dt>Teslimat ücreti</dt><dd>{formatCents(order.deliveryFeeCents)}</dd></div>}
        <div className="total"><dt>Toplam</dt><dd>{formatCents(order.totalCents)}</dd></div>
        <div><dt>{PAYMENT_LABELS[order.paymentMethod]}</dt><dd>{order.paymentStatus === 'paid' ? 'Ödendi' : 'Ödenmedi'}</dd></div>
      </dl>
    </div>
  )
}
