// POS veritabanı RPC'lerine ince erişim katmanı. Fiyat ve toplam asla gönderilmez.
import { supabase } from '../supabaseClient'

const toLines = lines => lines.map(({ menuItemId, quantity, note }) => ({ menu_item_id: menuItemId, quantity, note: note || null }))

const call = (name, args, signal) => {
  const query = supabase.rpc(name, args)
  return signal ? query.abortSignal(signal) : query
}

// orderSubmission.submitOrder / reconcileOrder ile kullanılmak üzere
export const qrOrderTransport = {
  send: ({ key, payload }, signal) => call('place_qr_order', {
    p_table_token: payload.tableToken, p_idempotency_key: key, p_items: toLines(payload.lines),
    p_note: payload.note || null, p_client_ref: payload.clientRef || null,
  }, signal),
  lookup: async ({ key, payload }, signal) => {
    const { data, error } = await call('get_qr_orders', { p_table_token: payload.tableToken, p_idempotency_keys: [key] }, signal)
    return { data: data?.[0] ?? null, error }
  },
}

export const staffOrderTransport = {
  send: ({ key, payload }, signal) => call('place_staff_order', {
    p_table_id: payload.tableId, p_idempotency_key: key, p_items: toLines(payload.lines), p_note: payload.note || null,
  }, signal),
  lookup: ({ key }, signal) => call('get_order_by_idempotency_key', { p_idempotency_key: key }, signal),
}

export const getQrTable = tableToken => call('get_qr_table', { p_table_token: tableToken })
export const getQrOrders = (tableToken, keys) => call('get_qr_orders', { p_table_token: tableToken, p_idempotency_keys: keys })
export const openTableSession = tableId => call('open_table_session', { p_table_id: tableId })
export const updateOrderStatus = (orderId, status, reason) => call('update_order_status', { p_order_id: orderId, p_status: status, p_reason: reason || null })
export const recordPayment = (billId, amountCents, method, idempotencyKey, note) =>
  call('record_payment', { p_bill_id: billId, p_amount_cents: amountCents, p_method: method, p_idempotency_key: idempotencyKey, p_note: note || null })
export const closeTableSession = (sessionId, force = false) => call('close_table_session', { p_session_id: sessionId, p_force: force })
