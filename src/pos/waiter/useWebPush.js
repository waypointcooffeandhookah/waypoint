import { useEffect, useState } from 'react'
import { WEB_PUSH_PUBLIC_KEY } from '../../config'
import { disablePush, enablePush, pushCapability, syncPush } from './webPush'

// Durum: capability (tarayıcı/izin) + active (bu cihaz sunucuda bu kişi adına kayıtlı mı).
export function useWebPush(backend, staffId) {
  const supported = backend?.mode === 'live' && typeof backend.registerPushSubscription === 'function'
  const publicKey = supported ? WEB_PUSH_PUBLIC_KEY : ''
  const [capability, setCapability] = useState(() => pushCapability(publicKey))
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Açılışta ve kişi değişince; SW aboneliği yenilediğini bildirirse yeniden.
  useEffect(() => {
    if (!publicKey) return undefined
    let alive = true
    const resync = () => syncPush({ backend, publicKey }).then(
      endpoint => { if (alive) setActive(Boolean(endpoint)) },
      () => { if (alive) setActive(false) },
    ).finally(() => { if (alive) setCapability(pushCapability(publicKey)) })
    resync()
    const onMessage = event => { if (event.data?.type === 'waypoint-push-resync') resync() }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => {
      alive = false
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    }
  }, [backend, publicKey, staffId])

  return {
    capability,
    active,
    busy,
    error,
    async enable() {
      setBusy(true)
      setError(null)
      try {
        const result = await enablePush({ backend, publicKey })
        setActive(result.state === 'active')
      } catch {
        setError('Bildirim kaydı yapılamadı. Bağlantıyı kontrol edip tekrar deneyin.')
        setActive(false)
      } finally {
        setCapability(pushCapability(publicKey))
        setBusy(false)
      }
    },
    async disable() {
      setBusy(true)
      setError(null)
      try {
        await disablePush({ backend })
        setActive(false)
      } catch {
        setError('Bildirimler kapatılamadı. Tekrar deneyin.')
      } finally {
        setBusy(false)
      }
    },
  }
}
