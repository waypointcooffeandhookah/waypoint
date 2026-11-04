// Yedek → restore.sql → boş veritabanı gidiş-dönüşü (scripts/staging-restore-sql.mjs). Uzak veritabanına bağlanmaz.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, createUser, rpc, addTable, menuItem, ANON } from './db-harness.mjs'

const TABLES = ['categories', 'menu_items', 'menu_promotion', 'social_settings', 'restaurant_tables', 'table_qr_tokens', 'staff_profiles',
  'fulfillment_settings', 'delivery_zones', 'table_sessions', 'bills', 'orders', 'order_items', 'order_fulfillments',
  'order_status_history', 'payments', 'audit_log']
const root = new URL('../../', import.meta.url)
const RESTORE_SCRIPT = fileURLToPath(new URL('scripts/staging-restore-sql.mjs', root))
const EXTRA = ['supabase_promotion.sql', 'supabase_social.sql', 'supabase_category_order.sql']

async function freshDb() {
  const db = await createDb()
  await db.exec(readFileSync(new URL('supabase/staging/04_multichannel_seed.sql', root), 'utf8'))
  for (const file of EXTRA) await db.exec(readFileSync(new URL(file, root), 'utf8'))
  return db
}

test('yedekten üretilen restore.sql tüm tabloları birebir geri yükler; sayaçlar ilerler, sistem çalışır', async () => {
  const source = await freshDb()
  const waiter = await createUser(source, { staffRole: 'waiter', name: 'Garson' })
  const table = await addTable(source, 'Yedek Masası')
  const { rows: [first] } = await source.query('select name from public.menu_items where price > 0 and is_available limit 1')
  const item = await menuItem(source, first.name)
  const items = JSON.stringify([{ menu_item_id: item.id, quantity: 20 }])
  for (let i = 0; i < 3; i++) await rpc(source, waiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items })
  await rpc(source, ANON, 'place_qr_order', { p_table_token: table.token, p_idempotency_key: randomUUID(), p_items: items }).catch(() => null)

  // npm run backup:staging çıktısıyla aynı biçim: data/*.json + manifest.json (özetler ve satır sayıları).
  const dir = mkdtempSync(join(tmpdir(), 'wp-yedek-'))
  mkdirSync(join(dir, 'data'))
  const manifest = { created_at: new Date().toISOString(), project_ref: 'jnnjijmdzcjglclcnwtm', repo_commit: null, tables: {}, files: {} }
  const before = {}
  for (const name of TABLES) {
    const { rows } = await source.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) j from public.${name} t`)
    const content = JSON.stringify(rows[0].j)
    writeFileSync(join(dir, 'data', `${name}.json`), content)
    manifest.files[`data/${name}.json`] = createHash('sha256').update(content).digest('hex')
    manifest.tables[name] = { rows: rows[0].j.length }
    before[name] = rows[0].j.length
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  execFileSync(process.execPath, [RESTORE_SCRIPT, dir])
  const restoreSql = readFileSync(join(dir, 'restore.sql'), 'utf8')

  const target = await freshDb()
  await target.exec(restoreSql)
  for (const name of TABLES) {
    const { rows: [{ n }] } = await target.query(`select count(*)::int n from public.${name}`)
    assert.equal(n, before[name], name)
  }
  const sums = async db => (await db.query('select (select sum(subtotal_cents) from public.orders)::text s, (select max(order_number) from public.orders) m')).rows[0]
  const [a, b] = [await sums(source), await sums(target)]
  assert.deepEqual(b, a)

  // Geri yüklenen veride yeni sipariş çakışmasız numara alır (order_number dizisi ilerletildi).
  const restoredWaiter = await createUser(target, { staffRole: 'waiter', name: 'Garson 2' })
  const placed = await rpc(target, restoredWaiter, 'place_staff_order', { p_table_id: table.id, p_idempotency_key: randomUUID(), p_items: items })
  assert.ok(placed.order_number > a.m)

  // Bozuk yedekten SQL üretilmez.
  writeFileSync(join(dir, 'data', 'orders.json'), '[]')
  assert.throws(() => execFileSync(process.execPath, [RESTORE_SCRIPT, dir], { stdio: 'pipe' }))
})
