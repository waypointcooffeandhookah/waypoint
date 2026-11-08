// Yönetici rolü eşitleme (20261110090000_staff_admin_sync.sql)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDb, createUser, rpc, rpcError } from './db-harness.mjs'

const db = await createDb()
const owner = await createUser(db, { role: 'admin', staffRole: 'admin', name: 'Patron' })
const legacy = await createUser(db, { role: 'admin', name: 'Eski menü yöneticisi' }) // personel kaydı yok
const appRole = async id => (await db.query("select raw_app_meta_data ->> 'role' as role from auth.users where id = $1", [id])).rows[0].role
const upsert = (actor, user, role, active = true) => rpc(db, actor, 'upsert_staff_profile', { p_user_id: user.id, p_display_name: 'Kişi', p_role: role, p_is_active: active })
const currentRole = user => rpc(db, user, 'pos_current_role', {})
// Oturum (JWT) app_metadata'yı veritabanından okur gibi: güncel izinle yeni bir oturum.
const fresh = async user => ({ ...user, claims: { ...user.claims, app_metadata: (await db.query('select raw_app_meta_data from auth.users where id = $1', [user.id])).rows[0].raw_app_meta_data } })

test('Personel ekranında Yönetici yapılan kişi panel iznini alır; düşürülünce kaybeder', async () => {
  const person = await createUser(db, { staffRole: 'waiter', name: 'Ayşe' })
  assert.equal(await appRole(person.id), null)
  await upsert(owner, person, 'admin')
  assert.equal(await appRole(person.id), 'admin')
  await upsert(owner, person, 'waiter')
  assert.equal(await appRole(person.id), null)
  await upsert(owner, person, 'admin')
  await upsert(owner, person, 'admin', false)
  assert.equal(await appRole(person.id), null, 'erişimi kapatılan yönetici izni kaldırıldı')
})

test('eski oturumdaki yönetici izni, personel kaydı düşürülünce POS yetkisi vermez (anında)', async () => {
  const person = await createUser(db, { staffRole: 'waiter', name: 'Mehmet' })
  await upsert(owner, person, 'admin')
  const oldSession = await fresh(person) // app_metadata.role = admin içeren oturum
  assert.equal(await currentRole(oldSession), 'admin')
  await upsert(owner, person, 'kitchen')
  assert.equal(await currentRole(oldSession), 'kitchen', 'personel kaydı esas')
  await upsert(owner, person, 'kitchen', false)
  assert.equal(await currentRole(oldSession), null, 'pasif personel yetkisiz')
  assert.match(await rpcError(db, oldSession, 'upsert_staff_profile', { p_user_id: person.id, p_display_name: 'X', p_role: 'admin', p_is_active: true }), /forbidden/)
})

test('personel kaydı olmayan eski yönetici eskisi gibi çalışır', async () => {
  assert.equal(await currentRole(legacy), 'admin')
  assert.equal(await appRole(legacy.id), 'admin')
})

test('son aktif yönetici düşürülemez/kapatılamaz; ikinci yönetici varsa olur', async () => {
  await db.query("update public.staff_profiles set role = 'waiter' where role = 'admin' and user_id <> $1", [owner.id])
  assert.match(await rpcError(db, owner, 'upsert_staff_profile', { p_user_id: owner.id, p_display_name: 'Patron', p_role: 'waiter', p_is_active: true }), /last_admin/)
  assert.match(await rpcError(db, owner, 'upsert_staff_profile', { p_user_id: owner.id, p_display_name: 'Patron', p_role: 'admin', p_is_active: false }), /last_admin/)
  assert.equal(await appRole(owner.id), 'admin')
  const second = await createUser(db, { staffRole: 'manager', name: 'Müdür' })
  await upsert(owner, second, 'admin')
  await upsert(second, owner, 'manager')
  assert.equal(await appRole(owner.id), null)
})

test('migration tekrar çalıştırılabilir ve mevcut kayıtları eşitler', async () => {
  const person = await createUser(db, { staffRole: 'waiter', name: 'Elle bozulan' })
  await db.query(`update auth.users set raw_app_meta_data = '{"role":"admin","provider":"email"}' where id = $1`, [person.id])
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261110090000_staff_admin_sync.sql', import.meta.url), 'utf8'))
  const { rows: [row] } = await db.query('select raw_app_meta_data from auth.users where id = $1', [person.id])
  assert.deepEqual(row.raw_app_meta_data, { provider: 'email' }, 'yalnızca rol kaldırıldı, diğer alanlar korundu')
})
