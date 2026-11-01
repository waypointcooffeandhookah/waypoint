import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { BLOCK_LABELS, startOfToday, summarizeOrders } from './adminData'
import { useAdminSync } from './useAdminSync'

function Stat({ value, label, to }) {
  return (
    <Link to={to} className="ad-stat">
      <strong>{value ?? '—'}</strong>
      <span>{label}</span>
    </Link>
  )
}

function Channel({ label, open }) {
  return <li className={`ad-channel${open ? ' open' : ''}`}><span className="ad-dot" aria-hidden="true" />{label}<em>{open ? 'Açık' : 'Kapalı'}</em></li>
}

export default function DashboardSection() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    const [orders, bills, online, config] = await Promise.all([
      supabase.from('orders').select('status, fulfillment_type').gte('created_at', startOfToday()).limit(2000),
      supabase.from('bill_summaries').select('bill_id').eq('status', 'open'),
      supabase.from('order_fulfillments').select('order_id').in('status', ['pending', 'awaiting_handoff', 'handed_to_courier']),
      supabase.rpc('get_ordering_config'),
    ])
    if (orders.error || bills.error || online.error || config.error) return setError(true)
    setError(false)
    setData({ summary: summarizeOrders(orders.data), openTables: bills.data.length, activeOnline: online.data.length, config: config.data })
  }, [])
  const { connection } = useAdminSync(load)
  const { summary, config } = data ?? {}

  return (
    <main className="ad-page fade-in">
      <div className="ad-page-head">
        <h1 className="pos-title">Panel</h1>
        <span className={`ad-live${connection === 'connected' ? ' on' : ''}`} role="status"><span className="ad-dot" aria-hidden="true" />{connection === 'connected' ? 'Canlı' : 'Bağlanıyor…'}</span>
      </div>
      {error && <p className="pos-alert" role="alert">Veriler alınamadı. Otomatik olarak yeniden denenecek.</p>}
      {!data && !error && <div className="loading-screen" role="status"><div className="spinner" />Yükleniyor…</div>}
      {data && (
        <>
          {config.blocked && <p className="pos-alert pos-alert-warn ad-blocked" role="status"><strong>{BLOCK_LABELS[config.blocked]}.</strong> Müşteriler yeni sipariş veremiyor; garson siparişi sürüyor.</p>}
          <div className="ad-stats">
            <Stat value={summary.total} label="Bugünkü sipariş" to="/admin/siparisler" />
            <Stat value={summary.new + summary.preparing} label="Mutfakta" to="/mutfak" />
            <Stat value={summary.ready} label="Hazır, bekliyor" to="/admin/siparisler" />
            <Stat value={data.openTables} label="Açık masa" to="/admin/masalar" />
            <Stat value={data.activeOnline} label="Açık paket / kurye" to="/admin/teslimat" />
            <Stat value={summary.cancelled} label="Bugün iptal" to="/admin/siparisler" />
          </div>
          <section className="ad-card">
            <div className="ad-card-head"><h2>Sipariş kanalları</h2><Link to="/admin/ayarlar">Ayarlar</Link></div>
            <ul className="ad-channels">
              <Channel label="Masada Sipariş" open={config.dine_in} />
              <Channel label="Paket / Gel Al" open={config.pickup} />
              <Channel label="Kurye ile Teslimat" open={config.delivery} />
            </ul>
          </section>
          <section className="ad-card">
            <div className="ad-card-head"><h2>Bugünün dağılımı</h2></div>
            <ul className="ad-breakdown">
              <li><span>Masa</span><strong>{summary.dine_in}</strong></li>
              <li><span>Paket</span><strong>{summary.pickup}</strong></li>
              <li><span>Kurye</span><strong>{summary.delivery}</strong></li>
              <li><span>Tamamlanan</span><strong>{summary.served}</strong></li>
            </ul>
          </section>
        </>
      )}
    </main>
  )
}
