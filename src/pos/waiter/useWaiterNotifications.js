import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { statusErrorMessage } from '../messages'
import { useOrderSync } from '../useOrderSync'
import { createChime, readSoundPref, writeSoundPref } from '../kitchen/kitchenSound'
import {
  SOUND_PREF_KEY, browserNotificationStatus, loadNotificationState, notificationStorageKey,
  reconcileNotifications, saveNotificationState, showBrowserNotification, unreadCount,
} from './notifications'

const REFRESH_MS = 15000
const MAX_BANNERS = 3

export function useWaiterNotifications(backend, staffId) {
  const key = notificationStorageKey(backend.mode, staffId)
  const [initial] = useState(() => loadNotificationState(key))
  const state = useRef(initial)
  const [items, setItems] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [read, setRead] = useState(initial.read)
  const [bannerIds, setBannerIds] = useState([])
  const [soundOn, setSoundOn] = useState(() => readSoundPref(SOUND_PREF_KEY))
  const [browserStatus, setBrowserStatus] = useState(() => browserNotificationStatus())
  const [chime] = useState(createChime)
  const soundRef = useRef(soundOn)
  useEffect(() => { soundRef.current = soundOn }, [soundOn])

  const load = useCallback(async () => {
    try {
      const rows = await backend.listReadyNotifications()
      const { state: next, fresh } = reconcileNotifications(state.current, rows)
      state.current = next
      saveNotificationState(key, next)
      setItems(rows)
      setLoaded(true)
      setLoadError(false)
      if (fresh.length) {
        setBannerIds(current => [...fresh.map(item => item.id), ...current])
        if (soundRef.current) chime.play()
        navigator.vibrate?.([120, 60, 120])
        fresh.forEach(item => showBrowserNotification(item))
      }
    } catch {
      setLoadError(true)
    }
  }, [backend, key, chime])

  const { connection, refresh } = useOrderSync(backend, load, REFRESH_MS)

  // Tarayıcı sesi ancak bir dokunuştan sonra açar: yenilemeden sonra ilk dokunuşta yeniden açılır.
  useEffect(() => {
    if (!soundOn) return
    const unlock = () => chime.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [soundOn, chime])

  // Aynı tarayıcının diğer sekmesinde okunanlar burada da okunmuş olur.
  useEffect(() => {
    const onStorage = event => {
      if (event.key !== key) return
      const saved = loadNotificationState(key)
      state.current = { ...state.current, read: saved.read, seen: saved.seen, initialized: saved.initialized }
      setRead(saved.read)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key])

  const persistRead = useCallback(ids => {
    const merged = [...new Set([...ids, ...state.current.read])]
    state.current = { ...state.current, read: merged }
    saveNotificationState(key, state.current)
    setRead(merged)
    setBannerIds(current => current.filter(id => !ids.includes(id)))
  }, [key])

  const serve = useCallback(async item => {
    const result = await backend.setOrderStatus(item.orderId, 'served')
    if (result.state !== 'confirmed') toast.error(statusErrorMessage(result.code))
    else persistRead([item.id])
    refresh()
  }, [backend, persistRead, refresh])

  const banners = useMemo(() => {
    const byId = new Map(items.map(item => [item.id, item]))
    return bannerIds.map(id => byId.get(id)).filter(item => item?.status === 'ready')
  }, [bannerIds, items])

  return {
    items,
    loaded,
    loadError,
    connection,
    read,
    unread: unreadCount(items, read),
    banners: banners.slice(0, MAX_BANNERS),
    hiddenBanners: Math.max(0, banners.length - MAX_BANNERS),
    markRead: id => persistRead([id]),
    markAllRead: () => persistRead(items.map(item => item.id)),
    dismissBanner: id => setBannerIds(current => current.filter(other => other !== id)),
    serve,
    soundOn,
    toggleSound() {
      const next = !soundOn
      if (next) {
        chime.unlock()
        chime.play()
      }
      writeSoundPref(next, SOUND_PREF_KEY)
      setSoundOn(next)
    },
    browserStatus,
    async requestBrowserPermission() {
      try { await window.Notification.requestPermission() } catch { /* Tarayıcı reddetti. */ }
      setBrowserStatus(browserNotificationStatus())
    },
  }
}
