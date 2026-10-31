import test from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCTION_REF, STAGING_REF, resolveSupabaseTarget } from '../../src/supabaseTarget.js'
import { randomUUID } from '../../src/utils/uuid.js'
import { createDb, createUser, as, readMigration } from './db-harness.mjs'

const jwt = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
const STAGING_URL = `https://${STAGING_REF}.supabase.co`
const PROD_URL = `https://${PRODUCTION_REF}.supabase.co`
const fallback = { url: PROD_URL, key: 'prod-key' }
const resolve = env => resolveSupabaseTarget({ MODE: 'staging', ...env }, fallback)
const stagingKey = jwt({ ref: STAGING_REF, role: 'anon' })

test('staging: doğru ayarla staging projesine bağlanır', () => {
  assert.deepEqual(resolve({ VITE_SUPABASE_URL: STAGING_URL, VITE_SUPABASE_ANON_KEY: stagingKey }),
    { staging: true, error: null, url: STAGING_URL, key: stagingKey })
  assert.equal(resolve({ VITE_SUPABASE_URL: STAGING_URL, VITE_SUPABASE_ANON_KEY: 'sb_publishable_x' }).error, null)
})

test('staging: eksik veya yanlış ayarda üretime düşmez, kapalı kalır', () => {
  const cases = [
    {},
    { VITE_SUPABASE_URL: STAGING_URL },
    { VITE_SUPABASE_URL: PROD_URL, VITE_SUPABASE_ANON_KEY: stagingKey },
    { VITE_SUPABASE_URL: 'https://baska.supabase.co', VITE_SUPABASE_ANON_KEY: stagingKey },
    { VITE_SUPABASE_URL: STAGING_URL, VITE_SUPABASE_ANON_KEY: jwt({ ref: PRODUCTION_REF, role: 'anon' }) },
    { VITE_SUPABASE_URL: STAGING_URL, VITE_SUPABASE_ANON_KEY: jwt({ ref: STAGING_REF, role: 'service_role' }) },
    { VITE_SUPABASE_URL: STAGING_URL, VITE_SUPABASE_ANON_KEY: 'bozuk' },
  ]
  for (const env of cases) {
    const target = resolve(env)
    assert.ok(target.error, JSON.stringify(env))
    assert.ok(!target.url.includes(PRODUCTION_REF) && !target.url.includes(STAGING_REF), target.url)
    assert.equal(target.key, 'invalid')
  }
})

test('üretim modu: mevcut davranış korunur', () => {
  assert.deepEqual(resolveSupabaseTarget({ MODE: 'production' }, fallback), { staging: false, error: null, url: PROD_URL, key: 'prod-key' })
  assert.equal(resolveSupabaseTarget({ MODE: 'production', VITE_SUPABASE_URL: 'https://a.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' }, fallback).url, 'https://a.supabase.co')
})

test('uuid: randomUUID olmayan güvensiz bağlamda da geçerli v4 üretir', () => {
  const insecure = { getRandomValues: bytes => globalThis.crypto.getRandomValues(bytes) }
  const seen = new Set()
  for (let i = 0; i < 500; i++) {
    const id = randomUUID(insecure)
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    seen.add(id)
  }
  assert.equal(seen.size, 500)
})

test('uuid: güvenli kaynak yoksa zayıf kimlik üretmez, hata verir', () => {
  assert.throws(() => randomUUID({}), /Güvenli rastgele/)
})

test('migration tekrar çalışınca elle eklenen politikayı ve tetikleyiciyi korur, DROP içermez', async () => {
  assert.doesNotMatch(readMigration().replace(/--.*$/gm, ''), /\b(drop|truncate)\b|delete from/i)
  const db = await createDb()
  await db.exec(`create policy "Elle eklenen" on public.orders for select to authenticated using (false)`)
  await db.exec(readMigration())
  const { rows } = await db.query(`select policyname from pg_policies where schemaname = 'public' and tablename = 'orders' order by 1`)
  assert.deepEqual(rows.map(r => r.policyname), ['Elle eklenen', 'Staff read orders'])
  const triggers = await db.query(`select count(*)::int as n from pg_trigger where tgname = 'restaurant_tables_create_token'`)
  assert.equal(triggers.rows[0].n, 1)
})

test('pos_private.fail arama yolu sabittir, RLS açık kalır ve anonim yetkisi genişlemez', async () => {
  const db = await createDb()
  const { rows: [fn] } = await db.query(`select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pos_private' and p.proname = 'fail'`)
  assert.deepEqual(fn.proconfig, ['search_path=pg_catalog, pg_temp'])
  const { rows } = await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
  assert.deepEqual(rows, [])
  const waiter = await createUser(db, { staffRole: 'waiter' })
  await assert.rejects(as(db, waiter, tx => tx.query('select * from pos_private.table_by_token($1)', ['a'.repeat(64)])), /permission denied/)
})
