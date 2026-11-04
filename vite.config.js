import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Garson cihazları için Ana Ekran uygulaması (iOS Web Push şartı) ve service worker.
// YALNIZCA staging modunda eklenir: GitHub Pages üretim menüsünün çıktısı değişmez.
// Taban yol Vite'ın çözdüğü değerdir: GitHub Pages /waypoint/, Netlify staging / (--base=/).
function stagingPwa() {
  let base = '/'
  const manifest = () => JSON.stringify({
    id: `${base}garson`,
    name: 'Waypoint Garson (Staging)',
    short_name: 'WP Garson',
    description: 'Waypoint garson paneli — staging test ortamı',
    start_url: `${base}garson`,
    scope: base,
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    lang: 'tr',
    icons: [
      { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }, null, 2)
  const sw = () => readFileSync(new URL('./src/pwa/sw.js', import.meta.url), 'utf8')
  return {
    name: 'staging-pwa',
    configResolved(config) { base = config.base },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0]
        if (path === `${base}sw.js`) { res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Cache-Control', 'no-cache'); res.end(sw()); return }
        if (path === `${base}manifest.webmanifest`) { res.setHeader('Content-Type', 'application/manifest+json'); res.end(manifest()); return }
        next()
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw() })
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest() })
    },
    transformIndexHtml() {
      return [
        // Erişim koruması (çerezli oturum) önünde de manifest yüklenebilsin diye istek çerezle gider.
        { tag: 'link', attrs: { rel: 'manifest', href: `${base}manifest.webmanifest`, crossorigin: 'use-credentials' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}apple-touch-icon.png` }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'WP Garson' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head' },
      ]
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'root-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/' || req.url === '') {
            res.writeHead(302, { Location: '/waypoint/' })
            res.end()
            return
          }
          next()
        })
      },
    },
    ...(mode === 'staging' ? [stagingPwa()] : []),
  ],
  base: '/waypoint/',
  server: {
    // --host ile açılan geliştirme sunucusu proje kökünü yerel ağa sunar. İlk dört kalıp Vite'ın
    // varsayılanıdır; sonuncusu personel şifrelerini ve masa kodlarını ağdan okunmaktan korur.
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.staging-*'] },
  },
}))
