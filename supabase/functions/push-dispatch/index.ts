// Garson "sipariş hazır" Web Push gönderimi. Tarayıcı sekmesine bağlı değildir:
// veritabanı tetikleyicisi push_outbox'a satır yazar, pg_net bu fonksiyonu çağırır
// (pg_cron her dakika yeniden denemeleri süpürür). Fonksiyon kuyruğu "FOR UPDATE SKIP LOCKED"
// ile talep eder; aynı satırı iki çağrı birden gönderemez.
//
// Gerekli secrets (yalnızca `supabase secrets set`, asla VITE_ ile değil):
//   PUSH_DISPATCH_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY Edge ortamınca otomatik verilir.
// Dağıtım: supabase functions deploy push-dispatch --no-verify-jwt  (kimlik doğrulama aşağıdaki gizli başlıkla)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { importVapidKeys, sendWebPush } from '../_shared/webpush.js'

const BATCH = 50
const MAX_BATCHES = 6
const env = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`missing_env_${name}`)
  return value
}

function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

let vapidPromise: ReturnType<typeof importVapidKeys> | null = null

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 })
  const secret = env('PUSH_DISPATCH_SECRET')
  if (secret.length < 32 || !safeEqual(req.headers.get('x-push-dispatch-secret') ?? '', secret)) {
    return new Response('forbidden', { status: 403 })
  }

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  vapidPromise ??= importVapidKeys(env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'))
  const vapid = await vapidPromise
  const subject = env('VAPID_SUBJECT')

  const totals = { sent: 0, gone: 0, retry: 0, failed: 0 }
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data: rows, error } = await db.rpc('push_claim_batch', { p_limit: BATCH })
    if (error) return Response.json({ error: 'claim_failed' }, { status: 500 })
    if (!rows?.length) break
    await Promise.all(rows.map(async (row: Record<string, unknown>) => {
      const result = await sendWebPush({
        subscription: { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        payload: row.payload, vapid, subject, topic: row.topic, ttl: 600,
      })
      totals[result.outcome as keyof typeof totals]++
      await db.rpc('push_report_result', { p_id: row.id, p_outcome: result.outcome, p_status: result.status, p_error: result.error })
    }))
    if (rows.length < BATCH) break
  }
  // Uç noktalar ve anahtarlar loglanmaz; yalnızca sayılar.
  return Response.json(totals)
})
