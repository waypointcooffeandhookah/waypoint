// Supabase bağlantı bilgileri
import { resolveSupabaseTarget } from './supabaseTarget'

const target = resolveSupabaseTarget(import.meta.env, {
  url: 'https://vuqypdluduvqklickadn.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1cXlwZGx1ZHV2cWtsaWNrYWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNDM4MDYsImV4cCI6MjEwNzYxOTgwNn0.nZnOenXLrsPubBn3ZBGLPLhc4kd1uhPXiYJQ-UW_8RM',
})

export const SUPABASE_URL = target.url
export const SUPABASE_ANON_KEY = target.key
export const IS_STAGING = target.staging
export const CONFIG_ERROR = target.error
