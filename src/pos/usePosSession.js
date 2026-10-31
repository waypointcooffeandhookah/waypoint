import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { IS_STAGING } from '../config'
import { getItemImage } from '../utils/imageUtils'
import { loadCatalog } from './catalog'
import { createDemoBackend } from './backend/demoBackend'
import { createBrowserDemoStore } from './backend/demoStore'
import { createLiveBackend } from './backend/liveBackend'
import { detectPosMode, getStaff } from './backend/staffAuth'

const DEMO_SESSION_KEY = 'waypoint-pos-demo-session'

const readDemoSession = () => { try { return sessionStorage.getItem(DEMO_SESSION_KEY) === '1' } catch { return false } }
function writeDemoSession(value) {
  try {
    if (value) sessionStorage.setItem(DEMO_SESSION_KEY, '1')
    else sessionStorage.removeItem(DEMO_SESSION_KEY)
  } catch { /* Depolama kapalı olabilir. */ }
}

// Garson ve mutfak ekranlarının ortak açılışı: mod, personel oturumu, katalog, veri kaynağı.
export function usePosSession({ demoStaff }) {
  const { search } = useLocation()
  const [mode, setMode] = useState(null)
  const [staff, setStaff] = useState(undefined)
  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    detectPosMode(supabase, search, !IS_STAGING).then(next => {
      if (!active) return
      if (next === 'demo' && new URLSearchParams(search).has('demo')) writeDemoSession(true)
      if (next === 'demo') setStaff(readDemoSession() ? demoStaff : null)
      setMode(next)
    })
    loadCatalog(supabase, getItemImage).then(
      next => { if (active) { setCatalog(next); setCatalogError(false) } },
      () => { if (active) setCatalogError(true) })
    return () => { active = false }
    // Mod yalnızca açılışta ve "Tekrar dene" ile belirlenir; sorgu dizesi değişimi yeniden tetiklemez.
  }, [attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== 'live') return
    let active = true
    const refresh = () => getStaff(supabase).then(next => active && setStaff(next), () => active && setStaff(null))
    refresh()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') setStaff(null)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [mode])

  const backend = useMemo(() => {
    if (mode === 'live') return createLiveBackend(supabase)
    if (mode === 'demo' && catalog) return createDemoBackend({ catalogItems: catalog.items, store: createBrowserDemoStore() })
    return null
  }, [mode, catalog])

  return {
    mode, staff, setStaff, catalog, catalogError, backend,
    retry() { setMode(null); setAttempt(a => a + 1) },
    startDemo() { writeDemoSession(true); setStaff(demoStaff) },
    async signOut() {
      if (mode === 'demo') { writeDemoSession(false); setStaff(null); return }
      await supabase.auth.signOut()
      setStaff(null)
    },
  }
}
