import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../supabaseClient'
import { IS_STAGING } from '../../config'
import { getItemImage } from '../../utils/imageUtils'
import { cartCount, cartReducer, emptyCart, quantityOf, toOrderPayloadLines } from '../cart'
import { loadCatalog } from '../catalog'
import { estimateTotalCents, formatCents } from '../money'
import { createSubmission } from '../orderSubmission'
import { useOrderSync } from '../useOrderSync'
import { detectPosMode } from '../backend/staffAuth'
import { createDemoBackend } from '../backend/demoBackend'
import { createBrowserDemoStore } from '../backend/demoStore'
import { createLiveQrBackend } from './liveQrBackend'
import { demoTableIdOf, isFreshPending, isLiveToken, loadQrState, saveQrState } from './qrOrders'
import OrderControl from './OrderControl'

const POLL_MS = 15000
const idleSync = { mode: 'idle', subscribe: (_change, connection) => { connection('connected'); return () => {} } }

async function openBackend(token, search, catalog) {
  if (isLiveToken(token)) return createLiveQrBackend(token)
  if (IS_STAGING || !demoTableIdOf(token)) return null
  // Demo adresi yalnızca POS kurulu değilken (veya açıkça ?demo ile) çalışır.
  if (await detectPosMode(supabase, search) === 'live') return null
  return createDemoBackend({ catalogItems: catalog.items, store: createBrowserDemoStore() }).qr(token)
}

export function useQrOrdering(token) {
  const { search } = useLocation()
  const stateKey = `${token}${demoTableIdOf(token) ? `:${new URLSearchParams(search).get('musteri') ?? ''}` : ''}`
  const [initial] = useState(() => loadQrState(stateKey))
  // Eski yarım gönderim sessizce yollanmaz, yalnızca durum sorgusunda kalır.
  const [submissions, setSubmissions] = useState(() => initial.submissions.map(sub => sub.pending && !isFreshPending(sub) ? { key: sub.key, createdAt: sub.createdAt } : sub))

  const [status, setStatus] = useState('loading')
  const [attempt, setAttempt] = useState(0)
  const [tableLabel, setTableLabel] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [backend, setBackend] = useState(null)
  const [cart, dispatch] = useReducer(cartReducer, initial.cart ?? emptyCart)
  const [orders, setOrders] = useState([])
  const [ordersError, setOrdersError] = useState(false)
  const [submitState, setSubmitState] = useState('idle')
  const [rejectCode, setRejectCode] = useState(null)
  const [confirmed, setConfirmed] = useState(null)
  const [sheet, setSheet] = useState(null)
  const sending = useRef(false)

  // Masa ve katalog: başarısız olsa bile menü normal çalışmaya devam eder.
  useEffect(() => {
    let active = true
    async function open() {
      try {
        const nextCatalog = await loadCatalog(supabase, getItemImage)
        const next = await openBackend(token, search, nextCatalog)
        if (!active) return
        if (!next) return setStatus('invalid')
        const table = await next.getTable()
        if (!active) return
        if (table.state !== 'ready') return setStatus(table.state)
        setCatalog(nextCatalog)
        setBackend(next)
        setTableLabel(table.label)
        setStatus('ready')
      } catch {
        if (active) setStatus('unreachable')
      }
    }
    open()
    return () => { active = false }
    // Sorgu dizesi açılış dışında değişmez.
  }, [token, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status !== 'unreachable') return
    const retry = () => { setStatus('loading'); setAttempt(a => a + 1) }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [status])

  const catalogById = useMemo(() => new Map((catalog?.items ?? []).map(item => [item.id, item])), [catalog])

  // Kayıtlı sepet güncel fiyatlarla eşitlenir; tükenen ürün varsa müşteriye söylenir.
  useEffect(() => {
    if (!catalog) return
    dispatch({ type: 'syncCatalog', items: catalog.items })
    if (initial.cart?.lines.some(line => !catalog.items.find(item => item.id === line.menuItemId)?.available)) {
      toast.error('Sepetinizdeki bir ürün artık mevcut değil, sepetten çıkarıldı.')
    }
  }, [catalog, initial])

  useEffect(() => { saveQrState(stateKey, { cart, submissions }) }, [stateKey, cart, submissions])

  const keys = submissions.map(sub => sub.key).join(',')
  const loadOrders = useCallback(async () => {
    if (!backend || !keys) return
    try {
      setOrders(await backend.listOrders(keys.split(',')))
      setOrdersError(false)
    } catch {
      setOrdersError(true)
    }
  }, [backend, keys])

  const { refresh } = useOrderSync(backend ?? idleSync, loadOrders, POLL_MS)

  const settle = useCallback((sub, result) => {
    sending.current = false
    if (result.state === 'confirmed') {
      setSubmissions(list => list.map(item => item.key === sub.key ? { key: item.key, createdAt: item.createdAt } : item))
      dispatch({ type: 'clear' })
      setConfirmed(result.order)
      setSheet(current => current ?? 'cart') // Yenileme sonrası toparlanan sipariş de onay gösterir.
      setSubmitState('idle')
      setRejectCode(null)
      refresh()
    } else if (result.state === 'rejected') {
      setSubmissions(list => list.filter(item => item.key !== sub.key))
      setRejectCode(result.code)
      setSubmitState('rejected')
    } else {
      setSubmitState('uncertain')
    }
  }, [refresh])

  const pending = submissions.find(sub => sub.pending)

  const resume = useCallback(async sub => {
    sending.current = true
    setSubmitState('sending')
    settle(sub, await backend.reconcile(sub))
  }, [backend, settle])

  const reconcile = useCallback(() => {
    if (pending && backend && !sending.current) resume(pending)
  }, [backend, pending, resume])

  async function submit() {
    if (!backend || sending.current || pending || !cart.lines.length) return
    sending.current = true
    const sub = {
      ...createSubmission({ tableToken: token, lines: toOrderPayloadLines(cart), note: cart.note.trim() || null }),
      pending: true,
    }
    // Yanıt beklenirken sayfa kapanırsa sonraki açılışta aynı anahtarla doğrulanır.
    setSubmissions(list => [...list, sub])
    saveQrState(stateKey, { cart, submissions: [...submissions, sub] })
    setSubmitState('sending')
    setRejectCode(null)
    settle(sub, await backend.submit(sub))
  }

  // Açılışta yarım kalan taze gönderim aynı anahtarla doğrulanır.
  const recovered = useRef(false)
  useEffect(() => {
    if (!backend || recovered.current) return
    recovered.current = true
    const leftover = initial.submissions.find(isFreshPending)
    if (leftover) queueMicrotask(() => resume(leftover))
  }, [backend, initial, resume])

  // Bağlantı geri geldiğinde önce sorgular, tekrar göndermeden önce sunucu kaydına bakar.
  useEffect(() => {
    if (submitState !== 'uncertain') return
    window.addEventListener('online', reconcile)
    return () => window.removeEventListener('online', reconcile)
  }, [submitState, reconcile])

  const add = useCallback(item => {
    const product = catalogById.get(item.id)
    if (!product) return
    dispatch({ type: 'add', item: { id: product.id, name: product.name, price: product.price, image: product.image } })
    setSubmitState(state => state === 'rejected' ? 'idle' : state)
    navigator.vibrate?.(8)
  }, [catalogById])

  // Sabit başvuru: useDialog her değişimde odağı sıfırlar, not yazarken klavye kapanırdı.
  const closeSheet = useCallback(() => { setSheet(null); setConfirmed(null) }, [])
  const locked = submitState === 'sending' || submitState === 'uncertain'

  return {
    status,
    demo: backend?.mode === 'demo',
    tableLabel,
    cart,
    dispatch,
    count: cartCount(cart),
    canCheckout: status === 'ready',
    needsChannel: false,
    cartTotalLabel: formatCents(estimateTotalCents(cart.lines)),
    locked,
    orders,
    ordersError,
    hasOrders: submissions.length > 0,
    submitState,
    rejectCode,
    confirmed,
    sheet,
    openSheet: setSheet,
    closeSheet,
    dismissConfirmation: () => setConfirmed(null),
    submit,
    reconcile,
    add,
    // Yalnızca sunucuda karşılığı olan ve fiyatı bulunan ürünler sipariş edilebilir.
    orderable: item => status === 'ready' && Boolean(catalogById.get(item.id)?.available) && catalogById.get(item.id).priceCents > 0,
    quantity: id => quantityOf(cart, id),
    OrderControl,
  }
}
