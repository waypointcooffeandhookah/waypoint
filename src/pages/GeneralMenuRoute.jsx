import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import MenuPage from './MenuPage'

const OnlineOrderingController = lazy(() => import('../pos/customer/OnlineOrderingController'))

// Genel menü. Sipariş kodu ana pakete girmez: yalnızca yönetici paket veya kurye kanalını açtıysa yüklenir.
// Sipariş alımı geçici kapalıysa da yüklenir: sipariş türleri ve sepet görünür, uyarı çıkar, gönderim kapalıdır.
// Kanallar kapalıysa ya da kurulum yoksa eski salt menüyle birebir aynıdır. MenuPage yerinde kalır,
// kod sonradan yüklenince yeniden kurulmaz; müşterinin gezintisi sıfırlanmaz.
// Yönetici paket veya kurye kanalını açtı mı? ("channels" yoksa eski sunucu yanıtı.) Ayrıntılı okuma
// tembel yüklenen denetleyicide yapılır (normalizeOrderingConfig); burada yalnızca yükleme kararı verilir.
const hasOnlineChannel = data => { const channels = data?.channels ?? data; return channels?.pickup === true || channels?.delivery === true }

export default function GeneralMenuRoute() {
  const [config, setConfig] = useState(null)
  const [slots, setSlots] = useState(null)
  const [configSettled, setConfigSettled] = useState(false)

  useEffect(() => {
    let active = true
    Promise.resolve(supabase.rpc('get_ordering_config')).then(({ data, error }) => {
      if (active && !error && hasOnlineChannel(data)) setConfig(data)
    }, () => {}).finally(() => { if (active) setConfigSettled(true) })
    return () => { active = false }
  }, [])

  return (
    <>
      {config && <Suspense fallback={null}><OnlineOrderingController config={config} onChange={setSlots} /></Suspense>}
      <MenuPage promotionPerVisit orderingPending={!configSettled || Boolean(config && !slots)} ordering={slots?.ordering ?? null} tableChip={slots?.chip ?? null} orderBanner={slots?.banner ?? null} orderLayer={slots?.layer ?? null} />
    </>
  )
}
