# Netlify staging — dağıtım ve güvenlik kontrol listesi

Site: https://waypointcoffeandhookah.netlify.app/ · Supabase **staging** `jnnjijmdzcjglclcnwtm`.
GitHub Pages üretim menüsü (`main`) ve üretim Supabase projesi bu süreçte değişmez.

## 1. Netlify site ayarları

Ayarlar depodaki `netlify.toml` dosyasından gelir (arayüzdeki değerleri geçersiz kılar):

| Ayar | Değer |
|---|---|
| Production branch | `feature/restaurant-pos` (Site configuration → Build & deploy → Branches) |
| Branch deploys | Yalnızca production branch |
| Deploy previews | **Kapalı**: `netlify.toml` → `ignore = "node scripts/netlify-ignore.mjs"` PR önizlemelerini ve başka dalları derleme başlamadan atlar (yayın/adres oluşmaz). Arayüzde de "Don't deploy pull requests" seçilebilir; derleme betiği ayrıca `CONTEXT=deploy-preview` derlemeyi reddeder. |
| Build command | `npm run build:netlify` |
| Publish directory | `dist-staging` |
| Node | `NODE_VERSION=22` (`netlify.toml`) |

Derleme betiği (`scripts/cloudflare-build.mjs`, Netlify'da `NETLIFY=true`, `BRANCH`, `CONTEXT` okur) şunlarda **durur**:
başka dal, PR önizlemesi, üretim Supabase adresi/anahtarı, `service_role`/`sb_secret_` anahtarı, sunucu sırrı adı.

## 2. Ortam değişkenleri (Netlify → Site configuration → Environment variables)

| Ad | Değer |
|---|---|
| `VITE_SUPABASE_URL` | `https://jnnjijmdzcjglclcnwtm.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | staging **publishable** (`sb_publishable_…`) |
| `VITE_WEB_PUSH_PUBLIC_KEY` | `npm run push:keys` çıktısındaki GENEL anahtar |

Netlify'a **asla** eklenmez: `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_DISPATCH_SECRET`,
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (eklenirse derleme durur).

## 3. Yönlendirme, başlıklar, PWA

- `dist-staging/_redirects`: `/waypoint/*` → kök (301), ardından `/* /index.html 200` (SPA). Gerçek dosyalar
  (`sw.js`, `manifest.webmanifest`, `/assets/*`) yeniden yazılmaz.
- `dist-staging/_headers`: CSP (`connect-src` yalnızca staging Supabase), `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer` (QR anahtarı sızmaz), `X-Robots-Tag: noindex`; `sw.js` ve manifest `no-cache`.
- Yerel doğrulama: `npm run build:netlify && npm run test:netlify:smoke` (Netlify taklidi; canlı ortamın yerine geçmez).

## 4. Herkese açık site: istenmeyen staging siparişine karşı koruma

Netlify Free parola koruması sunmaz; site adresini bilen herkes menüyü açabilir. Bu yüzden:

- `accepting_orders=false` varsayılan durumdur: masa QR, paket ve kurye gönderimi **sunucuda** reddedilir
  (arayüz sepeti gösterir, gönder düğmesi kapalıdır).
- Garson/mutfak/yönetim ekranları personel girişi ister; personel siparişi alım kapalıyken de çalışır.
- Masa QR siparişi 64 haneli gizli masa kodu ister (tahmin edilemez); `Referrer-Policy: no-referrer`.
- Kontrollü test alımı herkese AÇMAZ: sunucuda doğrulanan geçici **test yetkisi** kullanılır
  (`supabase/staging/06_test_order_grants.sql`, bkz. `docs/STAGING_TEST_PLAN.md`). Sır yalnızca test bilgisayarının
  belleğindedir; sunucuda yalnızca SHA-256 özeti durur; en fazla 60 dk; test sonunda kaldırılır.
- Aynı veritabanını kullanan her ön yüz (Netlify, eski Cloudflare Pages yayınları, doğrudan API/curl) aynı
  publishable anahtarı taşır; koruma kaynağa (origin) değil **sunucu kurallarına** dayanır. Bu yüzden herkese açan
  `open_ordering_window` yerine test yetkisi kullanılır; eski Cloudflare projesi/yayınları kullanılmıyorsa silinmelidir.
- Hız sınırları: masa başına 5 dakikada 12 QR siparişi; telefon başına 10 dakikada 5, toplam 5 dakikada 60 paket/kurye siparişi.
