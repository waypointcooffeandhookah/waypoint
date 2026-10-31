// Canlı QR veri kaynağı: mevcut sipariş altyapısını (place_qr_order) kullanır, ayrı bir yol açmaz.
// Fiyat ve toplam gönderilmez; masa yetkisi yalnızca gizli masa kodundan gelir.
import { getQrOrders, getQrTable, qrOrderTransport } from '../posApi.js'
import { reconcileOrder, submitOrder } from '../orderSubmission.js'
import { classifyTable, mapQrOrder } from './qrOrders.js'

const mapResult = result => result.state === 'confirmed' ? { ...result, order: mapQrOrder(result.order) } : result

export function createLiveQrBackend(token) {
  return {
    mode: 'live',
    getTable: async () => {
      try { return classifyTable(await getQrTable(token)) } catch { return { state: 'unreachable' } }
    },
    submit: async submission => mapResult(await submitOrder(submission, qrOrderTransport)),
    reconcile: async submission => mapResult(await reconcileOrder(submission, qrOrderTransport)),
    async listOrders(keys) {
      const { data, error } = await getQrOrders(token, keys)
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
