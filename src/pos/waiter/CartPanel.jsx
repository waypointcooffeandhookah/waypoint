import { useState } from 'react'
import { LoaderCircle, Minus, Plus, Send, ShoppingBag, StickyNote, TriangleAlert, X } from 'lucide-react'
import { formatCents, estimateTotalCents, priceToCents } from '../money'
import { cartCount, MAX_QUANTITY } from '../cart'
import { orderErrorMessage } from '../messages'

function CartLine({ line, locked, dispatch }) {
  const [editingNote, setEditingNote] = useState(Boolean(line.note))
  const setQuantity = quantity => dispatch({ type: 'setQuantity', lineId: line.lineId, quantity })
  return (
    <li className="wt-cart-line">
      <div className="wt-cart-line-main">
        <div className="wt-cart-line-info">
          <span className="wt-cart-line-name">{line.name}</span>
          <span className="wt-cart-line-price">{formatCents((priceToCents(line.price) ?? 0) * line.quantity)}</span>
        </div>
        <div className="pos-stepper" role="group" aria-label={`${line.name} adedi`}>
          <button type="button" onClick={() => setQuantity(line.quantity - 1)} disabled={locked} aria-label={line.quantity === 1 ? 'Ürünü çıkar' : 'Azalt'}>
            {line.quantity === 1 ? <X size={16} /> : <Minus size={16} />}
          </button>
          <span aria-live="polite">{line.quantity}</span>
          <button type="button" onClick={() => setQuantity(line.quantity + 1)} disabled={locked || line.quantity >= MAX_QUANTITY} aria-label="Artır"><Plus size={16} /></button>
        </div>
      </div>
      {editingNote ? (
        <input className="input wt-note-input" value={line.note} maxLength={200} disabled={locked} placeholder="Örn. az pişmiş, buzsuz…"
          aria-label={`${line.name} notu`} onChange={e => dispatch({ type: 'setLineNote', lineId: line.lineId, note: e.target.value })} />
      ) : (
        <button type="button" className="wt-note-toggle" onClick={() => setEditingNote(true)} disabled={locked}>
          <StickyNote size={13} aria-hidden="true" /> Not ekle
        </button>
      )}
    </li>
  )
}

export default function CartPanel({ cart, dispatch, submitState, rejectCode, demo, onSubmit, onReconcile }) {
  const locked = submitState === 'sending' || submitState === 'uncertain'
  const count = cartCount(cart)
  const total = estimateTotalCents(cart.lines)

  if (!cart.lines.length && submitState !== 'uncertain') {
    return (
      <div className="empty-state wt-cart-empty">
        <ShoppingBag size={40} aria-hidden="true" />
        <h3>Sepet boş</h3>
        <p>Menüden ürünlere dokunarak sepete ekleyin.</p>
      </div>
    )
  }

  return (
    <div className="wt-cart">
      <ul className="wt-cart-lines">
        {cart.lines.map(line => <CartLine key={line.lineId} line={line} locked={locked} dispatch={dispatch} />)}
      </ul>

      <label className="input-label" htmlFor="order-note">Sipariş notu</label>
      <textarea id="order-note" className="input wt-cart-note" rows={2} maxLength={300} value={cart.note} disabled={locked}
        placeholder="Mutfağa genel not (isteğe bağlı)" onChange={e => dispatch({ type: 'setNote', note: e.target.value })} />

      {submitState === 'rejected' && (
        <p className="pos-alert" role="alert"><TriangleAlert size={16} aria-hidden="true" /> {orderErrorMessage(rejectCode)}</p>
      )}
      {submitState === 'uncertain' && (
        <div className="pos-alert pos-alert-warn" role="alert">
          <p><TriangleAlert size={16} aria-hidden="true" /> <strong>Gönderim doğrulanamadı.</strong> Sipariş mutfağa ulaşmış olabilir. Tekrar göndermeyin; önce durumu kontrol edin.</p>
          <button type="button" className="pos-btn pos-btn-ghost" onClick={onReconcile}>Durumu kontrol et</button>
        </div>
      )}

      <div className="wt-cart-footer">
        <div className="wt-cart-total">
          <span>{count} ürün · tahmini</span>
          <strong>{formatCents(total)}</strong>
        </div>
        <button type="button" className="pos-btn pos-btn-primary wt-send" onClick={onSubmit} disabled={locked || !cart.lines.length}>
          {submitState === 'sending'
            ? <><LoaderCircle size={18} className="pos-spin" /> Gönderiliyor…</>
            : <><Send size={18} /> {demo ? 'Demo siparişi oluştur' : 'Mutfağa gönder'}</>}
        </button>
      </div>
    </div>
  )
}
