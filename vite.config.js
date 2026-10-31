import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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
  ],
  base: '/waypoint/',
  server: {
    // --host ile açılan geliştirme sunucusu proje kökünü yerel ağa sunar. İlk dört kalıp Vite'ın
    // varsayılanıdır; sonuncusu personel şifrelerini ve masa kodlarını ağdan okunmaktan korur.
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.staging-*'] },
  },
})
