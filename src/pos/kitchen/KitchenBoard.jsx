import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChefHat, RefreshCw, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { STATUS_LABELS, statusErrorMessage } from '../messages'
import { useOrderSync } from '../useOrderSync'
import { KITCHEN_COLUMNS, findNewArrivals, groupByStatus } from './kitchenOrders'
import { createChime, readSoundPref, writeSoundPref } from './kitchenSound'
import OrderTicket from './OrderTicket'

const REFRESH_MS = 10000
const CLOCK_MS = 30000
const EMPTY_TEXT = {
  new: 'Yeni sipariş yok',
  preparing: 'Hazırlanan sipariş yok',
  ready: 'Bekleyen hazır sipariş yok',
  served: 'Son 2 saatte servis yok',
}

export default function KitchenBoard({ backend }) {
  const [orders, setOrders] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [tab, setTab] = useState('new')
  const [busy, setBusy] = useState(() => new Set())
  const [now, setNow] = useState(() => Date.now())
  const [soundOn, setSoundOn] = useState(readSoundPref)
  const [chime] = useState(createChime)
  const known = useRef(null)
  const soundRef = useRef(soundOn)

  const load = useCallback(async () => {
    try {
      const next = await backend.listKitchenOrders()
      const arrivals = findNewArrivals(known.current, next)
      known.current = new Set(next.map(order => order.id))
      if (arrivals.length) {
        if (soundRef.current) chime.play()
        toast(`Yeni sipariş · ${arrivals.map(order => order.tableLabel).join(', ')}`, { icon: '🔔' })
      }
      setOrders(next)
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [backend, chime])

  const { connection, refresh } = useOrderSync(backend, load, REFRESH_MS)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [])

  // Yenilenen sayfada tercih açık kalır; tarayıcı sesi ilk dokunuşla açar.
  useEffect(() => {
    if (!soundOn) return
    const unlock = () => chime.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [soundOn, chime])

  useEffect(() => { soundRef.current = soundOn }, [soundOn])

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    writeSoundPref(next)
    if (next) chime.unlock()
  }

  const advance = useCallback(async (order, status) => {
    setBusy(current => new Set(current).add(order.id))
    const result = await backend.setOrderStatus(order.id, status)
    if (result.state !== 'confirmed') toast.error(statusErrorMessage(result.code))
    await load()
    setBusy(current => { const next = new Set(current); next.delete(order.id); return next })
  }, [backend, load])

  const groups = useMemo(() => groupByStatus(orders ?? []), [orders])
  const demo = backend.mode === 'demo'
  const online = !loadError && connection === 'connected'
  const active = orders ? groups.new.length + groups.preparing.length + groups.ready.length : 0

  return (
    <main className="kt-page fade-in">
      <div className="kt-toolbar">
        <div>
          <h1 className="pos-title">Mutfak</h1>
          {orders && <p className="pos-muted" role="status">{active ? `${active} açık sipariş` : 'Açık sipariş yok'}</p>}
        </div>
        <div className="kt-toolbar-actions">
          <span className={`kt-connection${online ? ' online' : ' offline'}`}>
            {online ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}
            {online ? (demo ? 'Yerel demo' : 'Bağlı') : 'Bağlantı yok'}
          </span>
          <button type="button" className={`pos-icon-btn${soundOn ? '' : ' kt-muted'}`} onClick={toggleSound}
            aria-pressed={soundOn} aria-label={soundOn ? 'Yeni sipariş sesini kapat' : 'Yeni sipariş sesini aç'}>
            {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button type="button" className="pos-icon-btn" onClick={refresh} aria-label="Siparişleri yenile"><RefreshCw size={18} /></button>
        </div>
      </div>

      {loadError && (
        <p className="pos-alert" role="alert">
          {orders ? 'Sunucuya ulaşılamıyor. Son bilinen siparişler gösteriliyor; bağlantı gelince kaçırılanlar otomatik alınacak.' : 'Siparişler yüklenemedi. Otomatik olarak yeniden denenecek.'}
          <button type="button" onClick={refresh}>Tekrar dene</button>
        </p>
      )}
      {!loadError && connection === 'disconnected' && (
        <p className="pos-alert pos-alert-warn" role="status">Anlık bağlantı koptu. Siparişler {REFRESH_MS / 1000} saniyede bir kontrol ediliyor.</p>
      )}
      {!orders && !loadError && <div className="loading-screen" role="status"><div className="spinner" />Siparişler yükleniyor…</div>}

      {orders && (
        <>
          <div className="pos-segment kt-tabs" role="tablist" aria-label="Sipariş durumu">
            {KITCHEN_COLUMNS.map(status => (
              <button key={status} type="button" role="tab" aria-selected={tab === status} className={tab === status ? 'active' : ''} onClick={() => setTab(status)}>
                {STATUS_LABELS[status].split(' ')[0]} <span className="kt-tab-count">{groups[status].length}</span>
              </button>
            ))}
          </div>

          <div className="kt-board">
            {KITCHEN_COLUMNS.map(status => (
              <section key={status} className={`kt-column${tab === status ? ' active' : ''}`} aria-label={STATUS_LABELS[status]}>
                <h2 className="kt-column-head">
                  <span className={`pos-status pos-status-${status}`}>{STATUS_LABELS[status]}</span>
                  <span className="kt-column-count">{groups[status].length}</span>
                </h2>
                {groups[status].length ? (
                  <ul className="kt-tickets">
                    {groups[status].map(order => (
                      <OrderTicket key={order.id} order={order} now={now} busy={busy.has(order.id)} onAdvance={advance} />
                    ))}
                  </ul>
                ) : (
                  <div className="empty-state kt-empty">
                    <ChefHat size={32} aria-hidden="true" />
                    <h3>{EMPTY_TEXT[status]}</h3>
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  )
}
