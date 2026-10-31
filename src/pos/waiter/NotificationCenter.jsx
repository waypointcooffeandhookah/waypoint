import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Bell, BellRing, Check, CheckCheck, Volume2, VolumeX, WifiOff, X } from 'lucide-react'
import { useDialog } from '../../utils/useDialog'
import { STATUS_LABELS, formatClock } from '../messages'
import { notificationLines, notificationTitle } from './notifications'
import { useWaiterNotifications } from './useWaiterNotifications'

const BROWSER_NOTES = {
  insecure: 'Tarayıcı bildirimleri HTTPS gerektirir. Bu adreste uygulama içi bildirimler çalışır.',
  unsupported: 'Bu tarayıcı bildirim desteklemiyor. Uygulama içi bildirimler çalışır.',
  denied: 'Bildirim izni reddedildi; tarayıcı ayarlarından açabilirsiniz.',
  granted: 'Açık. Panel açıkken arka plandaki sekmede gösterilir; tarayıcı kapalıyken çalışmaz.',
}

function Banner({ item, onOpen, onDismiss }) {
  return (
    <div className="wt-notify-banner" role="alert">
      <BellRing size={20} aria-hidden="true" className="wt-notify-banner-icon" />
      <div className="wt-notify-banner-body">
        <strong>{notificationTitle(item)}</strong>
        {notificationLines(item).map((line, index) => <span key={index}>{line}</span>)}
        <small>Mutfaktan teslim alabilirsiniz. · {formatClock(item.at)}</small>
      </div>
      <div className="wt-notify-banner-actions">
        <button type="button" className="pos-btn pos-btn-primary" onClick={() => onOpen(item)}>Masayı aç</button>
        <button type="button" className="pos-icon-btn" onClick={() => onDismiss(item.id)} aria-label="Uyarıyı kapat"><X size={16} /></button>
      </div>
    </div>
  )
}

function Panel({ center, onOpen, onClose }) {
  const dialogRef = useDialog(onClose)
  const { items, read, loaded, loadError, connection, unread } = center
  return (
    <>
      <div className="wt-notify-backdrop" onClick={onClose} aria-hidden="true" />
      <section className="wt-notify-panel" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Bildirimler">
        <div className="wt-notify-head">
          <h2 className="pos-title">Bildirimler</h2>
          <button type="button" className="pos-btn pos-btn-ghost wt-notify-all" onClick={center.markAllRead} disabled={!unread}><CheckCheck size={15} aria-hidden="true" /> Tümü okundu</button>
          <button type="button" className="pos-icon-btn wt-notify-close" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </div>

        {(connection === 'disconnected' || loadError) && (
          <p className="pos-alert wt-notify-offline" role="status"><WifiOff size={15} aria-hidden="true" /> Bağlantı koptu. Bağlanınca kaçırılan bildirimler alınır.</p>
        )}

        <div className="wt-notify-settings">
          <button type="button" className="wt-notify-sound" aria-pressed={center.soundOn} onClick={center.toggleSound}>
            {center.soundOn ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
            <span>Bildirim sesi: {center.soundOn ? 'Açık' : 'Kapalı'}</span>
          </button>
          <div className="wt-notify-browser">
            {center.browserStatus === 'default'
              ? <button type="button" className="pos-btn pos-btn-ghost" onClick={center.requestBrowserPermission}>Tarayıcı bildirimlerine izin ver</button>
              : <p className="pos-muted">{BROWSER_NOTES[center.browserStatus]}</p>}
          </div>
        </div>

        <ol className="wt-notify-list">
          {items.map(item => {
            const isRead = read.includes(item.id) || item.status !== 'ready'
            return (
              <li key={item.id} data-id={item.id} className={`wt-notify-item${isRead ? '' : ' unread'}`}>
                <div className="wt-notify-item-head">
                  <strong>{notificationTitle(item)}</strong>
                  <time>{formatClock(item.at)}</time>
                </div>
                <ul className="wt-notify-lines">{notificationLines(item).map((line, index) => <li key={index}>{line}</li>)}</ul>
                {item.status === 'ready'
                  ? <p className="wt-notify-note">Mutfaktan teslim alabilirsiniz. · #{item.orderNumber}</p>
                  : <p className="wt-notify-note"><span className={`pos-status pos-status-${item.status}`}>{STATUS_LABELS[item.status]}</span> · #{item.orderNumber}</p>}
                <div className="wt-notify-actions">
                  <button type="button" className="pos-btn pos-btn-ghost" onClick={() => onOpen(item)}>Masayı aç</button>
                  {item.status === 'ready' && <button type="button" className="pos-btn pos-btn-primary wt-notify-serve" onClick={() => center.serve(item)}>Servis edildi</button>}
                  {!isRead && <button type="button" className="pos-icon-btn wt-notify-read" onClick={() => center.markRead(item.id)} aria-label="Okundu işaretle"><Check size={16} /></button>}
                </div>
              </li>
            )
          })}
        </ol>
        {loaded && !items.length && (
          <div className="empty-state wt-notify-empty">
            <Bell size={36} aria-hidden="true" />
            <h3>Henüz bildirim yok</h3>
            <p>Mutfak bir siparişi hazırladığında burada görünür. Son 12 saat listelenir.</p>
          </div>
        )}
      </section>
    </>
  )
}

export default function NotificationCenter({ backend, staff }) {
  const center = useWaiterNotifications(backend, staff.id)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  function openTable(item) {
    center.markRead(item.id)
    setOpen(false)
    navigate(`/garson/masa/${item.tableId}`, { state: { openBill: true } })
  }

  return (
    <>
      <button type="button" className="pos-icon-btn wt-bell" onClick={() => setOpen(true)} aria-haspopup="dialog"
        aria-label={center.unread ? `Bildirimler, ${center.unread} okunmamış` : 'Bildirimler'}>
        {center.unread ? <BellRing size={18} /> : <Bell size={18} />}
        {center.unread > 0 && <span className="wt-notify-count">{center.unread > 99 ? '99+' : center.unread}</span>}
      </button>
      {/* Başlıktaki backdrop-filter sabit konumu bozar; katmanlar body'ye taşınır. */}
      {createPortal(
        <>
          {!open && center.banners.length > 0 && (
            <div className="wt-notify-banners">
              {center.banners.map(item => <Banner key={item.id} item={item} onOpen={openTable} onDismiss={center.dismissBanner} />)}
              {center.hiddenBanners > 0 && <button type="button" className="wt-notify-more" onClick={() => setOpen(true)}>+{center.hiddenBanners} hazır sipariş daha</button>}
            </div>
          )}
          {open && <Panel center={center} onOpen={openTable} onClose={() => setOpen(false)} />}
        </>,
        document.body,
      )}
    </>
  )
}
