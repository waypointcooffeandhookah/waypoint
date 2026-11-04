// Masa kodu → süreli QR bileti (20261105090000_pos_qr_visits.sql). Sipariş RPC'leri artık bileti ister.
export async function qrVisitFor(db, tableToken) {
  const { data, error } = await db.rpc('start_qr_visit', { p_table_token: tableToken })
  if (error) throw new Error(`start_qr_visit: ${error.message}`)
  return data.visit
}
