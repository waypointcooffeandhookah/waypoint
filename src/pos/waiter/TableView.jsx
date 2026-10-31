import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Receipt, ShoppingBag, UtensilsCrossed } from 'lucide-react'
import toast from 'react-hot-toast'
import { createSubmission, savePending, clearPending } from '../orderSubmission'
import { cartCount, emptyCart, toOrderPayloadLines } from '../cart'
import { formatCents, estimateTotalCents } from '../money'
import { statusErrorMessage } from '../messages'
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
    const result = await backend.setOrderStatus(order.id, 'served')
    if (result.state !== 'confirmed') toast.error(statusErrorMessage(result.code))
    loadBill()
  }, [backend, loadBill])

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
              : <BillPanel bill={bill} error={billError} onServe={markServed} />}
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
