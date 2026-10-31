// Supabase'in auth şemasını ve anon/authenticated rollerini taklit eden,
// bellekte çalışan gerçek Postgres (PGlite) test ortamı.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, raw_app_meta_data jsonb not null default '{}');
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant execute on all functions in schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Supabase'in public şemasındaki varsayılan yetkileri: yeni tablo, fonksiyon ve
  -- diziler anon/authenticated'a otomatik açılır. Migration bunları geri almalıdır.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`

export const MIGRATION = 'supabase/migrations/20261030120000_pos_foundation.sql'
export const readMigration = () => read(MIGRATION)

export async function createDb() {
  const db = new PGlite()
  await db.exec(AUTH_STUB)
  await db.exec(read('supabase_setup.sql'))
  await db.exec(readMigration())
  await db.exec(read('supabase/migrations/20261031090000_pos_fail_search_path.sql'))
  // Mevcut kurulum betiği menü tablolarını Supabase varsayılan yetkileriyle bıraktığı için
  // testte de okumayı açıyoruz (supabase_security.sql ile aynı).
  await db.exec('grant select on public.categories, public.menu_items to anon, authenticated')
  return db
}

export async function createUser(db, { role = null, staffRole = null, name = 'Test' } = {}) {
  const id = randomUUID()
  const appMeta = role ? { role } : {}
  await db.query('insert into auth.users(id, raw_app_meta_data) values ($1, $2)', [id, appMeta])
  if (staffRole) {
    await db.query('insert into public.staff_profiles(user_id, display_name, role) values ($1, $2, $3)', [id, name, staffRole])
  }
  return { id, claims: { sub: id, role: 'authenticated', app_metadata: appMeta } }
}

export const ANON = null

// Sorguyu Supabase'in PostgREST'te yaptığı gibi rol + JWT bağlamında çalıştırır.
export async function as(db, user, fn) {
  return db.transaction(async tx => {
    await tx.query(`set local role ${user ? 'authenticated' : 'anon'}`)
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(user?.claims ?? { role: 'anon' })])
    return fn(tx)
  })
}

export async function rpc(db, user, name, args) {
  const keys = Object.keys(args)
  const params = keys.map((key, i) => `${key} => $${i + 1}`).join(', ')
  const values = keys.map(key => args[key] !== null && typeof args[key] === 'object' && !Array.isArray(args[key]) ? JSON.stringify(args[key]) : args[key])
  return as(db, user, async tx => (await tx.query(`select public.${name}(${params}) as result`, values)).rows[0].result)
}

export async function rpcError(db, user, name, args) {
  try {
    await rpc(db, user, name, args)
  } catch (error) {
    return error.message
  }
  throw new Error(`${name} beklenen hatayı vermedi`)
}

export async function addTable(db, label) {
  const { rows: [table] } = await db.query('insert into public.restaurant_tables(label) values ($1) returning id', [label])
  const { rows: [qr] } = await db.query('select token from public.table_qr_tokens where table_id = $1', [table.id])
  return { id: table.id, token: qr.token }
}

export async function menuItem(db, name) {
  const { rows: [item] } = await db.query('select id, price from public.menu_items where name = $1', [name])
  return item
}
