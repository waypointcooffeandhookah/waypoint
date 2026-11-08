// Yönetim paneli → Personel: hesap açma ve şifre değiştirme.
// Tarayıcı hesap açamaz (service_role gerekir); bu fonksiyon yalnızca sunucuda çalışır ve anahtarı hiçbir yere döndürmez.
//
// Yetki: çağıranın kendi oturumu (Authorization başlığı) ile pos_has_role(['admin']) sorulur; yönetici değilse hiçbir şey yapılmaz.
// Personel kaydı yine çağıranın kimliğiyle upsert_staff_profile RPC'sinden geçer (denetim kaydında yönetici görünür).
// Hesap açılıp profil yazılamazsa yeni hesap geri silinir (yarım kayıt kalmaz).
// SUPABASE_URL, SUPABASE_ANON_KEY ve SUPABASE_SERVICE_ROLE_KEY Edge ortamınca otomatik verilir.
// Dağıtım: npx supabase functions deploy staff-account --project-ref <ref>   (JWT doğrulaması açık kalır)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { validateRequest } from './validate.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const env = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`missing_env_${name}`)
  return value
}

// deno-lint-ignore no-explicit-any
async function findUserByEmail(service: any, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const found = data.users.find((user: { email?: string }) => user.email?.toLowerCase() === email)
    if (found) return found
    if (data.users.length < 200) return null
  }
  return null
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' })
  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'unauthorized' })

  let body: unknown
  try { body = await request.json() } catch { return reply(400, { error: 'invalid_request' }) }
  const parsed = validateRequest(body)
  if (!parsed.ok) return reply(400, { error: parsed.code })

  const url = env('SUPABASE_URL')
  const caller = createClient(url, env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  })
  const { data: isAdmin, error: roleError } = await caller.rpc('pos_has_role', { p_roles: ['admin'] })
  if (roleError || isAdmin !== true) return reply(403, { error: 'forbidden' })

  const service = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const input = parsed.value as unknown as { action: string; email: string; displayName: string; role: string; password: string; userId: string }

  try {
    if (input.action === 'set_password') {
      const { data: profile } = await service.from('staff_profiles').select('user_id').eq('user_id', input.userId).maybeSingle()
      if (!profile) return reply(404, { error: 'not_staff' })
      const { error } = await service.auth.admin.updateUserById(input.userId, { password: input.password })
      if (error) return reply(400, { error: error.code === 'weak_password' ? 'weak_password' : 'auth_failed' })
      return reply(200, { ok: true })
    }

    // Yeni hesap; e-posta zaten kayıtlıysa (ör. Supabase panelinde açılmışsa) şifresine dokunmadan personele bağlanır.
    const appMetadata = input.role === 'admin' ? { role: 'admin' } : {}
    let userId: string
    let created = false
    const { data: made, error: createError } = await service.auth.admin.createUser({
      email: input.email, password: input.password, email_confirm: true, app_metadata: appMetadata,
    })
    if (made?.user) {
      userId = made.user.id
      created = true
    } else if (createError?.code === 'email_exists' || /already/i.test(createError?.message ?? '')) {
      const existing = await findUserByEmail(service, input.email)
      if (!existing) return reply(409, { error: 'email_exists' })
      const { data: profile } = await service.from('staff_profiles').select('user_id').eq('user_id', existing.id).maybeSingle()
      if (profile) return reply(409, { error: 'already_staff' })
      userId = existing.id
      if (input.role === 'admin') await service.auth.admin.updateUserById(userId, { app_metadata: { ...existing.app_metadata, role: 'admin' } })
    } else {
      return reply(400, { error: createError?.code === 'weak_password' ? 'weak_password' : 'auth_failed' })
    }

    const { error: profileError } = await caller.rpc('upsert_staff_profile', {
      p_user_id: userId, p_display_name: input.displayName, p_role: input.role, p_is_active: true,
    })
    if (profileError) {
      if (created) await service.auth.admin.deleteUser(userId)
      return reply(400, { error: 'profile_failed' })
    }
    return reply(200, { ok: true, userId, linked: !created })
  } catch (error) {
    console.error('[staff-account]', error instanceof Error ? error.message : 'error')
    return reply(500, { error: 'server_error' })
  }
})
