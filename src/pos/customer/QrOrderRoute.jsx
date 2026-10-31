import { Link, useParams } from 'react-router-dom'
import { FlaskConical, MapPin } from 'lucide-react'
import { useOrderingConfig } from './useOnlineOrdering'
import MenuPage from '../../pages/MenuPage'
import { useQrOrdering } from './useQrOrdering'
import QrOrderLayer from './QrOrderLayer'
import '../ui/pos.css'
import './qr.css'

const NOTICES = {
  invalid: 'Bu masa kodu doğrulanamadı. Menüyü inceleyebilir, siparişinizi servis personelimize iletebilirsiniz.',
  unavailable: 'QR ile sipariş şu anda kapalı. Menüyü inceleyebilir, siparişinizi servis personelimize iletebilirsiniz.',
  unreachable: 'Sipariş sistemine ulaşılamıyor. Bağlantı gelince otomatik yeniden denenecek; dilerseniz siparişinizi personelimize iletebilirsiniz.',
}

// /masa/:kod — mevcut QR menünün aynısı, üzerine masa ve sipariş katmanı eklenir.
export default function QrOrderRoute() {
  const { tableToken } = useParams()
  const ordering = useQrOrdering(tableToken)
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
      {ready && !ordering.demo && onlineChannels && <Link className="qr-other-channels" to="/">Paket veya kurye siparişi için genel menü</Link>}
    </>
  )

  return <MenuPage ordering={ordering} tableChip={chip} orderBanner={banner} orderLayer={ready && <QrOrderLayer ordering={ordering} />} />
}
