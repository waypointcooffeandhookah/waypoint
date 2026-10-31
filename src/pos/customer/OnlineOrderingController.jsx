import { memo, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import OnlineOrderLayer from './OnlineOrderLayer'
import { CHANNELS } from './onlineOrders'
import { useOnlineOrdering } from './useOnlineOrdering'

// Sipariş durumunu tutar, menünün yuvalarını üst bileşene verir. memo: üst bileşenin yenilenmesi
// bu bileşeni yenilemez, böylece onChange yalnızca sipariş durumu değişince çağrılır.
export default memo(function OnlineOrderingController({ config, onChange }) {
  const ordering = useOnlineOrdering(config)
  useEffect(() => {
    onChange({
      ordering,
      chip: (
        <button type="button" className="qr-table-chip qr-channel-chip" onClick={() => ordering.openSheet('channel')} aria-label="Sipariş türünü seç">
          {CHANNELS[ordering.channel] ?? 'Sipariş ver'}<ChevronDown size={13} aria-hidden="true" />
        </button>
      ),
      layer: <OnlineOrderLayer ordering={ordering} />,
    })
  }, [ordering, onChange])
  return null
})
