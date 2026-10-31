import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PRODUCTION_REF, STAGING_REF } from '../src/supabaseTarget.js'
import { ACCOUNTS, STAGING_URL, checkAdminKey, guardedFetch, newPassword, provisionStaff } from './staging-staff.lib.mjs'

const jwt = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
const SECRET_MARK = 'GIZLI-DEGER-123'

function fakeAdmin({ users = [], profiles = {}, failCreate = null } = {}) {
  const calls = { created: [], inserted: [], forbidden: [] }
  const forbid = name => (...args) => { calls.forbidden.push(name, args); return { error: null } }
  return {
    calls,
    auth: { admin: {
      listUsers: async () => ({ data: { users }, error: null }),
      createUser: async input => {
        if (failCreate === input.email) return { data: null, error: { message: 'reddedildi' } }
        calls.created.push(input)
        return { data: { user: { id: `id-${input.email}`, email: input.email } }, error: null }
      },
      updateUserById: forbid('updateUserById'),
      deleteUser: forbid('deleteUser'),
    } },
    from: () => ({
      select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: profiles[id] ? { role: profiles[id] } : null, error: null }) }) }),
      insert: async row => { calls.inserted.push(row); return { error: null } },
      upsert: forbid('upsert'), update: forbid('update'), delete: forbid('delete'),
    }),
  }
}

test('anahtar: sb_secret_ ve staging service_role kabul edilir', () => {
  assert.equal(checkAdminKey('sb_secret_abcdefghijklmnop'), 'secret')
  assert.equal(checkAdminKey(jwt({ ref: STAGING_REF, role: 'service_role' })), 'legacy')
})

test('anahtar: üretim, anon, publishable ve bozuk anahtar reddedilir; hata anahtarı içermez', () => {
  for (const key of [
    jwt({ ref: PRODUCTION_REF, role: 'service_role', x: SECRET_MARK }),
    jwt({ ref: STAGING_REF, role: 'anon', x: SECRET_MARK }),
    `sb_publishable_${SECRET_MARK}`, SECRET_MARK, '',
  ]) {
    assert.throws(() => checkAdminKey(key), error => !error.message.includes(SECRET_MARK))
  }
})

test('istek koruması: yalnızca staging kökeni, yönlendirme izlenmez', async () => {
  let seen
  await guardedFetch(`${STAGING_URL}/auth/v1/admin/users`, {}, async (_u, init) => { seen = init })
  assert.equal(seen.redirect, 'error')
  for (const url of [`https://${PRODUCTION_REF}.supabase.co/auth/v1/admin/users`, `https://${STAGING_REF}.supabase.co.kotu.example/x`]) {
    assert.throws(() => guardedFetch(url, {}, async () => assert.fail('istek gitti')), /engellendi/)
  }
})

test('şifre: güçlü ve benzersiz', () => {
  const all = Array.from({ length: 200 }, newPassword)
  assert.equal(new Set(all).size, 200)
  assert.ok(all.every(password => /^[A-Za-z0-9_-]{32}$/.test(password)))
})

test('yeni kurulum: üç hesap doğru rolle Admin API ile oluşur, yalnızca admin yönetici yetkisi alır', async () => {
  const admin = fakeAdmin(), saved = [], logs = []
  const credentials = {}
  await provisionStaff(admin, credentials, c => saved.push(structuredClone(c)), l => logs.push(l))
  assert.deepEqual(admin.calls.created.map(c => c.app_metadata), [{ role: 'admin' }, {}, {}])
  assert.ok(admin.calls.created.every(c => c.email_confirm === true && c.email.endsWith('@waypoint-staging.test')))
  assert.deepEqual(admin.calls.inserted.map(r => r.role), ['admin', 'waiter', 'kitchen'])
  assert.equal(new Set(Object.values(credentials).map(c => c.password)).size, 3)
  for (const { password } of Object.values(credentials)) assert.ok(!logs.join('\n').includes(password), 'şifre loglandı')
  assert.equal(saved.length, 3)
})

test('mevcut hesap: şifre, yetki ve profil değiştirilmez', async () => {
  const users = ACCOUNTS.map(a => ({ id: a.role, email: a.email }))
  const profiles = { admin: 'admin', waiter: 'manager', kitchen: 'kitchen' }
  const admin = fakeAdmin({ users, profiles }), logs = []
  const credentials = { admin: { email: 'x', password: 'eski' } }
  await provisionStaff(admin, credentials, () => assert.fail('dosya yazılmamalı'), l => logs.push(l))
  assert.deepEqual(admin.calls, { created: [], inserted: [], forbidden: [] })
  assert.equal(credentials.admin.password, 'eski')
  assert.match(logs.join('\n'), /profil rolü "manager"/)
})

test('oluşturma hatası başka bir hesaba yazmaz; tamamlananın şifresi kayıtlıdır', async () => {
  const admin = fakeAdmin({ failCreate: ACCOUNTS[1].email }), credentials = {}
  await assert.rejects(provisionStaff(admin, credentials, () => {}, () => {}), /oluşturulamadı/)
  assert.deepEqual(Object.keys(credentials), ['admin'])
  assert.deepEqual(admin.calls.forbidden, [])
})

test('betik: anahtarı ortam değişkeninden veya yazdırarak kullanmaz', () => {
  const source = readFileSync(new URL('./staging-create-staff.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /process\.env/)
  assert.doesNotMatch(source, /console\.\w+\([^)]*\b(key|password)\b/)
})
