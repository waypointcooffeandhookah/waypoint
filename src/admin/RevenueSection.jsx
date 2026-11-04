import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { formatCents } from '../pos/money'
import { CHANNEL_LABELS, METHOD_LABELS, PERIODS, dateKey, fetchAllRows, periodRange, summarizeRevenue } from './revenue'

const money = value => formatCents(value)
const dayLabel = key => new Date(`${key}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' })

function Figure({ label, value, note }) {
  return (
    <div className="ad-stat ad-figure">
      <strong>{value}</strong>
      <span>{label}</span>
      {note && <small>{note}</small>}
    </div>
  )
}

// Ciro: yalnızca okur. Müşteri adı/telefonu/adresi hiç istenmez.
export default function RevenueSection() {
  const [period, setPeriod] = useState('today')
  const [custom, setCustom] = useState(() => ({ from: dateKey(new Date()), to: dateKey(new Date()) }))
  const [now, setNow] = useState(() => new Date())
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState({ key: null, report: null, error: false })
  const range = useMemo(() => periodRange(period, now, custom), [period, now, custom])
  const key = range.error ? null : `${range.from}|${range.to}|${tick}`
  const state = result.key !== key ? 'loading' : result.error ? 'error' : 'ready'
  const report = result.report
  const refresh = () => { setNow(new Date()); setTick(value => value + 1) }

  const fetchReport = useCallback(async () => {
    const [orders, payments, onlinePaid] = await Promise.all([
      fetchAllRows(() => supabase.from('orders')
        .select('id, status, fulfillment_type, subtotal_cents, created_at, order_items(item_name, quantity, line_total_cents), order_fulfillments(delivery_fee_cents)')
        .gte('created_at', range.from).lt('created_at', range.to).order('created_at').order('id')),
      fetchAllRows(() => supabase.from('payments').select('id, amount_cents, method')
        .gte('created_at', range.from).lt('created_at', range.to).order('created_at').order('id')),
      fetchAllRows(() => supabase.from('order_fulfillments').select('order_id, total_cents, paid_method')
        .eq('payment_status', 'paid').gte('paid_at', range.from).lt('paid_at', range.to).order('paid_at').order('order_id')),
    ])
    return summarizeRevenue({ orders, payments, onlinePaid })
  }, [range.from, range.to])

  useEffect(() => {
    if (!key) return undefined
    let active = true
    fetchReport().then(
      next => { if (active) setResult({ key, report: next, error: false }) },
      () => { if (active) setResult({ key, report: null, error: true }) },
    )
    return () => { active = false }
  }, [key, fetchReport])

  return (
    <main className="ad-page fade-in" aria-busy={state === 'loading'}>
      <div className="ad-page-head">
        <h1 className="pos-title">Ciro</h1>
        <button type="button" className="pos-btn pos-btn-ghost ad-refresh" onClick={refresh} disabled={state === 'loading'}>
          <RefreshCw size={15} aria-hidden="true" /> Yenile
        </button>
      </div>
      <div className="pos-chips" role="tablist" aria-label="Dönem">
        {PERIODS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={period === key} className={`pos-chip${period === key ? ' active' : ''}`} onClick={() => setPeriod(key)}>{label}</button>)}
      </div>
      {period === 'custom' && (
        <div className="ad-range">
          <label className="ad-field"><span className="input-label">Başlangıç</span><input className="input" type="date" value={custom.from} max={custom.to} onChange={event => setCustom(value => ({ ...value, from: event.target.value }))} /></label>
          <label className="ad-field"><span className="input-label">Bitiş</span><input className="input" type="date" value={custom.to} min={custom.from} onChange={event => setCustom(value => ({ ...value, to: event.target.value }))} /></label>
        </div>
      )}
      {range.error && <p className="pos-alert" role="alert">{range.error}</p>}
      {state === 'error' && <p className="pos-alert" role="alert">Ciro verileri alınamadı. Bağlantınızı kontrol edip Yenile'ye basın.</p>}
      {state === 'loading' && !report && <div className="loading-screen" role="status"><div className="spinner" />Hesaplanıyor…</div>}
      {report && !range.error && state !== 'error' && (
        <>
          <div className={`ad-stats ad-revenue-stats${state === 'loading' ? ' ad-stale' : ''}`}>
            <Figure label="Tahsil edilen" value={money(report.collected)} note="Kasaya giren: masa ödemeleri + paket/kurye ödemeleri" />
            <Figure label="Satış (sipariş tutarı)" value={money(report.sales)} note="İptaller hariç, teslimat ücreti hariç" />
            <Figure label="Sipariş" value={report.orderCount} note={`Ortalama ${money(report.averageOrder)}`} />
            <Figure label="Teslimat ücreti" value={money(report.deliveryFees)} />
            <Figure label="İptal" value={report.cancelled} note={money(report.cancelledAmount)} />
            <Figure label="Nakit / Kart" value={`${money(report.byMethod.cash)} / ${money(report.byMethod.card)}`} />
          </div>
          <p className="pos-muted ad-revenue-note">Satış ile tahsilat farklı olabilir: açık adisyonlar henüz ödenmemiştir; önceki günün adisyonu bugün ödenmiş olabilir.</p>

          <section className="ad-card">
            <div className="ad-card-head"><h2>Ödeme yöntemi</h2></div>
            <ul className="ad-breakdown">
              {Object.entries(METHOD_LABELS).map(([key, label]) => <li key={key}><span>{label}</span><strong>{money(report.byMethod[key])}</strong></li>)}
              {report.byMethod.other > 0 && <li><span>Diğer</span><strong>{money(report.byMethod.other)}</strong></li>}
              <li className="ad-breakdown-sub"><span>Masa adisyonları</span><strong>{money(report.tableCollected)}</strong></li>
              <li className="ad-breakdown-sub"><span>Paket / kurye</span><strong>{money(report.onlineCollected)}</strong></li>
            </ul>
          </section>

          <section className="ad-card">
            <div className="ad-card-head"><h2>Kanal</h2></div>
            <ul className="ad-breakdown">
              {Object.entries(CHANNEL_LABELS).map(([key, label]) => (
                <li key={key}><span>{label} · {report.channels[key].orders} sipariş</span><strong>{money(report.channels[key].sales)}</strong></li>
              ))}
            </ul>
          </section>

          <section className="ad-card">
            <div className="ad-card-head"><h2>En çok satanlar</h2></div>
            {report.topProducts.length ? (
              <ol className="ad-top">
                {report.topProducts.map((product, index) => (
                  <li key={product.name}><b>{index + 1}.</b><span>{product.name}</span><em>{product.quantity} adet</em><strong>{money(product.sales)}</strong></li>
                ))}
              </ol>
            ) : <p className="pos-muted ad-empty">Bu dönemde satış yok.</p>}
          </section>

          {report.daily.length > 1 && (
            <section className="ad-card">
              <div className="ad-card-head"><h2>Günlük</h2></div>
              <ul className="ad-breakdown">
                {report.daily.map(day => <li key={day.day}><span>{dayLabel(day.day)} · {day.orders} sipariş</span><strong>{money(day.sales)}</strong></li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  )
}
