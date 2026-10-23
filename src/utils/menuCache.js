const MAX_AGE = 7 * 24 * 60 * 60 * 1000
export function readMenuCache(key, storage, now = Date.now()) {
  try {
    storage ??= globalThis.localStorage
    const value = JSON.parse(storage.getItem(key))
    if (value?.version !== 1 || !Number.isFinite(value.savedAt) ||
        value.savedAt > now || now - value.savedAt > MAX_AGE ||
        !Array.isArray(value.categories) || !Array.isArray(value.items) ||
        ![...value.categories, ...value.items].every(row => row && typeof row.id === 'string' && typeof row.name === 'string')) return null
    return value
  } catch { return null }
}
export function writeMenuCache(key, categories, items, storage) {
  try { storage ??= globalThis.localStorage; storage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now(), categories, items })) } catch { /* Storage may be disabled or full. */ }
}
