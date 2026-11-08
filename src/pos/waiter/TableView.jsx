import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Pencil, Receipt, ShoppingBag, UtensilsCrossed, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { createSubmission, savePending, clearPending } from '../orderSubmission'
import { cartCount, emptyCart, toOrderPayloadLines } from '../cart'
import { formatCents, estimateTotalCents } from '../money'
import { statusErrorMessage } from '../messages'
import { randomUUID } from '../../utils/uuid'
import { METHOD_LABELS } from './billPayment'
import { useOrderSync } from '../useOrderSync'
import CatalogPanel from './CatalogPanel'
import CartPanel from './CartPanel'
import BillPanel from './BillPanel'

const REFRESH_MS = 15000

export default function TableView({ backend, catalog, carts, dispatchCart }) {
  const { tableId } = useParams()
  const cart = carts[tableId] ?? emptyCart
  const navigate = useNavigate()
  const [table, setTable] = useState(null)
  const [bill, setBill] = useState(undefined)
  const [billError, setBillError] = useState(false)
  const [panel, setPanel] = useState('cart')
  const [sheetOpen, setSheetOpen] = useState(false)
  // Aynı içerik yeniden gönderilirken aynı anahtar kullanılır; sepet bu sırada kilitlidir.
  const [submission, setSubmission] = useState(null)
  const [submitState, setSubmitState] = useState('idle')
  const [rejectCode, setRejectCode] = useState(null)
  const dispatch = useCallback(action => dispatchCart({ tableId, action }), [dispatchCart, tableId])

  const latestLoad = useRef(0)
  const loadBill = useCallback(async () => {
    const load = ++latestLoad.current
    try {
      const [tables, nextBill] = await Promise.all([backend.listTables(), backend.getTableBill(tableId)])
      // Çakışan yenilemelerde geç gelen eski yanıt yeni adisyonu ezmez.
      if (load !== latestLoad.current) return
      const found = tables.find(t => t.id === tableId)
      if (!found) return navigate('..', { replace: true })
      setTable(found)
      setBill(nextBill)
      setBillError(false)
    } catch {
      if (load === latestLoad.current) setBillError(true)
    }
  }, [backend, tableId, navigate])

  useOrderSync(backend, loadBill, REFRESH_MS)

  const markServed = useCallback(async order => {
    try {
      const result = await backend.setOrderStatus(order.id, 'served')
      if (result.state !== 'confirmed') toast.error(statusErrorMessage(result.code))
    } catch { toast.error(statusErrorMessage()) }
    loadBill()
  }, [backend, loadBill])

  // Ödeme: bağlantı koparsa aynı tutar/yöntemle tekrar denemede aynı anahtar kullanılır (sunucuda çift kayıt olmaz).
  const [paying, setPaying] = useState(null)
  const [closing, setClosing] = useState(false)
  const pendingPayment = useRef(null)
  const pay = useCallback(async (amountCents, method, done) => {
    if (!bill || paying) return
    if (!window.confirm(`${formatCents(amountCents)} ${METHOD_LABELS[method].toLowerCase()} olarak alındı mı?`)) return
    const previous = pendingPayment.current
    const key = previous && previous.billId === bill.billId && previous.amountCents === amountCents && previous.method === method ? previous.key : randomUUID()
    pendingPayment.current = { billId: bill.billId, amountCents, method, key }
    setPaying(method)
    let result
    try { result = await backend.recordBillPayment(bill.billId, amountCents, method, key) } catch { result = { state: 'error' } } finally { setPaying(null) }
    if (result.state === 'error') { toast.error('Bağlantı sorunu: ödeme doğrulanamadı. Aynı tutarla tekrar deneyin; çift kayıt oluşmaz.'); return }
    pendingPayment.current = null
    if (result.state === 'confirmed') { toast.success(`${formatCents(amountCents)} ${METHOD_LABELS[method].toLowerCase()} alındı`); done?.() }
    else toast.error(statusErrorMessage(result.code))
    loadBill()
  }, [backend, bill, paying, loadBill])

  const closeBill = useCallback(async () => {
    if (!bill?.sessionId || closing) return
    if (!window.confirm(`${table?.label ?? 'Masa'} hesabı kapatılsın mı? Masa boşalır; yeni sipariş yeni adisyon açar.`)) return
    setClosing(true)
    let result
    try { result = await backend.closeBill(bill.sessionId) } catch { result = { state: 'error' } } finally { setClosing(false) }
    if (result.state === 'confirmed') {
      toast.success(`${table?.label ?? 'Masa'} kapatıldı`)
      setSheetOpen(false)
      navigate('..')
      return
    }
    toast.error(result.state === 'error' ? 'Bağlantı sorunu: hesap kapatılamadı, tekrar deneyin.' : statusErrorMessage(result.code))
    loadBill()
  }, [backend, bill, closing, table, navigate, loadBill])

  const handleResult = useCallback((sub, result) => {
    if (result.state === 'confirmed') {
      clearPending(sub.key)
      dispatch({ type: 'clear' })
      setSubmission(null)
      setSubmitState('idle')
      toast.success(backend.mode === 'demo'
        ? `Demo sipariş #${result.order.orderNumber} yalnızca bu tarayıcıdaki demo mutfağa düştü`
        : `Sipariş #${result.order.order_number} mutfağa iletildi`)
      setPanel('bill')
      loadBill()
    } else if (result.state === 'rejected') {
      clearPending(sub.key)
      setSubmission(null)
      setRejectCode(result.code)
      setSubmitState('rejected')
    } else {
      setSubmitState('uncertain')
    }
  }, [backend.mode, dispatch, loadBill])

  async function submit() {
    if (!cart.lines.length || submitState === 'sending') return
    const sub = submission ?? createSubmission({ tableId, lines: toOrderPayloadLines(cart), note: cart.note.trim() || null })
    setSubmission(sub)
    setSubmitState('sending')
    // Yanıt beklenirken sayfa kapanırsa sonraki açılışta anahtarla doğrulanır.
    if (backend.mode === 'live') savePending(sub)
    handleResult(sub, await backend.submit(sub))
  }

  const reconcile = useCallback(async () => {
    if (!submission) return
    setSubmitState('sending')
    handleResult(submission, await backend.reconcile(submission))
  }, [backend, submission, handleResult])

  // Bağlantı geri geldiğinde belirsiz gönderimi otomatik doğrula (tekrar göndermeden önce sorgular).
  useEffect(() => {
    if (submitState !== 'uncertain') return
    window.addEventListener('online', reconcile)
    return () => window.removeEventListener('online', reconcile)
  }, [submitState, reconcile])

  const quantities = useMemo(() => {
    const map = new Map()
    for (const line of cart.lines) map.set(line.menuItemId, (map.get(line.menuItemId) ?? 0) + line.quantity)
    return map
  }, [cart.lines])

  const add = useCallback(item => {
    dispatch({ type: 'add', item: { id: item.id, name: item.name, price: item.price, image: item.image } })
    if (submitState === 'rejected') setSubmitState('idle')
    navigator.vibrate?.(8)
  }, [dispatch, submitState])

  const openPanel = name => { setPanel(name); setSheetOpen(true) }

  // Geçici adisyon adı (ör. "Ahmet Bey"): masanın kalıcı adı ve QR değişmez; hesap kapanınca silinir.
  const [naming, setNaming] = useState(null) // düzenlenen metin
  const [savingName, setSavingName] = useState(false)
  async function saveName(event) {
    event?.preventDefault()
    if (savingName || naming === null) return
    setSavingName(true)
    let result
    try { result = await backend.setTableLabel(tableId, naming) } catch { result = { state: 'error' } } finally { setSavingName(false) }
    if (result.state === 'confirmed') { setNaming(null); loadBill() }
    else toast.error(result.state === 'error' ? 'Bağlantı sorunu: ad kaydedilemedi.' : statusErrorMessage(result.code))
  }

  // Bildirimden gelindiyse adisyon doğrudan açılır.
  const location = useLocation()
  useEffect(() => {
    if (!location.state?.openBill) return
    queueMicrotask(() => { setPanel('bill'); setSheetOpen(true) })
  }, [location.key, location.state])

  const count = cartCount(cart)
  const locked = submitState === 'sending' || submitState === 'uncertain'

  return (
    <main className="wt-table-view">
      <div className="wt-table-bar">
        <button type="button" className="pos-icon-btn" onClick={() => navigate('..')} aria-label="Masalara dön"><ArrowLeft size={20} /></button>
        <div className="wt-table-bar-title">
          <h1 className="pos-title">{table?.label ?? '…'}</h1>
          {backend.setTableLabel && (naming === null ? (
            <button type="button" className="wt-guest-btn" onClick={() => setNaming(table?.guestLabel ?? '')} disabled={!table}>
              <Pencil size={12} aria-hidden="true" />{table?.guestLabel ? <strong>{table.guestLabel}</strong> : 'Ad / not ekle'}
            </button>
          ) : (
            <form className="wt-guest-form" onSubmit={saveName}>
              <input className="input" value={naming} maxLength={40} autoFocus placeholder="Örn. Ahmet Bey, Doğum günü" aria-label="Adisyon adı"
                onChange={event => setNaming(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setNaming(null) }} />
              <button type="submit" className="pos-icon-btn" disabled={savingName} aria-label="Adı kaydet"><Check size={16} /></button>
              <button type="button" className="pos-icon-btn" onClick={() => setNaming(null)} aria-label="Vazgeç"><X size={16} /></button>
            </form>
          ))}
          <span className="pos-muted">{bill ? `Adisyon ${formatCents(bill.totalCents)} · ${bill.orderCount} sipariş` : 'Açık adisyon yok'}</span>
        </div>
        <button type="button" className="pos-btn pos-btn-ghost wt-bill-btn" onClick={() => openPanel('bill')}>
          <Receipt size={16} /> Adisyon
        </button>
      </div>

      <div className="wt-layout">
        <CatalogPanel catalog={catalog} quantities={quantities} locked={locked} onAdd={add} />

        {sheetOpen && <div className="wt-sheet-backdrop" onClick={() => setSheetOpen(false)} aria-hidden="true" />}
        <aside className={`wt-side${sheetOpen ? ' open' : ''}`} aria-label={panel === 'cart' ? 'Sepet' : 'Adisyon'}>
          <div className="sheet-handle-wrap wt-sheet-handle"><div className="sheet-handle" /></div>
          <div className="pos-segment" role="tablist">
            <button type="button" role="tab" aria-selected={panel === 'cart'} className={panel === 'cart' ? 'active' : ''} onClick={() => setPanel('cart')}>
              <ShoppingBag size={15} /> Sepet{count ? ` (${count})` : ''}
            </button>
            <button type="button" role="tab" aria-selected={panel === 'bill'} className={panel === 'bill' ? 'active' : ''} onClick={() => setPanel('bill')}>
              <UtensilsCrossed size={15} /> Adisyon
            </button>
            <button type="button" className="wt-sheet-close" onClick={() => setSheetOpen(false)} aria-label="Kapat">Kapat</button>
          </div>
          <div className="wt-side-body">
            {panel === 'cart'
              ? <CartPanel cart={cart} dispatch={dispatch} submitState={submitState} rejectCode={rejectCode}
                  demo={backend.mode === 'demo'} onSubmit={submit} onReconcile={reconcile} />
              : <BillPanel bill={bill} error={billError} onServe={markServed}
                  onPay={backend.recordBillPayment ? pay : null} onClose={backend.closeBill ? closeBill : null} paying={paying} closing={closing} />}
          </div>
        </aside>
      </div>

      {count > 0 && !sheetOpen && (
        <button type="button" className="wt-cart-bar" onClick={() => openPanel('cart')}>
          <span className="wt-cart-bar-count">{count}</span>
          <span>Sepeti gör</span>
          <strong>{formatCents(estimateTotalCents(cart.lines))}</strong>
        </button>
      )}
    </main>
  )
}
