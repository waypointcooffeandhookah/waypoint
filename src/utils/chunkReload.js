// Yeni sürüm yayınlanınca açık kalan sekme (mutfak tableti, garson telefonu) eski parça dosyasını ister;
// Netlify onu artık sunmaz. Bu durumda sayfa bir kez kendini yeniler (döngüye girmesin diye 30 sn kilit).
const RELOAD_KEY = 'waypoint-chunk-reload-at'
export const isChunkLoadError = error => /dynamically imported module|Importing a module script failed|error loading dynamically|Loading chunk|ChunkLoadError|Unable to preload CSS/i.test(`${error?.name ?? ''} ${error?.message ?? error ?? ''}`)

export function reloadOnce(now = Date.now(), storage = globalThis.sessionStorage, reload = () => window.location.reload()) {
  let last = 0
  try { last = Number(storage.getItem(RELOAD_KEY)) || 0 } catch { /* depolama kapalı */ }
  if (now - last < 30000) return false
  try { storage.setItem(RELOAD_KEY, String(now)) } catch { /* depolama kapalı: yine de bir kez dene */ }
  reload()
  return true
}
