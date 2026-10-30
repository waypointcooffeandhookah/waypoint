// Personel oturumu ve POS rolü. Yetki her zaman sunucuda (RLS + RPC) yeniden doğrulanır;
// buradaki kontrol yalnızca doğru ekranı göstermek içindir.
export const WAITER_ROLES = ['waiter', 'manager', 'admin']
export const KITCHEN_ROLES = ['kitchen', 'manager', 'admin']

// POS şeması yoksa (migration uygulanmamış) DEMO moduna geçilir.
// Anonim kullanıcı için tablo varsa "yetki yok", yoksa "tablo bulunamadı" döner.
export async function detectPosMode(supabase, search = '') {
  if (new URLSearchParams(search).has('demo')) return 'demo'
  // HEAD isteği tablo yokken de hatasız 204 döndürür; bu yüzden GET kullanılır.
  const { error } = await supabase.from('restaurant_tables').select('id').limit(1)
  if (!error) return 'live'
  if (error.code === 'PGRST205' || error.code === '42P01') return 'demo'
  if (error.code === '42501') return 'live'
  return 'unreachable'
}

export async function getStaff(supabase) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const [{ data: role, error }, { data: profile }] = await Promise.all([
    supabase.rpc('pos_current_role'),
    supabase.from('staff_profiles').select('display_name').eq('user_id', session.user.id).maybeSingle(),
  ])
  if (error) throw error
  return { id: session.user.id, role, name: profile?.display_name || session.user.email }
}

export async function signInStaff(supabase, email, password, roles = WAITER_ROLES) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: 'credentials' }
  const staff = await getStaff(supabase)
  if (!roles.includes(staff?.role)) {
    await supabase.auth.signOut()
    return { error: 'forbidden' }
  }
  return { staff }
}
