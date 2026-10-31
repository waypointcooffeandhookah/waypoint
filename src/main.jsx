import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { CONFIG_ERROR, IS_STAGING } from './config'
import './index.css'

// Hem yerel ortamda (localhost) hem de GitHub Pages (/waypoint) ortamında kusursuz çalışması için dinamik basename
const basename = window.location.pathname.startsWith('/waypoint') ? '/waypoint' : ''

// Staging ayarı hatalıysa uygulama hiç açılmaz: ne sipariş yazılır ne de başka projeye bağlanılır.
const root = ReactDOM.createRoot(document.getElementById('root'))
if (CONFIG_ERROR) root.render(
  <div className="loading-screen" role="alert">Staging yapılandırması geçersiz: {CONFIG_ERROR}. Sipariş sistemi kapalı tutuldu; .env.staging.local dosyasını kontrol edin.</div>
)
else root.render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
      {IS_STAGING && <div className="staging-badge" role="note">STAGING · Test verisi</div>}
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: 'rgba(30,30,30,0.95)',
            color: '#fff',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            fontFamily: 'Inter, sans-serif',
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
)
