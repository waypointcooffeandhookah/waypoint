import { useCallback, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Bike, Phone, ShoppingBag } from 'lucide-react'
import { formatCents } from '../money'
import { STATUS_LABELS, formatClock, statusErrorMessage } from '../messages'
import { useOrderSync } from '../useOrderSync'
import { usePosSession } from '../usePosSession'
import PosGate from '../ui/PosGate'
import PosHeader from '../ui/PosHeader'
import { PAYMENT_LABELS } from '../customer/onlineOrders'
import { COLUMNS, FULFILLMENT_ROLES, FULFILLMENT_STATUS_LABELS, addressLines, canCancel, groupFulfillment, nextFulfillmentStep } from './fulfillmentOrders'
import '../ui/pos.css'
import './fulfillment.css'

const REFRESH_MS = 15000
const DEMO_STAFF = { id: 'demo', name: 'Demo Kasa', role: 'cashier' }
const AREA = { name: 'Paket ve kurye ekranı', tag: 'TESLİMAT', hint: 'Kasa veya yönetici hesabınızla giriş yapın.', roles: FULFILLMENT_ROLES, needsCatalog: false }

function OrderCard({ order, role, busy, run, backend }) {
  const [courier, setCourier] = useState(order.courierName ?? '')
  const next = nextFulfillmentStep(order)
  const Icon = order.type === 'pickup' ? ShoppingBag : Bike
  const finished = ['delivered', 'collected', 'cancelled'].includes(order.status)

  const advance = () => {
    if (next.needsCourier && !courier.trim()) return toast.error('Önce kurye adını girin.')
    run(() => backend.setFulfillmentStatus(order.id, next.status, next.needsCourier ? courier.trim() : null))
  }
  const cancel = () => {
    const reason = window.prompt('İptal nedeni')
    if (reason?.trim()) run(() => backend.cancelOrder(order.id, reason.trim()))
  }
  const pay = method => {
    if (window.confirm(`${formatCents(order.totalCents)} tahsil edildi olarak işlensin mi?`)) run(() => backend.recordPayment(order.id, method))
  }

  return (
    <li className={`ff-card ff-type-${order.type} ff-status-${order.status}`} data-order={order.orderNumber}>
      <div className="ff-card-head">
        <span className="ff-type"><Icon size={15} aria-hidden="true" />{order.type === 'pickup' ? 'PAKET / GEL AL' : 'KURYE / TESLİMAT'}</span>
        <span className="ff-number">#{order.orderNumber}</span>
        <time>{formatClock(order.createdAt)}</time>
      </div>
      <div className="ff-statuses">
        <span className={`pos-status pos-status-${order.kitchenStatus}`} title="Mutfak durumu">Mutfak: {STATUS_LABELS[order.kitchenStatus]}</span>
        <span className="ff-fulfillment" title="Teslimat durumu">{FULFILLMENT_STATUS_LABELS[order.status]}</span>
      </div>
      <ul className="ff-items">
        {order.items.map((item, index) => <li key={index}><strong>{item.quantity}×</strong> {item.name}{item.note && <em> {item.note}</em>}</li>)}
      </ul>
      {order.note && <p className="ff-note">Not: {order.note}</p>}

      <div className="ff-customer">
        <strong>{order.customerName}</strong>
        <a href={`tel:${order.customerPhone}`}><Phone size={13} aria-hidden="true" /> {order.customerPhone}</a>
        {order.address && (
          <address className="ff-address">
            {addressLines(order.address).map((line, index) => <span key={index}>{line}</span>)}
            {order.address.instructions && <em>{order.address.instructions}</em>}
          </address>
        )}
      </div>

      <dl className="ff-totals">
        {order.deliveryFeeCents > 0 && <div><dt>Teslimat</dt><dd>{formatCents(order.deliveryFeeCents)}</dd></div>}
        <div className="total"><dt>Toplam</dt><dd>{formatCents(order.totalCents)}</dd></div>
        <div><dt>{PAYMENT_LABELS[order.paymentMethod]}</dt><dd className={`ff-pay-${order.paymentStatus}`}>{order.paymentStatus === 'paid' ? `Ödendi (${order.paidMethod === 'cash' ? 'nakit' : 'kart'})` : 'Ödenmedi'}</dd></div>
      </dl>

      {!finished && (
        <div className="ff-actions">
          {order.type === 'delivery' && ['pending', 'awaiting_handoff'].includes(order.status) && (
            <div className="ff-courier">
              <input className="input" value={courier} maxLength={80} placeholder="Kurye adı" aria-label={`#${order.orderNumber} kurye adı`} onChange={event => setCourier(event.target.value)} />
              <button type="button" className="pos-btn pos-btn-ghost ff-assign" disabled={busy || courier.trim().length < 2} onClick={() => run(() => backend.assignCourier(order.id, courier.trim()))}>Ata</button>
            </div>
          )}
          {order.courierName && order.status === 'handed_to_courier' && <p className="pos-muted">Kurye: {order.courierName}</p>}
          {next && <button type="button" className="pos-btn pos-btn-primary ff-next" disabled={busy} onClick={advance}>{next.label}</button>}
          {!next && order.status === 'pending' && <p className="pos-muted">Mutfak hazır deyince teslimat adımı açılır.</p>}
        </div>
      )}
      {order.status !== 'cancelled' && order.paymentStatus === 'unpaid' && (
        <div className="ff-pay-actions">
          <button type="button" className="pos-btn pos-btn-ghost ff-pay-cash" disabled={busy} onClick={() => pay('cash')}>Nakit alındı</button>
          <button type="button" className="pos-btn pos-btn-ghost ff-pay-card" disabled={busy} onClick={() => pay('card')}>Kartla alındı</button>
        </div>
      )}
      {canCancel(order, role) && <button type="button" className="ff-cancel" disabled={busy} onClick={cancel}>Siparişi iptal et</button>}
    </li>
  )
}

function Board({ backend, role }) {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('incoming')

  const load = useCallback(async () => {
    try {
      setOrders(await backend.listFulfillmentOrders())
      setError(false)
    } catch {
      setError(true)
    }
  }, [backend])
  const { connection, refresh } = useOrderSync(backend, load, REFRESH_MS)
  const groups = useMemo(() => groupFulfillment(orders ?? []), [orders])

  const run = useCallback(async action => {
    setBusy(true)
    try {
      const result = await action()
      if (result.state !== 'confirmed') toast.error(statusErrorMessage(result.code))
    } finally {
      setBusy(false)
      refresh()
    }
  }, [refresh])

  return (
    <main className="ff-page fade-in">
      <div className="ff-toolbar">
        <h1 className="pos-title">Paket ve Kurye</h1>
        {connection === 'disconnected' && <span className="pos-muted" role="status">Bağlantı koptu, yeniden deneniyor…</span>}
      </div>
      {error && <p className="pos-alert" role="alert">Siparişler yüklenemedi. Bağlantı gelince otomatik yenilenecek.</p>}
      {!orders && !error && <div className="loading-screen" role="status"><div className="spinner" />Siparişler yükleniyor…</div>}
      {orders && (
        <>
          <div className="pos-chips ff-tabs" role="tablist">
            {COLUMNS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={`pos-chip${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>{label} ({groups[key].length})</button>
            ))}
          </div>
          <div className="ff-board">
            {COLUMNS.map(([key, label]) => (
              <section key={key} className={`ff-column ff-column-${key}${tab === key ? ' active' : ''}`} aria-label={label}>
                <h2>{label} <span>{groups[key].length}</span></h2>
                <ul>{groups[key].map(order => <OrderCard key={order.id} order={order} role={role} busy={busy} run={run} backend={backend} />)}</ul>
                {!groups[key].length && <p className="pos-muted ff-empty">Sipariş yok</p>}
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  )
}

export default function FulfillmentApp() {
  const session = usePosSession({ demoStaff: DEMO_STAFF })
  const { mode, staff, backend } = session
  return (
    <PosGate session={session} area={AREA}>
      <div className="pos-app">
        <PosHeader subtitle="Paket ve Kurye" staff={staff} onSignOut={session.signOut} />
        {mode === 'demo'
          ? <p className="pos-alert ff-page" role="status">Paket ve kurye ekranı demo modunda yoktur; veritabanı kurulumu gerekir.</p>
          : backend && <Board backend={backend} role={staff?.role} />}
      </div>
    </PosGate>
  )
}
