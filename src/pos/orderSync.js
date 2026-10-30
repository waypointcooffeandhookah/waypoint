// Ekranları kalıcı kayıtlarla eşitler. Anlık bildirim yalnızca "yeniden oku" sinyalidir;
// bildirim kaçsa bile düzenli yenileme ve yeniden bağlanma sonrası okuma siparişi yakalar.
export function startOrderSync({ subscribe, refresh, onConnection = () => {}, pollMs = 15000, target = globalThis.window, doc = globalThis.document }) {
  let stopped = false
  let running = false
  let dirty = false

  // Üst üste binen okumalar birleştirilir; eski bir yanıt yenisini ezemez.
  async function run() {
    if (stopped) return
    if (running) { dirty = true; return }
    running = true
    try { await refresh() } catch { /* Hata durumunu refresh kendisi ekrana taşır. */ }
    running = false
    if (dirty) { dirty = false; run() }
  }

  const onVisible = () => { if (doc?.visibilityState !== 'hidden') run() }
  const unsubscribe = subscribe(run, next => {
    if (stopped) return
    onConnection(next)
    // İlk abonelik dahil her bağlantıda: aradaki kopukluğun kaçırdıkları okunur.
    if (next === 'connected') run()
  })
  const timer = setInterval(run, pollMs)
  target?.addEventListener('focus', run)
  target?.addEventListener('online', run)
  doc?.addEventListener('visibilitychange', onVisible)
  run()

  return {
    refresh: run,
    stop() {
      stopped = true
      clearInterval(timer)
      target?.removeEventListener('focus', run)
      target?.removeEventListener('online', run)
      doc?.removeEventListener('visibilitychange', onVisible)
      unsubscribe()
    },
  }
}
