import test from 'node:test'
import assert from 'node:assert/strict'
import { isChunkLoadError, reloadOnce } from '../../src/utils/chunkReload.js'

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) } }

test('yeni sürüm parça hatası tanınır; sıradan hata değil', () => {
  assert.ok(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js')))
  assert.ok(isChunkLoadError(new TypeError('Importing a module script failed.'))) // Safari
  assert.ok(!isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")))
})

test('otomatik yenileme döngüye girmez: 30 sn içinde ikinci kez yenilemez', () => {
  const store = memory()
  let reloads = 0
  assert.equal(reloadOnce(1_000_000, store, () => reloads++), true)
  assert.equal(reloadOnce(1_010_000, store, () => reloads++), false)
  assert.equal(reloadOnce(1_040_001, store, () => reloads++), true)
  assert.equal(reloads, 2)
  const broken = { getItem() { throw new Error('kapalı') }, setItem() { throw new Error('kapalı') } }
  assert.equal(reloadOnce(Date.now(), broken, () => reloads++), true, 'depolama kapalıyken de bir kez dener')
})

test('mutfak sesi: askıya alınan ses motoru uyandırılır, döngüye girmez; hata ekranı etkilemez', async () => {
  const { createChime } = await import('../../src/pos/kitchen/kitchenSound.js')
  let resumes = 0, tones = 0
  const fake = { state: 'suspended', currentTime: 0, destination: {},
    resume() { resumes++; return Promise.resolve() }, // durum "suspended" kalırsa yeniden denemez
    createOscillator() { tones++; return { frequency: {}, connect: () => ({ connect() {} }), start() {}, stop() {} } },
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } } } }
  globalThis.window = { AudioContext: function () { return fake } }
  const chime = createChime()
  chime.unlock()
  chime.play()
  await new Promise(r => setTimeout(r, 10))
  assert.equal(tones, 0, 'uyanmadıysa ses yok, sonsuz deneme yok')
  assert.equal(resumes, 2, 'unlock + play birer kez')
  fake.state = 'running'
  chime.play()
  assert.equal(tones, 2, 'iki notalı zil çalar')
  fake.createOscillator = () => { throw new Error('ses kapalı') }
  assert.doesNotThrow(() => chime.play())
  delete globalThis.window
})
