import { QrCode, Receipt, UserRound } from 'lucide-react'
import { formatCents } from '../money'
import { STATUS_LABELS, SOURCE_LABELS, formatClock } from '../messages'

export default function BillPanel({ bill, error, onServe }) {
  if (error && !bill) return <p className="pos-alert" role="alert">Adisyon yüklenemedi. Otomatik olarak yeniden denenecek.</p>
  if (bill === undefined) return <div className="loading-screen" role="status"><div className="spinner" />Adisyon yükleniyor…</div>
  if (!bill) {
    return (
      <div className="empty-state wt-cart-empty">
        <Receipt size={40} aria-hidden="true" />
        <h3>Açık adisyon yok</h3>
        <p>Bu masaya gönderilen ilk sipariş adisyonu otomatik açar.</p>
      </div>
    )
  }

  return (
    <div className="wt-bill">
      <div className="wt-bill-summary">
        <div><span>Toplam</span><strong>{formatCents(bill.totalCents)}</strong></div>
        <div><span>Ödenen</span><strong>{formatCents(bill.paidCents)}</strong></div>
        <div className="accent"><span>Kalan</span><strong>{formatCents(bill.balanceCents)}</strong></div>
      </div>

      <ol className="wt-orders">
        {[...bill.orders].reverse().map(order => (
          <li key={order.id} className={`wt-order${order.status === 'cancelled' ? ' cancelled' : ''}`}>
            <div className="wt-order-head">
              <span className="wt-order-number">#{order.orderNumber}</span>
              <span className={`pos-source pos-source-${order.source}`}>
                {order.source === 'qr' ? <QrCode size={12} aria-hidden="true" /> : <UserRound size={12} aria-hidden="true" />}
                {SOURCE_LABELS[order.source]}
              </span>
              <span className="wt-order-time">{formatClock(order.createdAt)}</span>
              <span className={`pos-status pos-status-${order.status}`}>{STATUS_LABELS[order.status]}</span>
            </div>
            <ul className="wt-order-items">
              {order.items.map((item, index) => (
                <li key={index}>
                  <span className="wt-order-qty">{item.quantity}×</span>
                  <span className="wt-order-name">{item.name}{item.note && <em>{item.note}</em>}</span>
                  <span className="wt-order-amount">{formatCents(item.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
            {order.note && <p className="wt-order-note">Not: {order.note}</p>}
            {order.status === 'ready' && (
              <button type="button" className="pos-btn pos-btn-primary wt-serve" onClick={() => onServe(order)}>Servis edildi</button>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
