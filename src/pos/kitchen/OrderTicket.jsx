import { memo } from 'react'
import { Check, ChefHat, Clock, HandPlatter, LoaderCircle, QrCode, UserRound } from 'lucide-react'
import { SOURCE_LABELS, STATUS_LABELS, formatClock, formatElapsed } from '../messages'
import { NEXT_STATUS } from '../orderStatus'
import { isLate } from './kitchenOrders'

const ACTIONS = {
  new: { label: 'Hazırlamaya başla', Icon: ChefHat },
  preparing: { label: 'Hazır', Icon: Check },
  ready: { label: 'Servis edildi', Icon: HandPlatter },
}

function OrderTicket({ order, now, busy, onAdvance }) {
  const action = ACTIONS[order.status]
  const late = isLate(order, now)

  return (
    <li className={`kt-ticket kt-ticket-${order.status} kt-from-${order.source}${late ? ' late' : ''}`}>
      <div className="kt-ticket-head">
        <h3 className="kt-ticket-table">{order.tableLabel}</h3>
        <span className={`pos-source pos-source-${order.source}`}>
          {order.source === 'qr' ? <QrCode size={13} aria-hidden="true" /> : <UserRound size={13} aria-hidden="true" />}
          {SOURCE_LABELS[order.source]}
        </span>
      </div>
      <div className="kt-ticket-meta">
        <span className="kt-ticket-number">#{order.orderNumber}</span>
        <span>{formatClock(order.createdAt)}</span>
        <span className="kt-elapsed"><Clock size={13} aria-hidden="true" />{formatElapsed(order.createdAt, now)}</span>
        <span className={`pos-status pos-status-${order.status}`}>{STATUS_LABELS[order.status]}</span>
      </div>

      <ul className="kt-items">
        {order.items.map((item, index) => (
          <li key={index}>
            <span className="kt-qty">{item.quantity}×</span>
            <span className="kt-item-name">{item.name}{item.note && <em>{item.note}</em>}</span>
          </li>
        ))}
      </ul>
      {order.note && <p className="kt-order-note">Not: {order.note}</p>}

      {action && (
        <button type="button" className={`pos-btn kt-action kt-action-${order.status}`} disabled={busy} onClick={() => onAdvance(order, NEXT_STATUS[order.status])}>
          {busy ? <LoaderCircle size={20} className="pos-spin" /> : <action.Icon size={20} aria-hidden="true" />}
          {action.label}
        </button>
      )}
    </li>
  )
}

export default memo(OrderTicket)
