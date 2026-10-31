import { useState } from 'react'
import { Check, CircleCheck, ClipboardList, LoaderCircle, Minus, Pencil, Plus, Receipt, Send, ShoppingBag, TriangleAlert, X } from 'lucide-react'
import { useDialog } from '../../utils/useDialog'
import { estimateTotalCents, formatCents } from '../money'
import { formatClock, orderErrorMessage } from '../messages'
import { MAX_QUANTITY } from '../cart'
import { CUSTOMER_STATUS, STATUS_STEPS } from './qrOrders'

function CartLine({ line, locked, dispatch }) {
  const [editing, setEditing] = useState(Boolean(line.note))
  const setQuantity = quantity => dispatch({ type: 'setQuantity', lineId: line.lineId, quantity })

  return (
    <li className="qr-line">
      {line.image && <img src={line.image} alt="" className="qr-line-img" loading="lazy" />}
      <div className="qr-line-main">
        <div className="qr-line-top">
          <div className="qr-line-info">
            <span className="qr-line-name">{line.name}</span>
            <span className="qr-line-price">{formatCents(Math.round(line.price * 100) * line.quantity)}</span>
          </div>
          <div className="pos-stepper" role="group" aria-label={`${line.name} adedi`}>
            <button type="button" onClick={() => setQuantity(line.quantity - 1)} disabled={locked} aria-label={line.quantity === 1 ? 'Ürünü çıkar' : 'Azalt'}><Minus size={16} /></button>
            <span>{line.quantity}</span>
            <button type="button" onClick={() => setQuantity(line.quantity + 1)} disabled={locked || line.quantity >= MAX_QUANTITY} aria-label="Artır"><Plus size={16} /></button>
          </div>
        </div>
        {editing ? (
          <input className="input qr-note-input" value={line.note} maxLength={200} disabled={locked} placeholder="Örn. az şekerli, buzsuz…"
            aria-label={`${line.name} notu`} onChange={event => dispatch({ type: 'setLineNote', lineId: line.lineId, note: event.target.value })} />
        ) : (
          <button type="button" className="qr-note-toggle" disabled={locked} onClick={() => setEditing(true)}><Pencil size={13} aria-hidden="true" /> Hazırlık notu ekle</button>
        )}
      </div>
    </li>
  )
}

function CartView({ ordering }) {
  const { cart, count, dispatch, locked, submitState, rejectCode } = ordering

  if (!cart.lines.length) {
    return (
      <div className="qr-empty">
        <ShoppingBag size={38} strokeWidth={1.5} aria-hidden="true" />
        <h3>Sepetiniz boş</h3>
        <p>Menüden ürün ekleyerek başlayın.</p>
      </div>
    )
  }
  return (
    <>
      <div className="qr-sheet-body">
        <ul className="qr-lines">
          {cart.lines.map(line => <CartLine key={line.lineId} line={line} locked={locked} dispatch={dispatch} />)}
        </ul>
        <label className="input-label" htmlFor="qr-order-note">Sipariş notu</label>
        <textarea id="qr-order-note" className="input qr-order-note" rows={2} maxLength={300} value={cart.note} disabled={locked}
          placeholder="Tüm sipariş için not (isteğe bağlı)" onChange={event => dispatch({ type: 'setNote', note: event.target.value })} />

        {submitState === 'rejected' && (
          <p className="pos-alert qr-rejected" role="alert"><TriangleAlert size={16} aria-hidden="true" /> {orderErrorMessage(rejectCode)}</p>
        )}
        {submitState === 'uncertain' && (
          <div className="pos-alert pos-alert-warn qr-uncertain" role="alert">
            <p><TriangleAlert size={16} aria-hidden="true" /> <strong>Siparişiniz doğrulanamadı.</strong> Ulaşmış olabilir, lütfen tekrar sipariş vermeyin. Önce durumu kontrol edin.</p>
            <button type="button" className="pos-btn pos-btn-ghost" onClick={ordering.reconcile}>Durumu kontrol et</button>
          </div>
        )}
      </div>

      <div className="qr-sheet-footer">
        <div className="qr-total">
          <span>{count} ürün · tahmini toplam</span>
          <strong>{formatCents(estimateTotalCents(cart.lines))}</strong>
        </div>
        <button type="button" className="pos-btn pos-btn-primary qr-send" onClick={ordering.submit} disabled={locked}>
          {submitState === 'sending'
            ? <><LoaderCircle size={20} className="pos-spin" aria-hidden="true" /> Gönderiliyor…</>
            : <><Send size={19} aria-hidden="true" /> Sipariş Ver</>}
        </button>
      </div>
    </>
  )
}

function Confirmation({ ordering }) {
  const { confirmed, demo } = ordering
  return (
    <div className="qr-confirm" role="status">
      <CircleCheck size={54} strokeWidth={1.5} aria-hidden="true" />
      <h3>{demo ? 'Demo siparişiniz kaydedildi' : 'Siparişiniz alındı'}</h3>
      <p className="qr-confirm-number">#{confirmed.orderNumber}</p>
      <p className="qr-confirm-total">{formatCents(confirmed.subtotalCents)}</p>
      <p className="qr-confirm-text">
        {demo ? 'Yalnızca bu tarayıcıdaki demo mutfakta görünür; gerçek mutfağa iletilmedi.' : 'Hazırlık durumunu Siparişlerim bölümünden izleyebilirsiniz.'}
      </p>
      <div className="qr-confirm-actions">
        <button type="button" className="pos-btn pos-btn-ghost" onClick={() => { ordering.dismissConfirmation(); ordering.openSheet('orders') }}><ClipboardList size={17} aria-hidden="true" /> Siparişlerim</button>
        <button type="button" className="pos-btn pos-btn-primary" onClick={ordering.closeSheet}>Menüye dön</button>
      </div>
    </div>
  )
}

function StatusSteps({ status }) {
  const current = STATUS_STEPS.indexOf(status)
  return (
    <ol className="qr-steps" aria-label={`Durum: ${CUSTOMER_STATUS[status]}`}>
      {STATUS_STEPS.map((step, index) => (
        <li key={step} className={index < current ? 'done' : index === current ? 'current' : ''}>
          <span className="qr-step-dot">{index <= current && <Check size={12} strokeWidth={3} aria-hidden="true" />}</span>
          <span>{CUSTOMER_STATUS[step]}</span>
        </li>
      ))}
    </ol>
  )
}

function OrdersView({ ordering }) {
  const { orders, ordersError, hasOrders } = ordering
  const active = orders.filter(order => order.status !== 'cancelled')
  if (!hasOrders) {
    return (
      <div className="qr-empty">
        <Receipt size={38} strokeWidth={1.5} aria-hidden="true" />
        <h3>Henüz siparişiniz yok</h3>
        <p>Bu cihazdan verdiğiniz siparişler burada görünür.</p>
      </div>
    )
  }
  return (
    <div className="qr-sheet-body">
      {ordersError && <p className="pos-alert" role="alert">Durum güncellenemedi. Bağlantı gelince otomatik yenilenecek.</p>}
      <ol className="qr-orders">
        {[...orders].reverse().map(order => (
          <li key={order.id} className={`qr-order qr-order-${order.status}`}>
            <div className="qr-order-head">
              <span className="qr-order-number">#{order.orderNumber}</span>
              <span className="qr-order-time">{formatClock(order.createdAt)}</span>
              <span className={`pos-status pos-status-${order.status}`}>{CUSTOMER_STATUS[order.status]}</span>
            </div>
            {order.status !== 'cancelled' && <StatusSteps status={order.status} />}
            <ul className="qr-order-items">
              {order.items.map((item, index) => (
                <li key={index}>
                  <span className="qr-order-qty">{item.quantity}×</span>
                  <span className="qr-order-name">{item.name}{item.note && <em>{item.note}</em>}</span>
                  <span className="qr-order-amount">{formatCents(item.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {active.length > 0 && (
        <div className="qr-orders-total">
          <span>Bu cihazdan verilen toplam</span>
          <strong>{formatCents(active.reduce((sum, order) => sum + order.subtotalCents, 0))}</strong>
        </div>
      )}
    </div>
  )
}

function Sheet({ ordering }) {
  const { sheet, confirmed, count } = ordering
  const dialogRef = useDialog(ordering.closeSheet)
  return (
    <div className="ipek-modal-backdrop-enter modal-backdrop" onClick={ordering.closeSheet}>
      <div className="ipek-modal-sheet-enter modal-sheet qr-sheet" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Sepet ve siparişler" onClick={event => event.stopPropagation()}>
        <div className="sheet-handle-wrap"><div className="sheet-handle" /></div>
        <div className="qr-sheet-head">
          <div>
            <h2 className="qr-sheet-title">{ordering.tableLabel}</h2>
            {ordering.demo && <span className="qr-demo-tag">DEMO</span>}
          </div>
          <button type="button" className="pos-icon-btn" onClick={ordering.closeSheet} aria-label="Kapat"><X size={18} /></button>
        </div>
        {confirmed ? <Confirmation ordering={ordering} /> : (
          <>
            <div className="pos-segment qr-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={sheet === 'cart'} className={sheet === 'cart' ? 'active' : ''} onClick={() => ordering.openSheet('cart')}>
                <ShoppingBag size={15} aria-hidden="true" /> Sepet{count ? ` (${count})` : ''}
              </button>
              <button type="button" role="tab" aria-selected={sheet === 'orders'} className={sheet === 'orders' ? 'active' : ''} onClick={() => ordering.openSheet('orders')}>
                <ClipboardList size={15} aria-hidden="true" /> Siparişlerim
              </button>
            </div>
            {sheet === 'cart' ? <CartView ordering={ordering} /> : <OrdersView ordering={ordering} />}
          </>
        )}
      </div>
    </div>
  )
}

export default function QrOrderLayer({ ordering }) {
  const { count, cart, hasOrders, sheet } = ordering
  return (
    <>
      {(count > 0 || hasOrders) && !sheet && (
        <div className="qr-bar">
          {hasOrders && (
            <button type="button" className="qr-bar-orders" onClick={() => ordering.openSheet('orders')} aria-label="Siparişlerim">
              <ClipboardList size={20} aria-hidden="true" />
            </button>
          )}
          {count > 0 && (
            <button type="button" className="qr-bar-cart" onClick={() => ordering.openSheet('cart')}>
              <span className="qr-bar-count">{count}</span>
              <span>Sepeti gör</span>
              <strong>{formatCents(estimateTotalCents(cart.lines))}</strong>
            </button>
          )}
        </div>
      )}
      {sheet && <Sheet ordering={ordering} />}
    </>
  )
}
