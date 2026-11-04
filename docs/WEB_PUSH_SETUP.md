# Web Push kurulumu (yalnızca staging: `jnnjijmdzcjglclcnwtm`)

Mutfak bir masa siparişini "hazır" yapınca garsonun telefonuna, uygulama kapalı ve ekran kilitliyken bildirim gelir.
Gönderimi Supabase yapar (veritabanı tetikleyicisi → `push_outbox` → `push-dispatch` Edge Function → tarayıcı push
servisi); Netlify'ın bu kurulumda rolü yoktur. Hepsi Supabase Free + Netlify Free içinde kalır.

## Parçalar

| Parça | Nerede | Durum nasıl görülür |
|---|---|---|
| `push_subscriptions`, `push_outbox`, tetikleyici, RPC'ler | `supabase/migrations/20261103090000_pos_web_push.sql` | `select to_regclass('public.push_outbox');` |
| `push-dispatch` Edge Function | `supabase/functions/push-dispatch/` | Dashboard → Edge Functions |
| Function sırları | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET` (`SUPABASE_URL` ve servis anahtarı Supabase tarafından otomatik verilir) | Dashboard → Edge Functions → Secrets (yalnızca adlar) |
| `pg_net`, `pg_cron`, Vault sırları, dakikalık süpürme | `supabase/staging/05_web_push_dispatch.sql` | `select name from vault.secrets where name like 'push_dispatch_%';` |
| VAPID genel anahtarı (tarayıcı) | Netlify ortam değişkeni `VITE_WEB_PUSH_PUBLIC_KEY` | Canlı paket yerel `.staging-push-secrets.local` ile eşleşir |

Sırlar yalnızca git dışı `.staging-push-secrets.local` dosyasındadır (`npm run push:keys` üretir). Hiçbir belgeye,
rapora, commit'e yazılmaz; SQL'deki `<PUSH_DISPATCH_SECRET>` SQL Editor'de elle doldurulur.

## Kurulum sırası (her adım onayla)

1. **Yedek:** `npm run backup:staging` (bkz. `docs/STAGING_BACKUP.md`). Geri alma: `supabase/staging/rollback_web_push.sql`.
2. **Migration:** `20261103090000_pos_web_push.sql` staging'e uygulanır. Eklemelidir; mevcut tabloların tek değişikliği
   `order_status_history` üzerindeki hata güvenli AFTER INSERT tetikleyicisidir.
3. **Edge Function** (Supabase erişim token'ı gerekir: Dashboard → Account → Access Tokens; terminalde
   `! export SUPABASE_ACCESS_TOKEN=...`, hiçbir yere yazılmaz):
   ```bash
   npx supabase functions deploy push-dispatch --no-verify-jwt --project-ref jnnjijmdzcjglclcnwtm
   npx supabase secrets set --env-file .staging-push-secrets.local --project-ref jnnjijmdzcjglclcnwtm
   npx supabase secrets set VAPID_SUBJECT=mailto:<işletme e-postası> --project-ref jnnjijmdzcjglclcnwtm
   ```
   `--no-verify-jwt`: fonksiyonu veritabanı çağırır; kimlik `x-push-dispatch-secret` başlığıyla sabit zamanlı karşılaştırılır.
4. **Bağlantı:** `supabase/staging/05_web_push_dispatch.sql` SQL Editor'de (sır elle yazılarak) çalıştırılır:
   `pg_net`, `pg_cron`, iki Vault sırrı, dakikalık süpürme.
5. **Doğrulama:** garson hesabıyla "Bildirimleri aç" → `select count(*) from push_subscriptions;` artar → mutfakta bir
   masa siparişi "hazır" → `select status, count(*) from push_outbox group by status;` `sent` olur.

## Cihaz testleri (elle; otomatik testlerin yerine geçmez)

Siparişi kontrollü test betiği verir (`npm run test:staging:controlled -- --onay`); telefonlar yalnızca personel
olarak kullanılır. Normal müşteri tarayıcısı sipariş veremez (alım kapalı).

**iPhone (iOS 16.4 veya üstü):**
- [ ] Safari → `https://waypointcoffeandhookah.netlify.app/garson` → Paylaş → **Ana Ekrana Ekle**.
- [ ] Ana ekrandaki simgeden aç (Safari sekmesinden değil; iOS yalnızca Ana Ekran uygulamasına izin verir) → garson girişi.
- [ ] "Bildirimleri aç" → iOS izin penceresinde **İzin Ver**.
- [ ] Uygulamayı kapat (yukarı kaydır), ekranı kilitle.
- [ ] Bilgisayarda mutfak ekranından masa siparişini "Hazır" yap → kilit ekranında "Masa … hazır" bildirimi.
- [ ] Bildirime dokun → uygulama ilgili masayla açılır.
- [ ] Odak/Rahatsız Etmeyin açıkken bildirim ertelenebilir; test sırasında kapalı olsun.

**Android (Chrome):**
- [ ] Chrome → aynı adres → menü → **Uygulamayı yükle / Ana ekrana ekle** → uygulamadan garson girişi.
- [ ] "Bildirimleri aç" → **İzin ver**. (Android 13+: uygulama bildirim izni de istenir.)
- [ ] Chrome ve uygulamayı kapat, ekranı kilitle → mutfakta "Hazır" → kilit ekranında bildirim.
- [ ] Pil tasarrufu açıkken tekrar dene (gecikebilir; kaybolmamalı).

**Her iki cihaz:**
- [ ] İzin reddedilince ekrandaki yönlendirme metni doğru; ayarlardan açınca çalışıyor.
- [ ] Çıkış yapınca o cihaza bildirim gelmiyor.
- [ ] İki garson cihazı: ikisi de alıyor; uygulama öndeyken tek bildirim (kopya yok).
- [ ] Paket ve kurye siparişleri garsona bildirim göndermez (yalnızca masa siparişi).
