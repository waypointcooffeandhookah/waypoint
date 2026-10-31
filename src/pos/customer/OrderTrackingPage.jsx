import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { getOrderTracking } from '../posApi'
import { useOrderSync } from '../useOrderSync'
import TrackingCard from './TrackingCard'
import { isTrackingToken, mapTracking } from './onlineOrders'
import './onlineStyles'

const POLL_MS = 15000
const pollOnly = { subscribe: (_change, connection) => { connection('connected'); return () => {} } }

// Hesap gerektirmeyen takip sayfası: bağlantıdaki gizli kod yalnızca bu siparişi gösterir.
export default function OrderTrackingPage() {
  const { token } = useParams()
  const [order, setOrder] = useState(null)
  const [state, setState] = useState(isTrackingToken(token) ? 'loading' : 'invalid')

  const load = useCallback(async () => {
    if (!isTrackingToken(token)) return
    try {
      const { data, error } = await getOrderTracking(token)
      if (error) return setState(/invalid_tracking/.test(error.message ?? '') ? 'invalid' : 'error')
      setOrder(mapTracking(data))
      setState('ready')
    } catch {
      setState('error')
    }
  }, [token])
  useOrderSync(pollOnly, load, POLL_MS)

  return (
    <main className="qr-track-page">
      <header className="qr-track-header">
        <img src={`${import.meta.env.BASE_URL}logo-balanced.png`} alt="" className="pos-brand-logo" />
        <div><span className="pos-brand-name">WAYPOINT</span><h1 className="qr-track-title">Sipariş Takibi</h1></div>
      </header>
      {state === 'loading' && <div className="loading-screen" role="status"><div className="spinner" />Sipariş yükleniyor…</div>}
      {state === 'invalid' && <p className="pos-alert" role="alert">Bu takip bağlantısı geçersiz. Bağlantıyı kontrol edin veya restoranımızla iletişime geçin.</p>}
      {state === 'error' && <p className="pos-alert" role="alert">Durum şu anda alınamadı. Bağlantı gelince otomatik yenilenecek.</p>}
      {order && <TrackingCard order={order} />}
      {order && <p className="qr-privacy">Durum kendiliğinden yenilenir. Bu bağlantıyı yalnızca güvendiğiniz kişilerle paylaşın.</p>}
      <Link className="qr-track-open" to="/"><ArrowLeft size={15} aria-hidden="true" /> Menüye dön</Link>
    </main>
  )
}
