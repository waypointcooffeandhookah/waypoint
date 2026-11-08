// Menü sıralaması (20261109090000_menu_sort_order.sql)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDb, createUser, rpc, rpcError, ANON } from './db-harness.mjs'

const db = await createDb()
const admin = await createUser(db, { role: 'admin', name: 'Yönetici' })
const waiter = await createUser(db, { staffRole: 'waiter', name: 'Garson' })
const { rows: [category] } = await db.query("insert into public.categories(name, sort_order) values ('Sıra Testi', 99) returning id")
const add = async name => (await db.query('insert into public.menu_items(name, price, category_id) values ($1, 10, $2) returning id, sort_order', [name, category.id])).rows[0]
const idsInOrder = async () => (await db.query('select id from public.menu_items where category_id = $1 order by sort_order, created_at', [category.id])).rows.map(r => r.id)
const reorder = (user, kind, ids) => rpc(db, user, 'reorder_menu', { p_kind: kind, p_ids: ids })

test('mevcut ürünler kategori içinde 1..n numaralandı; yeni ürün kategorinin sonuna eklenir', async () => {
  const { rows } = await db.query('select category_id, array_agg(sort_order order by sort_order) as orders from public.menu_items group by category_id')
  for (const row of rows) assert.deepEqual(row.orders, row.orders.map((_, i) => i + 1), 'boşluksuz sıra')
  const a = await add('A'), b = await add('B'), c = await add('C')
  assert.deepEqual([a.sort_order, b.sort_order, c.sort_order], [1, 2, 3])
})

test('yönetici ürünleri sıralar; garson ve müşteri sıralayamaz', async () => {
  const [a, b, c] = await idsInOrder()
  assert.equal(await reorder(admin, 'items', [c, a, b]), 3)
  assert.deepEqual(await idsInOrder(), [c, a, b])
  assert.match(await rpcError(db, waiter, 'reorder_menu', { p_kind: 'items', p_ids: [a, b, c] }), /forbidden/)
  assert.match(await rpcError(db, ANON, 'reorder_menu', { p_kind: 'items', p_ids: [a, b, c] }), /permission denied|forbidden/)
  assert.deepEqual(await idsInOrder(), [c, a, b], 'yetkisiz deneme hiçbir şey değiştirmedi')
})

test('eksik/fazla/tekrarlı liste reddedilir ve hiçbir şey yazılmaz', async () => {
  const before = await idsInOrder()
  const [first, second, third] = before
  const { rows: [other] } = await db.query('select id from public.menu_items where category_id <> $1 limit 1', [category.id])
  assert.match(await rpcError(db, admin, 'reorder_menu', { p_kind: 'items', p_ids: [first, second] }), /stale_order/)
  assert.match(await rpcError(db, admin, 'reorder_menu', { p_kind: 'items', p_ids: [first, second, other.id] }), /stale_order/)
  assert.match(await rpcError(db, admin, 'reorder_menu', { p_kind: 'items', p_ids: [first, first, third] }), /invalid_order/)
  assert.match(await rpcError(db, admin, 'reorder_menu', { p_kind: 'xyz', p_ids: before }), /invalid_order/)
  assert.deepEqual(await idsInOrder(), before)
})

test('başka kategoriye taşınan ürün oranın sonuna geçer', async () => {
  const [moved] = await idsInOrder()
  const { rows: [target] } = await db.query("select c.id, max(m.sort_order) as last from public.categories c join public.menu_items m on m.category_id = c.id where c.id <> $1 group by c.id limit 1", [category.id])
  await db.query('update public.menu_items set category_id = $1 where id = $2', [target.id, moved])
  const { rows: [row] } = await db.query('select sort_order from public.menu_items where id = $1', [moved])
  assert.equal(row.sort_order, target.last + 1)
})

test('kategoriler sıralanır; eksik liste reddedilir; migration tekrar çalışınca sıra bozulmaz', async () => {
  const { rows } = await db.query('select id from public.categories order by sort_order, created_at')
  const reversed = rows.map(r => r.id).reverse()
  assert.equal(await reorder(admin, 'categories', reversed), reversed.length)
  assert.match(await rpcError(db, admin, 'reorder_menu', { p_kind: 'categories', p_ids: reversed.slice(1) }), /stale_order/)
  const items = await idsInOrder()
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261109090000_menu_sort_order.sql', import.meta.url), 'utf8'))
  assert.deepEqual((await db.query('select id from public.categories order by sort_order')).rows.map(r => r.id), reversed)
  assert.deepEqual(await idsInOrder(), items)
})
