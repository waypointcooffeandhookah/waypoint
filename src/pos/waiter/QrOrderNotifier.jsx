import { useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { useOrderSync } from '../useOrderSync'
import { findNewArrivals } from '../kitchen/kitchenOrders'

const REFRESH_MS = 15000

// Garson hangi ekranda olursa olsun yeni müşteri siparişinden haberdar olur.
export default function QrOrderNotifier({ backend }) {
  const known = useRef(null)
  const load = useCallback(async () => {
    try {
      const orders = await backend.listKitchenOrders()
      const arrivals = findNewArrivals(known.current, orders).filter(order => order.source === 'qr')
      known.current = new Set(orders.map(order => order.id))
      for (const order of arrivals) toast(`Yeni QR sipariş · ${order.tableLabel}`, { icon: '🔔' })
    } catch { /* Masa ekranları bağlantı hatasını zaten gösterir. */ }
  }, [backend])
  useOrderSync(backend, load, REFRESH_MS)
  return null
}
