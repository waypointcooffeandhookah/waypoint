import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import MenuPage from './MenuPage'

const OnlineOrderingController = lazy(() => import('../pos/customer/OnlineOrderingController'))

// Genel menü. Sipariş kodu ana pakete girmez: yalnızca paket veya kurye açıksa yüklenir.
// Kanallar kapalıysa ya da kurulum yoksa eski salt menüyle birebir aynıdır. MenuPage yerinde kalır,
// kod sonradan yüklenince yeniden kurulmaz; müşterinin gezintisi sıfırlanmaz.
export default function GeneralMenuRoute() {
  const [config, setConfig] = useState(null)
  const [slots, setSlots] = useState(null)

  useEffect(() => {
    let active = true
    Promise.resolve(supabase.rpc('get_ordering_config')).then(({ data, error }) => {
      if (active && !error && (data?.pickup || data?.delivery)) setConfig(data)
    }, () => {})
    return () => { active = false }
  }, [])

  return (
    <>
      {config && <Suspense fallback={null}><OnlineOrderingController config={config} onChange={setSlots} /></Suspense>}
      <MenuPage ordering={slots?.ordering ?? null} tableChip={slots?.chip ?? null} orderLayer={slots?.layer ?? null} />
    </>
  )
}
