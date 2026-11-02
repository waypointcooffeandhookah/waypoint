// Supabase bağlantı bilgileri
import { resolveSupabaseTarget } from './supabaseTarget'

// import.meta.env.MODE derleme anında sabitlenir: staging paketinde üretim adresi ve anahtarı hiç bulunmaz
// (scripts/cloudflare-build.mjs paketi tarayarak bunu doğrular).
const PRODUCTION_FALLBACK = import.meta.env.MODE === 'staging' ? null : {
  url: 'https://vuqypdluduvqklickadn.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1cXlwZGx1ZHV2cWtsaWNrYWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNDM4MDYsImV4cCI6MjEwNzYxOTgwNn0.nZnOenXLrsPubBn3ZBGLPLhc4kd1uhPXiYJQ-UW_8RM',
}

const target = resolveSupabaseTarget(import.meta.env, PRODUCTION_FALLBACK)

export const SUPABASE_URL = target.url
export const SUPABASE_ANON_KEY = target.key
export const IS_STAGING = target.staging
export const CONFIG_ERROR = target.error
// Web Push GENEL (VAPID public) anahtarı. Yalnızca staging'de kullanılır; özel anahtar asla buraya gelmez.
export const WEB_PUSH_PUBLIC_KEY = target.staging && !target.error ? (import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || '') : ''
