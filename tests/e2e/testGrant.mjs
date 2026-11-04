// Kontrollü staging testi: E2E_TEST_GRANT ortam değişkeni varsa (yalnızca scripts/staging-controlled-test.mjs verir),
// test tarayıcısında sayfa betiklerinden ÖNCE fetch sarmalanır ve x-waypoint-test-grant başlığı YALNIZCA Supabase
// REST isteklerine eklenir (Netlify'a, görsellere ya da başka alan adına gitmez). Sır diske, pakete ya da loga yazılmaz;
// yalnızca bu başsız tarayıcının belleğinde yaşar ve test bitince sunucuda geçersiz kılınır.
const HEADER = 'x-waypoint-test-grant'

export function testGrantScript(secret) {
  return `(() => {
  const secret = ${JSON.stringify(secret)};
  const original = window.fetch.bind(window);
  const target = /^https:\\/\\/[a-z0-9]+\\.supabase\\.co\\/rest\\/v1\\//;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? '';
    if (!target.test(url)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(${JSON.stringify(HEADER)}, secret);
    return original(input, { ...(init ?? {}), headers });
  };
})();`
}

export async function installTestGrant(cdp, env = process.env) {
  const secret = env.E2E_TEST_GRANT
  if (!secret) return false
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: testGrantScript(secret) })
  return true
}
