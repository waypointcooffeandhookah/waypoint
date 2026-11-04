// Test masasını normal personel yoluyla kapatır (veri SİLMEZ): hazır → servis, yeni/hazırlanıyor → gerekçeli iptal,
// kalan bakiye nakit ödenir, oturum kapatılır. Yönetici oturumlu bir Supabase istemcisi verilmelidir.
// Yalnızca adı verilen test masalarında kullanılır (ör. "Masa 5"); başka masaya dokunmaz.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { PRODUCTION_REF, STAGING_REF } from '../../src/supabaseTarget.js'

// .env.staging.local + .staging-credentials.local ile yönetici oturumlu staging istemcisi (yalnızca staging).
export async function stagingAdmin(root = new URL('../../', import.meta.url)) {
  const env = Object.fromEntries(readFileSync(new URL('.env.staging.local', root), 'utf8').split(/\r?\n/).filter(line => line.includes('='))
    .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]))
  if (!env.VITE_SUPABASE_URL?.includes(STAGING_REF) || env.VITE_SUPABASE_URL.includes(PRODUCTION_REF)) throw new Error('hedef staging değil')
  const creds = JSON.parse(readFileSync(new URL('.staging-credentials.local', root), 'utf8'))
  const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await db.auth.signInWithPassword(creds.admin)
  if (error) throw new Error(`yönetici girişi: ${error.message}`)
  return db
}

export async function closeTestTable(db, label, reason = 'staging e2e test temizliği') {
  const { data: table, error: tableError } = await db.from('restaurant_tables').select('id').eq('label', label).single()
  if (tableError) throw new Error(`${label}: ${tableError.message}`)
  const { data: bill } = await db.from('bill_summaries').select('bill_id, session_id, balance_cents').eq('table_id', table.id).eq('status', 'open').maybeSingle()
  if (!bill) return { label, closed: false, note: 'açık oturum yok' }
  const { data: orders } = await db.from('orders').select('id, status').eq('bill_id', bill.bill_id).in('status', ['new', 'preparing', 'ready'])
  const step = async (id, status, why) => {
    const result = await db.rpc('update_order_status', { p_order_id: id, p_status: status, p_reason: why ?? null })
    if (result.error) throw new Error(`${label} ${status}: ${result.error.message}`)
  }
  for (const order of orders ?? []) {
    if (order.status === 'ready') await step(order.id, 'served')
    else await step(order.id, 'cancelled', reason)
  }
  const { data: fresh } = await db.from('bill_summaries').select('balance_cents').eq('bill_id', bill.bill_id).single()
  const balance = Number(fresh?.balance_cents ?? 0)
  if (balance > 0) {
    const paid = await db.rpc('record_payment', { p_bill_id: bill.bill_id, p_amount_cents: balance, p_method: 'cash', p_idempotency_key: randomUUID(), p_note: reason })
    if (paid.error) throw new Error(`${label} ödeme: ${paid.error.message}`)
  }
  const closed = await db.rpc('close_table_session', { p_session_id: bill.session_id })
  if (closed.error) throw new Error(`${label} kapatma: ${closed.error.message}`)
  return { label, closed: true, served_or_cancelled: orders?.length ?? 0, paid_cents: balance }
}
