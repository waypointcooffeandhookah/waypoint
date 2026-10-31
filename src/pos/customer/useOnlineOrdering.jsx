import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../supabaseClient'
import { getItemImage } from '../../utils/imageUtils'
import { cartCount, cartReducer, emptyCart, quantityOf, toOrderPayloadLines } from '../cart'
import { loadCatalog } from '../catalog'
import { estimateTotalCents } from '../money'
import { createSubmission, reconcileOrder, submitOrder } from '../orderSubmission'
import { checkDeliveryAddress, getOrderTracking, getOrderingConfig, onlineOrderTransport } from '../posApi'
import { useOrderSync } from '../useOrderSync'
import OrderControl from './OrderControl'
import { checkoutSummary, emptyForm, loadOnlineState, mapOnlineOrder, mapTracking, saveOnlineState, toOnlinePayload, validateCheckout } from './onlineOrders'

const POLL_MS = 15000
// Anonim müşterinin tablolara okuma yetkisi yok, Realtime gelmez: durum düzenli okunur.
const pollOnly = { subscribe: (_change, connection) => { connection('connected'); return () => {} } }

export function useOrderingConfig() {
  const [config, setConfig] = useState(null)
  useEffect(() => {
    let active = true
    // RPC yoksa (migration uygulanmamış) sipariş arayüzü hiç görünmez.
    getOrderingConfig().then(({ data, error }) => { if (active && !error && (data?.pickup || data?.delivery)) setConfig(data) }, () => {})
    return () => { active = false }
  }, [])
  return config
}

export function useOnlineOrdering(config) {
  const [initial] = useState(() => loadOnlineState())
  const [channel, setChannelState] = useState(initial.channel)
  const [cart, dispatch] = useReducer(cartReducer, initial.cart ?? emptyCart)
  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState(false)
  const [sheet, setSheet] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [quote, setQuote] = useState(null)
  const [orders, setOrders] = useState(initial.orders)
  const [tracked, setTracked] = useState({})
  const [pending, setPending] = useState(initial.pending)
  const [submitState, setSubmitState] = useState('idle')
  const [rejectCode, setRejectCode] = useState(null)
  const [confirmed, setConfirmed] = useState(null)
  const sending = useRef(false)

  const usable = useMemo(() => {
    if (!config) return null
    return channel === 'dine_in' || config[channel] ? channel : null
  }, [config, channel])
  const orderingChannel = usable === 'pickup' || usable === 'delivery' ? usable : null

  // İlk kez gelen müşteriye seçim sorulur; kayıtlı seçim korunur.
  const asked = useRef(false)
  useEffect(() => {
    if (!config || asked.current) return
    asked.current = true
    if (!usable) queueMicrotask(() => setSheet('channel'))
  }, [config, usable])

  useEffect(() => {
    if (!config) return
    let active = true
    loadCatalog(supabase, getItemImage).then(
      next => { if (active) setCatalog(next) },
      () => { if (active) setCatalogError(true) })
    return () => { active = false }
  }, [config])

  const catalogById = useMemo(() => new Map((catalog?.items ?? []).map(item => [item.id, item])), [catalog])

  useEffect(() => {
    if (!catalog) return
    dispatch({ type: 'syncCatalog', items: catalog.items })
    if (initial.cart?.lines.some(line => !catalog.items.find(item => item.id === line.menuItemId)?.available)) {
      toast.error('Sepetinizdeki bir ürün artık mevcut değil, sepetten çıkarıldı.')
    }
  }, [catalog, initial])

  useEffect(() => { saveOnlineState({ channel, cart, orders, pending }) }, [channel, cart, orders, pending])

  // Adres değişince bölge, ücret ve asgari tutar sunucudan okunur; eski yanıt yenisini ezmez.
  const postalCode = form.postalCode.trim(), district = form.district.trim()
  const quoteRun = useRef(0)
  useEffect(() => {
    const run = ++quoteRun.current
    if (orderingChannel !== 'delivery' || !/^\d{5}$/.test(postalCode) || district.length < 2) {
      queueMicrotask(() => { if (run === quoteRun.current) setQuote(null) })
      return
    }
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await checkDeliveryAddress(postalCode, district)
        if (run !== quoteRun.current) return
        if (error) return setQuote({ state: 'error' })
        setQuote(data.in_area
          ? { state: 'ok', zoneName: data.zone_name, feeCents: Number(data.fee_cents), minOrderCents: Number(data.min_order_cents) }
          : { state: 'out' })
      } catch {
        if (run === quoteRun.current) setQuote({ state: 'error' })
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [orderingChannel, postalCode, district])

  const tokens = orders.map(order => order.token).join(',')
  const loadTracking = useCallback(async () => {
    if (!tokens) return
    const answers = await Promise.all(tokens.split(',').map(async token => {
      const { data, error } = await getOrderTracking(token)
      return error ? null : [token, mapTracking(data)]
    }))
    setTracked(current => ({ ...current, ...Object.fromEntries(answers.filter(Boolean)) }))
  }, [tokens])
  const { refresh } = useOrderSync(pollOnly, loadTracking, POLL_MS)

  const settle = useCallback((sub, result) => {
    sending.current = false
    if (result.state === 'confirmed') {
      const order = mapOnlineOrder(result.order)
      setOrders(list => list.some(entry => entry.token === order.trackingToken) ? list : [...list, { token: order.trackingToken, number: order.orderNumber, type: order.fulfillmentType }])
      setPending(null)
      dispatch({ type: 'clear' })
      setForm(emptyForm)
      setQuote(null)
      setConfirmed(order)
      setSheet(current => current ?? 'cart')
      setSubmitState('idle')
      setRejectCode(null)
      refresh()
    } else if (result.state === 'rejected') {
      setPending(null)
      setRejectCode(result.code)
      setSubmitState('rejected')
    } else {
      setSubmitState('uncertain')
    }
  }, [refresh])

  const resume = useCallback(async sub => {
    sending.current = true
    setSubmitState('sending')
    settle(sub, await reconcileOrder(sub, onlineOrderTransport))
  }, [settle])

  const reconcile = useCallback(() => {
    if (pending && !sending.current) resume(pending)
  }, [pending, resume])

  // Açılışta yarım kalan taze gönderim aynı anahtarla doğrulanır.
  const recovered = useRef(false)
  useEffect(() => {
    if (recovered.current || !config) return
    recovered.current = true
    if (initial.pending) queueMicrotask(() => resume(initial.pending))
  }, [config, initial, resume])

  useEffect(() => {
    if (submitState !== 'uncertain') return
    window.addEventListener('online', reconcile)
    return () => window.removeEventListener('online', reconcile)
  }, [submitState, reconcile])

  const subtotalCents = estimateTotalCents(cart.lines)
  const summary = checkoutSummary(orderingChannel, subtotalCents, quote)

  async function submit() {
    if (sending.current || pending || !orderingChannel || !cart.lines.length) return
    const nextErrors = validateCheckout(orderingChannel, form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length || !summary.ready) return
    sending.current = true
    const sub = createSubmission({ ...toOnlinePayload(orderingChannel, form), lines: toOrderPayloadLines(cart), note: cart.note.trim() || null })
    // Yanıt beklenirken sayfa kapanırsa sonraki açılışta aynı anahtarla doğrulanır.
    saveOnlineState({ channel, cart, orders, pending: sub })
    setPending(sub)
    setSubmitState('sending')
    setRejectCode(null)
    settle(sub, await submitOrder(sub, onlineOrderTransport))
  }

  const closeSheet = useCallback(() => { setSheet(null); setConfirmed(null) }, [])
  const locked = submitState === 'sending' || submitState === 'uncertain'

  return {
    config,
    channel: usable,
    selectChannel(next) {
      if (locked) return
      setChannelState(next)
      setSubmitState('idle')
      setRejectCode(null)
      setErrors({})
      setSheet(next === 'dine_in' ? 'channel' : cartCount(cart) ? 'cart' : null)
    },
    status: orderingChannel && catalog ? 'ready' : 'browse',
    catalogError,
    cart,
    dispatch,
    count: cartCount(cart),
    locked,
    submitState,
    rejectCode,
    confirmed,
    sheet,
    openSheet: setSheet,
    closeSheet,
    dismissConfirmation: () => setConfirmed(null),
    submit,
    reconcile,
    form,
    errors,
    setField(field, value) {
      setForm(current => ({ ...current, [field]: value }))
      setErrors(current => current[field] ? { ...current, [field]: undefined } : current)
    },
    quote,
    subtotalCents,
    summary,
    orders,
    tracked,
    hasOrders: orders.length > 0,
    add: useCallback(item => {
      const product = catalogById.get(item.id)
      if (!product) return
      dispatch({ type: 'add', item: { id: product.id, name: product.name, price: product.price, image: product.image } })
      setSubmitState(state => state === 'rejected' ? 'idle' : state)
      navigator.vibrate?.(8)
    }, [catalogById]),
    orderable: item => Boolean(orderingChannel) && Boolean(catalogById.get(item.id)?.available) && catalogById.get(item.id).priceCents > 0,
    quantity: id => quantityOf(cart, id),
    OrderControl,
  }
}
