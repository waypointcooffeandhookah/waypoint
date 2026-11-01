import { supabase } from '../supabaseClient'
import { createLiveBackend } from '../pos/backend/liveBackend'
import { useOrderSync } from '../pos/useOrderSync'

// Mevcut sipariş eşitlemesi: Realtime sinyali, düzenli okuma ve yeniden bağlanınca okuma.
export const adminBackend = createLiveBackend(supabase)
export const useAdminSync = (load, pollMs = 20000) => useOrderSync(adminBackend, load, pollMs)
