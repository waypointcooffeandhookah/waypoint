import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readMenuCache, writeMenuCache } from '../src/utils/menuCache.js'
import { isAdmin } from '../src/utils/adminAccess.js'

const key = 'test-menu'
function memory() {
  const data = new Map()
  return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
}
test('menu cache roundtrip, including an empty menu', () => {
  const storage = memory()
  writeMenuCache(key, [{ id: 'cat', name: 'Kahve' }], [], storage)
  assert.equal(readMenuCache(key, storage).categories[0].name, 'Kahve')
  assert.deepEqual(readMenuCache(key, storage).items, [])
})
test('corrupt, expired, future-dated and incompatible data is ignored', () => {
  const storage = memory()
  for (const raw of ['oops', '{}', JSON.stringify({ version: 1, savedAt: 1, categories: [], items: [] }), JSON.stringify({ version: 1, savedAt: Date.now() + 100000, categories: [], items: [] }), JSON.stringify({ version: 1, savedAt: Date.now(), categories: [{}], items: [] })]) {
    storage.setItem(key, raw)
    assert.equal(readMenuCache(key, storage), null)
  }
})
test('blocked storage does not prevent loading', () => {
  const storage = { getItem() { throw Error('blocked') }, setItem() { throw Error('full') } }
  assert.equal(readMenuCache(key, storage), null)
  assert.doesNotThrow(() => writeMenuCache(key, [], [], storage))
})
test('only server-controlled app metadata grants admin access', () => {
  assert.equal(isAdmin(null), false)
  assert.equal(isAdmin({ user_metadata: { role: 'admin' } }), false)
  assert.equal(isAdmin({ app_metadata: { role: 'authenticated' } }), false)
  assert.equal(isAdmin({ app_metadata: { role: 'admin' } }), true)
})
