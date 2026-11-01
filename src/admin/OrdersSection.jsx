import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { formatCents } from '../pos/money'
import { STATUS_LABELS, formatClock } from '../pos/messages'
import { FULFILLMENT_LABELS } from '../pos/kitchen/kitchenOrders'
import { startOfToday } from './adminData'
import { useAdminSync } from './useAdminSync'

const FILTERS = [['all', 'Tümü'], ['dine_in', 'Masa'], ['pickup', 'Paket'], ['delivery', 'Kurye']]

// Müşteri bilgisi burada yoktur; adres ve iletişim yalnızca teslimat ekranındadır.
export default function OrdersSection() {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    const { data, error: failure } = await supabase.from('orders')
      .select('id, order_number, status, fulfillment_type, subtotal_cents, created_at, restaurant_tables(label), order_items(position, item_name, quantity)')
      .gte('created_at', startOfToday()).order('created_at', { ascending: false }).limit(100)
    if (failure) return setError(true)
    setError(false)
    setOrders(data)
  }, [])
  useAdminSync(load)
  const visible = (orders ?? []).filter(order => filter === 'all' || order.fulfillment_type === filter)

  return (
    <main className="ad-page fade-in">
      <div className="ad-page-head">
        <h1 className="pos-title">Siparişler</h1>
        <div className="ad-head-links">
          <Link className="pos-btn pos-btn-ghost" to="/siparisler">Paket ve kurye ekranı</Link>
          <Link className="pos-btn pos-btn-ghost" to="/mutfak">Mutfak</Link>
          <Link className="pos-btn pos-btn-ghost" to="/garson">Garson</Link>
        </div>
      </div>
      <div className="pos-chips" role="tablist" aria-label="Sipariş türü">
        {FILTERS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={filter === key} className={`pos-chip${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>{label}</button>)}
      </div>
      {error && <p className="pos-alert" role="alert">Siparişler alınamadı. Otomatik olarak yeniden denenecek.</p>}
      {!orders && !error && <div className="loading-screen" role="status"><div className="spinner" />Yükleniyor…</div>}
      {orders && !visible.length && <p className="pos-muted ad-empty">Bugün bu türde sipariş yok.</p>}
      <ul className="ad-orders">
        {visible.map(order => (
          <li key={order.id} className="ad-order" data-order={order.order_number}>
            <div className="ad-order-head">
              <strong>#{order.order_number}</strong>
              <span>{FULFILLMENT_LABELS[order.fulfillment_type] ?? order.restaurant_tables?.label}</span>
              <time>{formatClock(order.created_at)}</time>
              <span className={`pos-status pos-status-${order.status}`}>{STATUS_LABELS[order.status]}</span>
            </div>
            <p>{[...order.order_items].sort((a, b) => a.position - b.position).map(item => `${item.quantity}× ${item.item_name}`).join(' · ')}</p>
            <em>{formatCents(Number(order.subtotal_cents))}</em>
          </li>
        ))}
      </ul>
    </main>
  )
}
