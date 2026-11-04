// e2e test yetkisi sarmalayıcısı: başlık YALNIZCA Supabase REST isteklerine eklenir; sır başka yere gitmez.
import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { installTestGrant, testGrantScript } from '../e2e/testGrant.mjs'

function sandbox() {
  const calls = []
  const window = { fetch: async (input, init) => { calls.push({ url: typeof input === 'string' ? input : input.url ?? String(input), headers: new Headers(init?.headers) }); return 'ok' } }
  return { calls, context: { window, Headers, Request, URL } }
}

test('yalnızca https://<ref>.supabase.co/rest/v1/ isteklerine başlık eklenir; mevcut başlıklar korunur', async () => {
  const { calls, context } = sandbox()
  runInNewContext(testGrantScript('gizli-deger'), context)
  const { fetch } = context.window
  await fetch('https://jnnjijmdzcjglclcnwtm.supabase.co/rest/v1/rpc/place_qr_order', { method: 'POST', headers: { apikey: 'k', 'content-type': 'application/json' } })
  await fetch(new Request('https://jnnjijmdzcjglclcnwtm.supabase.co/rest/v1/menu_items', { headers: { apikey: 'k' } }))
  for (const other of ['https://waypointcoffeandhookah.netlify.app/assets/a.js', 'https://jnnjijmdzcjglclcnwtm.supabase.co/storage/v1/object/public/x.jpg',
    'https://jnnjijmdzcjglclcnwtm.supabase.co/auth/v1/token', 'https://evil.example/rest/v1/x', 'https://x.supabase.co.evil.example/rest/v1/']) await fetch(other)
  assert.equal(calls[0].headers.get('x-waypoint-test-grant'), 'gizli-deger')
  assert.equal(calls[0].headers.get('apikey'), 'k')
  assert.equal(calls[0].headers.get('content-type'), 'application/json')
  assert.equal(calls[1].headers.get('x-waypoint-test-grant'), 'gizli-deger')
  assert.equal(calls[1].headers.get('apikey'), 'k', 'Request nesnesindeki başlıklar korunur')
  for (const call of calls.slice(2)) assert.equal(call.headers.get('x-waypoint-test-grant'), null, call.url)
})

test('E2E_TEST_GRANT yoksa tarayıcıya hiçbir şey eklenmez', async () => {
  const sent = []
  const cdp = async (method, params) => { sent.push({ method, params }) }
  assert.equal(await installTestGrant(cdp, {}), false)
  assert.equal(sent.length, 0)
  assert.equal(await installTestGrant(cdp, { E2E_TEST_GRANT: 'x' }), true)
  assert.equal(sent[0].method, 'Page.addScriptToEvaluateOnNewDocument')
})
