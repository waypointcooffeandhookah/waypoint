// DEMO deposu: aynı tarayıcıdaki sekmeler localStorage ve "storage" olayıyla eşitlenir.
// Bu YALNIZCA tek tarayıcı içindir: başka cihaza veya gerçek mutfağa hiçbir şey ulaşmaz.
const DEMO_KEY = 'waypoint-pos-demo-v1'

function memoryStorage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

export function createDemoStore({ storage = memoryStorage(), locks = null, target = null, key = DEMO_KEY } = {}) {
  const listeners = new Set()
  let queue = Promise.resolve()

  const read = () => { try { return JSON.parse(storage.getItem(key)) } catch { return null } }
  // Web Locks varsa sekmeler arası, yoksa bu sekme içinde sırayla çalışır.
  const exclusive = locks ? fn => locks.request(key, fn) : fn => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }
  const onStorage = event => { if (event.key === key || event.key === null) listeners.forEach(listener => listener()) }

  return {
    read,
    // fn(mevcutDurum) → { state, result }. Okuma, değiştirme ve yazma tek adımdır.
    update(fn) {
      return exclusive(async () => {
        const { state, result } = fn(read())
        storage.setItem(key, JSON.stringify(state))
        listeners.forEach(listener => listener())
        return result
      })
    },
    subscribe(listener) {
      if (!listeners.size) target?.addEventListener('storage', onStorage)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (!listeners.size) target?.removeEventListener('storage', onStorage)
      }
    },
  }
}

export function createBrowserDemoStore() {
  try {
    const probe = `${DEMO_KEY}-probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return createDemoStore({ storage: localStorage, locks: navigator.locks ?? null, target: window })
  } catch {
    return createDemoStore() // Depolama kapalıysa demo yalnızca bu sekmede çalışır.
  }
}
