# Cloudflare Pages staging — dağıtım kontrol listesi

Yalnızca **staging** içindir (Supabase `jnnjijmdzcjglclcnwtm`). GitHub Pages üretim menüsü (`main`,
`.github/workflows/deploy.yml`) ve üretim Supabase projesi bu süreçte değişmez.

## 1. Cloudflare Pages proje ayarları

| Ayar | Değer |
|---|---|
| Git deposu / dal | `waypointcooffeandhookah/waypoint`, production branch: `feature/restaurant-pos` |
| Preview deployments | **None** (Settings → Builds → Branch control). Betik de başka dalı reddeder (`CF_PAGES_BRANCH`). |
| Framework preset | None |
| Build command | `npm run build:cloudflare` |
| Build output directory | `dist-staging` |
| Root directory | (boş) |

## 2. Ortam değişkenleri

**Cloudflare Pages** (Production ortamı; hepsi tarayıcıya giden, herkese açık değerler):

| Ad | Değer |
|---|---|
| `VITE_SUPABASE_URL` | `https://jnnjijmdzcjglclcnwtm.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | staging **publishable** (`sb_publishable_…`) veya staging anon anahtarı |
| `VITE_WEB_PUSH_PUBLIC_KEY` | `npm run push:keys` çıktısındaki GENEL anahtar |
| `NODE_VERSION` | `22` |

**Pages'e ASLA eklenmez** (eklenirse derleme durur): `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`,
`PUSH_DISPATCH_SECRET`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, adında SERVICE/SECRET/PRIVATE/PASSWORD/TOKEN geçen her `VITE_*`.

**Supabase Edge Function secrets** (`supabase secrets set`): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:…`), `PUSH_DISPATCH_SECRET`.

**Supabase Vault** (`supabase/staging/05_web_push_dispatch.sql`): `push_dispatch_url`, `push_dispatch_secret`.

## 3. Cloudflare Access (yetkisiz gerçek siparişlere karşı ZORUNLU)

- [ ] Zero Trust → Access → Applications → **Self-hosted** uygulama oluşturun ve **iki hostname'i birlikte** ekleyin:
  - [ ] ana adres: `<proje>.pages.dev`
  - [ ] preview adresleri: `*.<proje>.pages.dev`
- [ ] Not: Pages proje ayarlarındaki "Enable access policy" düğmesi **yalnızca preview adreslerini** korur; ana
      `pages.dev` adresi ayrıca yukarıdaki uygulamayla korunmalıdır. İkisi de korunmadan bağlantı kimseyle paylaşılmaz.
- [ ] Politika: Allow → yalnızca listelenen personel/testçi e-postaları (One-time PIN). "Everyone" kuralı yok.
- [ ] Oturum süresi uzun (ör. 1 ay): iPhone Ana Ekran uygulaması sık sık yeniden giriş istemesin.
- [ ] Doğrulama: gizli pencerede ana adres **ve** bir preview/deployment adresi (`<hash>.<proje>.pages.dev`) Access giriş sayfasına yönlenmeli.
- [ ] Access kurulana kadar staging'de `accepting_orders` kapalı tutulabilir (Yönetim → Ayarlar).

## 4. Supabase Web Push kurulumu (staging)

- [ ] `npm run push:keys` → sırlar yalnızca git dışı `.staging-push-secrets.local` dosyasına yazılır.
- [ ] Migration `supabase/migrations/20261103090000_pos_web_push.sql` staging'e uygulanır (onayla).
- [ ] `npx supabase functions deploy push-dispatch --no-verify-jwt --project-ref jnnjijmdzcjglclcnwtm`
- [ ] `npx supabase secrets set --env-file .staging-push-secrets.local --project-ref jnnjijmdzcjglclcnwtm` + `VAPID_SUBJECT`
- [ ] `supabase/staging/05_web_push_dispatch.sql` SQL Editor'de, gizli değer elle yazılarak çalıştırılır.

## 5. Dağıtım sonrası doğrulama

- [ ] `npm run test:cloudflare:smoke` yerelde geçti (Cloudflare taklidi; canlı ortamın yerine geçmez).
- [ ] Canlı adreste: kök menü, `/garson`, `/mutfak`, `/masa/<token>` açılıyor; `/waypoint/...` köke yönleniyor.
- [ ] Yanıt başlıklarında CSP, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` var.
- [ ] Tarayıcı ağ sekmesinde yalnızca staging Supabase adresi var; üretim adresi yok.

## 6. Fiziksel cihaz testleri (otomatik testlerin yerine geçmez)

- [ ] iPhone (iOS 16.4+): Ana Ekrana Ekle → giriş → bildirimleri aç → ekran kilitli + uygulama kapalı → mutfak "hazır" → bildirim gelir, dokununca masa açılır.
- [ ] Android Chrome: Chrome kapalıyken ve pil tasarrufu açıkken aynı akış.
- [ ] İzin reddedilince yönlendirme metni doğru; ayarlardan açınca çalışıyor.
- [ ] Çıkış yapınca o cihaza bildirim gelmiyor.
- [ ] İki garson: ikisi de alıyor. Uygulama öndeyken tek bildirim (kopya yok).
