// Personel rolleri sadeleştirme (20261111090000_staff_roles_simplify.sql): yalnızca Admin/Garson/Mutfak, tek Admin.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDb, createUser, rpc, rpcError } from './db-harness.mjs'

const db = await createDb()
// Sadeleştirmeden önce var olan Müdür/Kasa kayıtları Garson'a çevrilmeli.
const oldManager = await createUser(db, { staffRole: 'manager', name: 'Eski Müdür' })
const oldCashier = await createUser(db, { staffRole: 'cashier', name: 'Eski Kasa' })
const admin = await createUser(db, { role: 'admin', staffRole: 'admin', name: 'Patron' })
await db.exec(readFileSync(new URL('../../supabase/migrations/20261111090000_staff_roles_simplify.sql', import.meta.url), 'utf8'))
const roleOf = async user => (await db.query('select role, is_active from public.staff_profiles where user_id = $1', [user.id])).rows[0]
const upsert = (user, role, active = true, name = 'Kişi') => rpc(db, admin, 'upsert_staff_profile', { p_user_id: user.id, p_display_name: name, p_role: role, p_is_active: active })
const upsertError = (user, role, active = true) => rpcError(db, admin, 'upsert_staff_profile', { p_user_id: user.id, p_display_name: 'Kişi', p_role: role, p_is_active: active })

test('Müdür/Kasa kayıtları Garson oldu; Admin aynı kaldı', async () => {
  assert.equal((await roleOf(oldManager)).role, 'waiter')
  assert.equal((await roleOf(oldCashier)).role, 'waiter')
  assert.deepEqual(await roleOf(admin), { role: 'admin', is_active: true })
  assert.equal(await rpc(db, admin, 'pos_current_role', {}), 'admin')
})

test('personele yalnızca Garson/Mutfak atanır', async () => {
  const person = await createUser(db, { name: 'Yeni' })
  await upsert(person, 'kitchen')
  assert.equal((await roleOf(person)).role, 'kitchen')
  await upsert(person, 'waiter')
  assert.equal((await roleOf(person)).role, 'waiter')
  for (const role of ['admin', 'manager', 'cashier', 'owner']) assert.match(await upsertError(person, role), /role_not_allowed/)
  const stranger = await createUser(db, { name: 'Dışarıdan' })
  assert.match(await upsertError(stranger, 'admin'), /role_not_allowed/, 'yeni Admin oluşturulamaz')
  assert.equal(await roleOf(stranger), undefined)
})

test('tek Admin: rolü değiştirilemez, kapatılamaz; adı güncellenebilir; ikinci Admin kaydı veritabanında da engelli', async () => {
  assert.match(await upsertError(admin, 'waiter'), /last_admin/)
  assert.match(await upsertError(admin, 'admin', false), /last_admin/)
  await upsert(admin, 'admin', true, 'Patron Bey')
  assert.deepEqual(await roleOf(admin), { role: 'admin', is_active: true })
  const other = await createUser(db, { name: 'İkinci' })
  await assert.rejects(db.query("insert into public.staff_profiles(user_id, display_name, role) values ($1, 'X', 'admin')", [other.id]), /staff_profiles_single_admin|duplicate/)
  await assert.rejects(db.query("update public.staff_profiles set role = 'manager' where user_id = $1", [oldManager.id]), /check/)
})

test('Garson/Mutfak personel yönetemez; migration tekrar çalıştırılabilir', async () => {
  const waiter = await createUser(db, { staffRole: 'waiter', name: 'Garson' })
  assert.match(await rpcError(db, waiter, 'upsert_staff_profile', { p_user_id: waiter.id, p_display_name: 'G', p_role: 'kitchen', p_is_active: true }), /forbidden/)
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261111090000_staff_roles_simplify.sql', import.meta.url), 'utf8'))
  assert.deepEqual(await roleOf(admin), { role: 'admin', is_active: true })
})
