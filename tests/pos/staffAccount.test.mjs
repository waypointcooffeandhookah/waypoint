// Personel hesabı: istek doğrulaması (Edge Function) ve panel mesajları
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRequest } from '../../supabase/functions/staff-account/validate.js'
import { callStaffAccount, staffAccountMessage } from '../../src/admin/adminData.js'

const create = extra => validateRequest({ action: 'create', email: ' Ayse@Ornek.com ', displayName: '  Ayşe   Y. ', role: 'waiter', password: 'gizli-123', ...extra })

test('hesap açma isteği temizlenir ve doğrulanır', () => {
  assert.deepEqual(create().value, { action: 'create', email: 'ayse@ornek.com', displayName: 'Ayşe Y.', role: 'waiter', password: 'gizli-123' })
  assert.equal(create({ email: 'ayse' }).code, 'invalid_email')
  assert.equal(create({ displayName: '   ' }).code, 'invalid_name')
  assert.equal(create({ role: 'owner' }).code, 'invalid_role')
  assert.equal(create({ password: 'kısa' }).code, 'weak_password')
  assert.equal(create({ password: 'x'.repeat(73) }).code, 'weak_password')
})

test('şifre değiştirme ve bilinmeyen işlem', () => {
  assert.equal(validateRequest({ action: 'set_password', userId: 'abc', password: '12345678' }).code, 'invalid_user')
  assert.equal(validateRequest({ action: 'set_password', userId: '3f2a9c1e-1111-4222-8333-444455556666', password: '12345678' }).ok, true)
  assert.equal(validateRequest({ action: 'delete_everything' }).code, 'invalid_action')
  assert.equal(validateRequest(null).code, 'invalid_action')
})

test('panel hata kodunu okur; ulaşılamazsa anlaşılır mesaj', async () => {
  const client = result => ({ functions: { invoke: async () => result } })
  assert.deepEqual(await callStaffAccount(client({ data: { ok: true, userId: 'u' }, error: null }), {}), { ok: true, data: { ok: true, userId: 'u' } })
  assert.deepEqual(await callStaffAccount(client({ error: { context: { status: 409, json: async () => ({ error: 'already_staff' }) } } }), {}), { ok: false, code: 'already_staff' })
  assert.deepEqual(await callStaffAccount(client({ error: { message: 'Failed to fetch' } }), {}), { ok: false, code: 'unreachable' })
  assert.deepEqual(await callStaffAccount({ functions: { invoke: async () => { throw new Error('x') } } }, {}), { ok: false, code: 'unreachable' })
  assert.match(staffAccountMessage('weak_password'), /8 karakter/)
  assert.match(staffAccountMessage('bilinmeyen'), /tamamlanamadı/)
})
