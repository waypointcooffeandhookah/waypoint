// Sipariş durum akışı. Yetki ve geçiş kuralının asıl sahibi update_order_status RPC'sidir;
// demo aynı ileri akışı izler, arayüz de sıradaki adımı buradan öğrenir.
import { isDefinitiveRejection, rejectionCode } from './orderSubmission.js'

export const NEXT_STATUS = { new: 'preparing', preparing: 'ready', ready: 'served' }

// supabase-js yanıtını ekranların kullandığı sonuca çevirir.
export function statusResult({ data, error }) {
  if (!error) return { state: 'confirmed', order: data }
  if (isDefinitiveRejection(error)) return { state: 'rejected', code: rejectionCode(error) }
  return { state: 'error' }
}
