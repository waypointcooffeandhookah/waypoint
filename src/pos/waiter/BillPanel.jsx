import { useState } from 'react'
import { Banknote, CheckCircle2, CreditCard, LoaderCircle, QrCode, Receipt, UserRound } from 'lucide-react'
import { formatCents } from '../money'
import { STATUS_LABELS, SOURCE_LABELS, formatClock } from '../messages'
import { METHOD_LABELS, centsToInput, changeDue, closeBlocker, parseLira, paymentProblem, paymentTotals, splitShare } from './billPayment'

const BLOCKER_TEXT = {
  orders_in_progress: 'Önce bekleyen siparişler servis edilmeli (veya iptal ettirilmeli).',
  balance_due: 'Kalan bakiye ödenince hesap kapatılabilir.',
}

// Ödeme al: tutar (kalanın tamamı / kişi başı / elle), nakit veya kart. Nakitte para üstü hesaplanır.
function PaymentBox({ bill, busy, onPay }) {
  const [amountText, setAmountText] = useState(() => centsToInput(bill.balanceCents))
  const [givenText, setGivenText] = useState('')
  const [split, setSplit] = useState(null)
  const amount = parseLira(amountText)
  const problem = paymentProblem(amount, bill.balanceCents)
  const change = changeDue(parseLira(givenText), amount)

  const setAmount = cents => { setAmountText(centsToInput(cents)); setGivenText('') }
  const pay = method => { if (!problem) onPay(amount, method, () => { setGivenText(''); setSplit(null) }) }

  return (
    <section className="wt-pay" aria-label="Ödeme al">
      <h3>Ödeme al</h3>
      <div className="wt-pay-quick">
        <button type="button" className={`pos-chip${split === null && amount === bill.balanceCents ? ' active' : ''}`} onClick={() => { setSplit(null); setAmount(bill.balanceCents) }}>Kalanın tamamı</button>
        {[2, 3, 4].map(people => (
          <button key={people} type="button" className={`pos-chip${split === people ? ' active' : ''}`} onClick={() => { setSplit(people); setAmount(splitShare(bill.balanceCents, people)) }}>{people} kişi</button>
        ))}
      </div>
      <label className="wt-pay-field">
        <span>Tutar (₺)</span>
        <input className="input" inputMode="decimal" autoComplete="off" value={amountText} disabled={busy} aria-invalid={Boolean(amountText) && Boolean(problem)}
          onChange={event => { setAmountText(event.target.value); setSplit(null) }} />
      </label>
      {amountText && problem === 'overpayment' && <p className="wt-pay-error" role="alert">Kalan bakiye {formatCents(bill.balanceCents)}; daha fazlası alınamaz.</p>}
      {amountText && problem === 'invalid_amount' && <p className="wt-pay-error" role="alert">Geçerli bir tutar girin (ör. 250 veya 250,50).</p>}
      {split && <p className="pos-muted wt-pay-hint">Kişi başı {formatCents(splitShare(bill.balanceCents, split))}. Kuruş farkı son ödemede kalır.</p>}
      <label className="wt-pay-field">
        <span>Nakitte müşterinin verdiği (isteğe bağlı)</span>
        <input className="input" inputMode="decimal" autoComplete="off" placeholder="ör. 500" value={givenText} disabled={busy} onChange={event => setGivenText(event.target.value)} />
      </label>
      {change !== null && <p className="wt-pay-change">Para üstü: <strong>{formatCents(change)}</strong></p>}
      <div className="wt-pay-actions">
        <button type="button" className="pos-btn wt-pay-cash" disabled={busy || Boolean(problem)} onClick={() => pay('cash')}>
          {busy === 'cash' ? <LoaderCircle size={18} className="pos-spin" aria-hidden="true" /> : <Banknote size={18} aria-hidden="true" />} Nakit al
        </button>
        <button type="button" className="pos-btn wt-pay-card" disabled={busy || Boolean(problem)} onClick={() => pay('card')}>
          {busy === 'card' ? <LoaderCircle size={18} className="pos-spin" aria-hidden="true" /> : <CreditCard size={18} aria-hidden="true" />} Kartla al
        </button>
      </div>
    </section>
  )
}

export default function BillPanel({ bill, error, onServe, onPay, onClose, paying = null, closing = false }) {
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

  const payments = bill.payments ?? []
  const totals = paymentTotals(payments)
  const blocker = closeBlocker(bill)
  const canPay = Boolean(onPay) && bill.balanceCents > 0

  return (
    <div className="wt-bill">
      <div className="wt-bill-summary">
        <div><span>Toplam</span><strong>{formatCents(bill.totalCents)}</strong></div>
        <div><span>Ödenen</span><strong>{formatCents(bill.paidCents)}</strong></div>
        <div className="accent"><span>Kalan</span><strong>{formatCents(bill.balanceCents)}</strong></div>
      </div>

      {canPay && <PaymentBox key={`${bill.billId}:${bill.balanceCents}`} bill={bill} busy={paying} onPay={onPay} />}

      {payments.length > 0 && (
        <section className="wt-payments" aria-label="Alınan ödemeler">
          <h3>Alınan ödemeler</h3>
          <ul>
            {payments.map(payment => (
              <li key={payment.id}>
                <span>{formatClock(payment.createdAt)}</span>
                <span className={`wt-method wt-method-${payment.method}`}>{payment.method === 'card' ? <CreditCard size={13} aria-hidden="true" /> : <Banknote size={13} aria-hidden="true" />}{METHOD_LABELS[payment.method] ?? payment.method}</span>
                <strong>{formatCents(payment.amountCents)}</strong>
              </li>
            ))}
          </ul>
          <p className="wt-payments-total">Nakit {formatCents(totals.cash)} · Kart {formatCents(totals.card)}</p>
        </section>
      )}

      {onClose && (
        <section className="wt-close" aria-label="Hesabı kapat">
          <button type="button" className="pos-btn pos-btn-primary wt-close-btn" disabled={Boolean(blocker) || closing} onClick={onClose}>
            {closing ? <LoaderCircle size={18} className="pos-spin" aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />} Hesabı kapat
          </button>
          {blocker && <p className="pos-muted wt-close-hint">{BLOCKER_TEXT[blocker]}</p>}
        </section>
      )}

      <ol className="wt-orders">
        {[...bill.orders].reverse().map(order => (
          <li key={order.id} className={`wt-order${order.status === 'cancelled' ? ' cancelled' : ''}${order.status === 'ready' ? ' ready' : ''}`}>
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
