import { Link } from 'react-router-dom'
import { Bike, CircleCheck, ClipboardList, LoaderCircle, MapPin, QrCode, Receipt, Send, ShoppingBag, TriangleAlert, UtensilsCrossed, X } from 'lucide-react'
import { useDialog } from '../../utils/useDialog'
import { formatCents } from '../money'
import { orderErrorMessage } from '../messages'
import { CartLine } from './QrOrderLayer'
import TrackingCard from './TrackingCard'
import { CHANNELS, PAYMENT_LABELS } from './onlineOrders'
import './onlineStyles'

const CARDS = [
  { key: 'dine_in', Icon: UtensilsCrossed, text: 'Masanızdaki QR kodu okutun; sipariş masanızın adisyonuna eklenir.' },
  { key: 'pickup', Icon: ShoppingBag, text: 'Siparişinizi verin, hazır olunca restorandan teslim alın.' },
  { key: 'delivery', Icon: Bike, text: 'Adresinizi girin; bölge, ücret ve toplam gönderimden önce gösterilir.' },
]

function ChannelView({ ordering }) {
  const { config, channel } = ordering
  const cards = CARDS.filter(card => card.key === 'dine_in' || config[card.key])
  return (
    <div className="qr-sheet-body">
      <p className="qr-channel-lead">Nasıl sipariş vermek istersiniz?</p>
      <div className="qr-channels">
        {cards.map(({ key, Icon, text }) => (
          <button key={key} type="button" className={`qr-channel${channel === key ? ' active' : ''}`} data-channel={key} aria-pressed={channel === key} onClick={() => ordering.selectChannel(key)}>
            <Icon size={24} aria-hidden="true" />
            <span><strong>{CHANNELS[key]}</strong><small>{text}</small></span>
          </button>
        ))}
      </div>
      {channel === 'dine_in' && (
        <p className="pos-alert qr-scan-note" role="status">
          <QrCode size={18} aria-hidden="true" />
          <span>Masanızı güvenle doğrulamak için telefonunuzun kamerasıyla <strong>masadaki QR kodu</strong> okutun. Menü, masanız seçili olarak açılır.</span>
        </p>
      )}
      <button type="button" className="pos-btn pos-btn-ghost qr-channel-browse" onClick={ordering.closeSheet}>Yalnızca menüye göz at</button>
    </div>
  )
}

function Field({ ordering, name, label, optional, ...props }) {
  const id = `online-${name}`
  const error = ordering.errors[name]
  return (
    <div className={`qr-field qr-field-${name}`}>
      <label className="input-label" htmlFor={id}>{label}{optional && <span className="qr-optional"> (isteğe bağlı)</span>}</label>
      <input id={id} className="input" value={ordering.form[name]} disabled={ordering.locked} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
        onChange={event => ordering.setField(name, event.target.value)} {...props} />
      {error && <p id={`${id}-error`} className="qr-field-error" role="alert">{error}</p>}
    </div>
  )
}

function QuoteNote({ ordering }) {
  const { quote, summary } = ordering
  if (ordering.channel !== 'delivery') return null
  if (summary.problem === 'out_of_area') return <p className="pos-alert qr-rejected qr-out-of-area" role="alert"><TriangleAlert size={16} aria-hidden="true" /> Bu adres teslimat bölgemizin dışında. Paket / Gel Al seçeneğini kullanabilirsiniz.</p>
  if (summary.problem === 'quote_error') return <p className="pos-alert" role="alert">Teslimat bölgesi doğrulanamadı. Bağlantınızı kontrol edin.</p>
  if (summary.problem === 'below_minimum') return <p className="pos-alert qr-rejected qr-below-min" role="alert"><TriangleAlert size={16} aria-hidden="true" /> Bu bölge için asgari sipariş tutarı {formatCents(summary.minOrderCents)}.</p>
  if (quote?.state === 'ok') return <p className="qr-zone-ok"><MapPin size={14} aria-hidden="true" /> {quote.zoneName} teslimat bölgesindesiniz.</p>
  return null
}

function CheckoutView({ ordering }) {
  const { cart, count, dispatch, locked, submitState, rejectCode, channel, summary, subtotalCents } = ordering
  if (!cart.lines.length) {
    return (
      <div className="qr-empty">
        <ShoppingBag size={38} strokeWidth={1.5} aria-hidden="true" />
        <h3>Sepetiniz boş</h3>
        <p>Menüden ürün ekleyerek başlayın.</p>
      </div>
    )
  }
  return (
    <>
      <div className="qr-sheet-body">
        <ul className="qr-lines">
          {cart.lines.map(line => <CartLine key={line.lineId} line={line} locked={locked} dispatch={dispatch} />)}
        </ul>
        <label className="input-label" htmlFor="online-note">Hazırlık notu</label>
        <textarea id="online-note" className="input qr-order-note" rows={2} maxLength={300} value={cart.note} disabled={locked}
          placeholder="Tüm sipariş için not (isteğe bağlı)" onChange={event => dispatch({ type: 'setNote', note: event.target.value })} />

        <h3 className="qr-form-title">İletişim bilgileri</h3>
        <div className="qr-form">
          <Field ordering={ordering} name="name" label="Ad soyad" autoComplete="name" maxLength={80} />
          <Field ordering={ordering} name="phone" label="Telefon" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} placeholder="05xx xxx xx xx" />
        </div>
        {channel === 'delivery' && (
          <>
            <h3 className="qr-form-title">Teslimat adresi</h3>
            <div className="qr-form">
              <Field ordering={ordering} name="street" label="Sokak ve numara" autoComplete="street-address" maxLength={200} />
              <Field ordering={ordering} name="district" label="İl / ilçe" autoComplete="address-level2" maxLength={80} />
              <Field ordering={ordering} name="postalCode" label="Posta kodu" inputMode="numeric" autoComplete="postal-code" maxLength={5} />
              <div className="qr-form-row">
                <Field ordering={ordering} name="building" label="Bina" optional maxLength={20} />
                <Field ordering={ordering} name="floor" label="Kat" optional maxLength={20} />
                <Field ordering={ordering} name="door" label="Kapı" optional maxLength={20} />
              </div>
              <Field ordering={ordering} name="apartment" label="Apartman / site" optional maxLength={60} />
              <Field ordering={ordering} name="instructions" label="Teslimat notu" optional maxLength={300} />
            </div>
            <QuoteNote ordering={ordering} />
          </>
        )}
        <p className="qr-pay-note"><strong>{PAYMENT_LABELS[channel === 'pickup' ? 'pay_at_pickup' : 'cash_on_delivery']}.</strong> Online ödeme alınmaz; ödeme, personel tahsil edince işlenir.</p>
        <p className="qr-privacy">Ad, telefon ve adresiniz yalnızca bu siparişi hazırlamak ve teslim etmek için kullanılır; yalnızca yetkili personel görür, mutfak ekranında gösterilmez.</p>

        {submitState === 'rejected' && <p className="pos-alert qr-rejected" role="alert"><TriangleAlert size={16} aria-hidden="true" /> {orderErrorMessage(rejectCode)}</p>}
        {submitState === 'uncertain' && (
          <div className="pos-alert pos-alert-warn qr-uncertain" role="alert">
            <p><TriangleAlert size={16} aria-hidden="true" /> <strong>Siparişiniz doğrulanamadı.</strong> Ulaşmış olabilir, lütfen tekrar sipariş vermeyin. Önce durumu kontrol edin.</p>
            <button type="button" className="pos-btn pos-btn-ghost" onClick={ordering.reconcile}>Durumu kontrol et</button>
          </div>
        )}
      </div>

      <div className="qr-sheet-footer">
        <dl className="qr-checkout-totals">
          <div><dt>{count} ürün</dt><dd>{formatCents(subtotalCents)}</dd></div>
          {channel === 'delivery' && <div className="qr-fee"><dt>Teslimat ücreti</dt><dd>{summary.feeCents === null ? 'Adres doğrulanınca' : formatCents(summary.feeCents)}</dd></div>}
          <div className="qr-total"><dt>Toplam</dt><dd><strong>{summary.totalCents === null ? '—' : formatCents(summary.totalCents)}</strong></dd></div>
        </dl>
        <button type="button" className="pos-btn pos-btn-primary qr-send" onClick={ordering.submit} disabled={locked || !summary.ready}>
          {submitState === 'sending'
            ? <><LoaderCircle size={20} className="pos-spin" aria-hidden="true" /> Gönderiliyor…</>
            : <><Send size={19} aria-hidden="true" /> Sipariş Ver</>}
        </button>
      </div>
    </>
  )
}

function Confirmation({ ordering }) {
  const { confirmed } = ordering
  return (
    <div className="qr-confirm" role="status">
      <CircleCheck size={54} strokeWidth={1.5} aria-hidden="true" />
      <h3>Siparişiniz alındı</h3>
      <p className="qr-confirm-number">#{confirmed.orderNumber}</p>
      <p className="qr-confirm-total">{formatCents(confirmed.totalCents)}</p>
      {confirmed.deliveryFeeCents > 0 && <p className="qr-confirm-text">{formatCents(confirmed.deliveryFeeCents)} teslimat ücreti dahil.</p>}
      <p className="qr-confirm-text">{CHANNELS[confirmed.fulfillmentType]} · {PAYMENT_LABELS[confirmed.paymentMethod]}. Durumu takip bağlantısından izleyebilirsiniz; bağlantıyı saklayın.</p>
      <div className="qr-confirm-actions">
        <Link className="pos-btn pos-btn-ghost qr-track-link" to={`/siparis/${confirmed.trackingToken}`}><ClipboardList size={17} aria-hidden="true" /> Siparişimi takip et</Link>
        <button type="button" className="pos-btn pos-btn-primary" onClick={ordering.closeSheet}>Menüye dön</button>
      </div>
    </div>
  )
}

function OrdersView({ ordering }) {
  const { orders, tracked } = ordering
  if (!orders.length) {
    return (
      <div className="qr-empty">
        <Receipt size={38} strokeWidth={1.5} aria-hidden="true" />
        <h3>Henüz siparişiniz yok</h3>
        <p>Bu cihazdan verdiğiniz siparişler burada görünür.</p>
      </div>
    )
  }
  return (
    <div className="qr-sheet-body">
      <ol className="qr-orders">
        {[...orders].reverse().map(order => (
          <li key={order.token}>
            {tracked[order.token]
              ? <TrackingCard order={tracked[order.token]} />
              : <div className="qr-order"><span className="qr-order-number">#{order.number}</span> <span className="pos-muted">Durum yükleniyor…</span></div>}
            <Link className="qr-track-open" to={`/siparis/${order.token}`}>Takip sayfasını aç</Link>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Sheet({ ordering }) {
  const { sheet, confirmed, count, channel } = ordering
  const dialogRef = useDialog(ordering.closeSheet)
  return (
    <div className="ipek-modal-backdrop-enter modal-backdrop" onClick={ordering.closeSheet}>
      <div className="ipek-modal-sheet-enter modal-sheet qr-sheet" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Sipariş" onClick={event => event.stopPropagation()}>
        <div className="sheet-handle-wrap"><div className="sheet-handle" /></div>
        <div className="qr-sheet-head">
          <h2 className="qr-sheet-title">{sheet === 'channel' ? 'Sipariş türü' : CHANNELS[channel] ?? 'Sipariş'}</h2>
          {sheet !== 'channel' && !confirmed && <button type="button" className="pos-btn pos-btn-ghost qr-switch" disabled={ordering.locked} onClick={() => ordering.openSheet('channel')}>Değiştir</button>}
          <button type="button" className="pos-icon-btn" onClick={ordering.closeSheet} aria-label="Kapat"><X size={18} /></button>
        </div>
        {confirmed ? <Confirmation ordering={ordering} /> : sheet === 'channel' ? <ChannelView ordering={ordering} /> : (
          <>
            <div className="pos-segment qr-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={sheet === 'cart'} className={sheet === 'cart' ? 'active' : ''} onClick={() => ordering.openSheet('cart')}>
                <ShoppingBag size={15} aria-hidden="true" /> Sepet{count ? ` (${count})` : ''}
              </button>
              <button type="button" role="tab" aria-selected={sheet === 'orders'} className={sheet === 'orders' ? 'active' : ''} onClick={() => ordering.openSheet('orders')}>
                <ClipboardList size={15} aria-hidden="true" /> Siparişlerim
              </button>
            </div>
            {sheet === 'cart' ? <CheckoutView ordering={ordering} /> : <OrdersView ordering={ordering} />}
          </>
        )}
      </div>
    </div>
  )
}

export default function OnlineOrderLayer({ ordering }) {
  const { count, subtotalCents, hasOrders, sheet, channel } = ordering
  const canCheckout = channel === 'pickup' || channel === 'delivery'
  return (
    <>
      {((count > 0 && canCheckout) || hasOrders) && !sheet && (
        <div className="qr-bar">
          {hasOrders && (
            <button type="button" className="qr-bar-orders" onClick={() => ordering.openSheet('orders')} aria-label="Siparişlerim">
              <ClipboardList size={20} aria-hidden="true" />
            </button>
          )}
          {count > 0 && canCheckout && (
            <button type="button" className="qr-bar-cart" onClick={() => ordering.openSheet('cart')}>
              <span className="qr-bar-count">{count}</span>
              <span>Sepeti gör</span>
              <strong>{formatCents(subtotalCents)}</strong>
            </button>
          )}
        </div>
      )}
      {sheet && <Sheet ordering={ordering} />}
    </>
  )
}
