// Canlı QR veri kaynağı: mevcut sipariş altyapısını (place_qr_order) kullanır, ayrı bir yol açmaz.
// Fiyat ve toplam gönderilmez; masa yetkisi yalnızca QR okutunca alınan süreli biletten gelir
// (20261105090000_pos_qr_visits.sql). Sipariş RPC'lerinin p_table_token parametresi bu bilettir.
import { getQrOrders, getQrVisit, qrOrderTransport } from '../posApi.js'
import { reconcileOrder, submitOrder } from '../orderSubmission.js'
import { classifyVisit, mapQrOrder } from './qrOrders.js'

const mapResult = result => result.state === 'confirmed' ? { ...result, order: mapQrOrder(result.order) } : result

export function createLiveQrBackend(visit) {
  return {
    mode: 'live',
    // Sayfa açılışı/yenileme: bilet doğrulanır, süresi uzamaz.
    getTable: async () => {
      try { return classifyVisit(await getQrVisit(visit)) } catch { return { state: 'unreachable' } }
    },
    submit: async submission => mapResult(await submitOrder(submission, qrOrderTransport)),
    reconcile: async submission => mapResult(await reconcileOrder(submission, qrOrderTransport)),
    async listOrders(keys) {
      const { data, error } = await getQrOrders(visit, keys)
      if (error) throw error
      return data.map(mapQrOrder)
    },
    // Anonim müşterinin tablolara okuma yetkisi yok (RLS), Realtime gelmez: durum düzenli okunur.
    subscribe(_onChange, onConnection) {
      onConnection('connected')
      return () => {}
    },
  }
}
