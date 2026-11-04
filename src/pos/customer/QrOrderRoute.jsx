import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { FlaskConical, MapPin, QrCode, TriangleAlert } from 'lucide-react'
import { orderingBlockedMessage } from '../messages'
import { startQrVisit } from '../posApi'
import { useOrderingConfig } from './useOnlineOrdering'
import MenuPage from '../../pages/MenuPage'
import { useQrOrdering } from './useQrOrdering'
import { classifyVisit, demoTableIdOf, isLiveToken, loadVisit, saveVisit, visitStateKey } from './qrOrders'
import QrOrderLayer from './QrOrderLayer'
import '../ui/pos.css'
import './qr.css'

const NOTICES = {
  invalid: 'Bu masa kodu doğrulanamadı. Menüyü inceleyebilir, siparişinizi servis personelimize iletebilirsiniz.',
  unavailable: 'QR ile sipariş şu anda kapalı. Menüyü inceleyebilir, siparişinizi servis personelimize iletebilirsiniz.',
  unreachable: 'Sipariş sistemine ulaşılamıyor. Bağlantı gelince otomatik yeniden denenecek; dilerseniz siparişinizi personelimize iletebilirsiniz.',
}
const SCAN_NOTICES = {
  scan: 'Sipariş vermek için masanızdaki QR kodu telefonunuzun kamerasıyla okutun. Menüyü şimdiden inceleyebilirsiniz.',
  expired: 'Güvenliğiniz için masa doğrulamasının süresi doldu. Sipariş vermek için masadaki QR kodu tekrar okutun; sepetiniz korunur.',
}

function ScanNotice({ status }) {
  return (
    <div className="qr-banner qr-banner-scan" role="status">
      <QrCode size={16} aria-hidden="true" />
      <span>{SCAN_NOTICES[status]}</span>
    </div>
  )
}

// /masa/:kod — masadaki QR. Kod hemen 1 saatlik bilete çevrilir ve adresten silinir (/masa):
// sayfa yenilemek yeni bilet almaz, süreyi uzatmaz. Kontrolü sunucu yapar (pos_qr_visits migration'ı).
function QrScan({ token }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState(isLiveToken(token) ? 'loading' : 'invalid')

  useEffect(() => {
    if (!isLiveToken(token)) return undefined
    let active = true
    Promise.resolve(startQrVisit(token)).then(result => {
      if (!active) return
      const outcome = classifyVisit(result)
      const visit = outcome.state === 'ready' ? saveVisit(result.data) : null
      if (visit) navigate('/masa', { replace: true, state: { visit } })
      else setStatus(outcome.state === 'ready' ? 'unreachable' : outcome.state)
    }, () => { if (active) setStatus('unreachable') })
    return () => { active = false }
  }, [token, navigate])

  if (status === 'loading') return <div className="loading-screen" role="status"><div className="spinner" />Masanız doğrulanıyor…</div>
  const banner = NOTICES[status] ? <div className="qr-banner" role="status">{NOTICES[status]}</div> : <ScanNotice status="expired" />
  return <MenuPage orderBanner={banner} />
}

// /masa — bu sekmedeki bilet (veya demo kodu) ile menü + sipariş katmanı.
function QrOrderView({ token, stateKey }) {
  const ordering = useQrOrdering(token, { stateKey })
  const ready = ordering.status === 'ready'
  const onlineChannels = useOrderingConfig()

  const chip = ready && <span className="qr-table-chip"><MapPin size={13} aria-hidden="true" />{ordering.tableLabel}</span>
  const banner = (
    <>
      {ordering.demo && (
        <div className="qr-banner qr-banner-demo" role="note">
          <FlaskConical size={15} aria-hidden="true" />
          <span><strong>DEMO MODU</strong> · Sipariş gerçek mutfağa gitmez, veritabanına yazılmaz; yalnızca bu tarayıcıda kalır.</span>
        </div>
      )}
      {NOTICES[ordering.status] && <div className="qr-banner" role="status">{NOTICES[ordering.status]}</div>}
      {SCAN_NOTICES[ordering.status] && <ScanNotice status={ordering.status} />}
      {ready && ordering.blocked && <div className="qr-banner qr-banner-closed" role="status"><TriangleAlert size={15} aria-hidden="true" /><span>{orderingBlockedMessage(ordering.blocked)}</span></div>}
      {ready && !ordering.demo && onlineChannels && <Link className="qr-other-channels" to="/">Paket veya kurye siparişi için genel menü</Link>}
    </>
  )

  return <MenuPage ordering={ordering} tableChip={chip} orderBanner={banner} orderLayer={ready && <QrOrderLayer ordering={ordering} />} />
}

export default function QrOrderRoute() {
  const { tableToken } = useParams()
  const location = useLocation()
  // Bilet sekme belleğinde ve geçmiş kaydında tutulur; yenileme aynı bileti (aynı süreyle) kullanır.
  const [visit] = useState(() => (tableToken ? null : location.state?.visit ?? loadVisit()))
  if (tableToken && !demoTableIdOf(tableToken)) return <QrScan key={tableToken} token={tableToken} />
  if (tableToken) return <QrOrderView token={tableToken} />
  return <QrOrderView key={visit?.visit ?? 'none'} token={visit?.visit ?? null} stateKey={visit ? visitStateKey(visit.tableKey) : 'none'} />
}
