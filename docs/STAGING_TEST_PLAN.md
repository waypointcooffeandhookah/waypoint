# Staging test planı (Netlify + Supabase staging)

Hedef: herkese açık Netlify sitesinde istenmeyen sipariş olmadan masa QR, paket ve kurye akışlarını gerçek
staging veritabanıyla uçtan uca doğrulamak. Üretim Supabase'i ve `main` dalı hiçbir adımda kullanılmaz.

## 0. Değişmez kurallar

- Varsayılan durum: `accepting_orders=false`. Gönderim **sunucuda** reddedilir; arayüz sepeti gösterir, uyarı verir.
- Müşteri siparişi yalnızca **süreli pencere** ile açılır (`open_ordering_window`, yalnızca yönetici, 1–120 dk).
  Süre dolunca sunucu kendiliğinden kapatır. Ayarlar ekranından süresiz açmak yalnızca bilinçli yönetici kararıdır.
- Acil kapatma: Yönetim → Ayarlar → "Sipariş alımı açık" kapat **veya** SQL Editor:
  `update public.fulfillment_settings set accepting_orders = false where id = 1;`

## 1. Alım kapalıyken (her zaman çalıştırılabilir)

| Test | Komut | Ne doğrular |
|---|---|---|
| Birim + veritabanı | `npm test` | RPC kuralları, yetkiler, hız sınırları, tekrar gönderim, pencere, push kuyruğu |
| Netlify paketi | `npm run build:netlify && npm run test:netlify:smoke` | SPA yenileme, başlıklar, CSP, SW, manifest |
| Durum | `npm run test:staging:controlled` | Yalnızca durumu yazar; hiçbir şeyi değiştirmez |

## 2. Kontrollü sipariş testi (açık onayla)

```bash
# Netlify adresinde tarayıcı akışlarıyla birlikte, 15 dakikalık pencere:
E2E_BASE=https://waypointcoffeandhookah.netlify.app npm run test:staging:controlled -- --onay --dakika 15 --e2e multichannel,staging
```

Betik: staging hedefini doğrular → yönetici girişi → pencere açar → API ile masa QR + paket + kurye siparişi ve
tekrar gönderim denetimi → istenen tarayıcı testleri (mutfak, garson, adisyon/ödeme, paket/kurye ekranı) →
**her durumda** (hata, Ctrl+C) alımı kapatır ve müşteri gibi kapalı olduğunu doğrular.
Siparişler kurgusal veriyle ve "KONTROLLU STAGING TESTI" notuyla yazılır; silinmez.

`test:e2e:admin` pencereye dahil edilmez: ayarları kendisi geçici değiştirip geri yükler; pencere dışında, alım
kapalıyken çalıştırın (geri yükleme kapalı duruma döner).

## 3. Elle kontrol (pencere açıkken, aynı oturumda)

- [ ] Telefonda masa QR → ürün ekle → gönder → mutfak ekranında görünür → "hazır" → garson ekranında görünür → servis.
- [ ] Paket/gel-al → siparişler ekranında (`/siparisler`) → hazır → teslim → ödeme kaydı.
- [ ] Kurye → bölge dışı posta kodu reddedilir; bölge içi → asgari tutar → kurye ata → teslim.
- [ ] Gönder düğmesine iki kez hızlı basma → tek sipariş.
- [ ] Pencere bitince (veya betik kapatınca) yeni gönderim "Sipariş sistemi geçici olarak kapalı" uyarısı verir.

## 4. Web Push (onaydan sonra kurulum)

Ön koşul: `docs/CLOUDFLARE_STAGING.md` §4 adımları (anahtarlar, migration `20261103090000_pos_web_push.sql`,
`push-dispatch` Edge Function, secrets, `supabase/staging/05_web_push_dispatch.sql`). Netlify'ın bu kuruluma
etkisi yoktur: gönderimi Supabase yapar, tarayıcı sekmesi açık olmak zorunda değildir.

## 5. Fiziksel cihaz testleri (otomatik testlerin yerine geçmez)

- [ ] iPhone (iOS 16.4+): Safari → Netlify adresi → Paylaş → **Ana Ekrana Ekle** → uygulamadan garson girişi →
      Bildirimleri aç (izin isteği yalnızca Ana Ekran uygulamasında çıkar).
- [ ] iPhone: uygulamayı kapat + ekranı kilitle → mutfak "hazır" → kilit ekranında bildirim; dokununca masa açılır.
- [ ] Android Chrome: siteyi yükle (Yükle/Ana ekrana ekle) → giriş → bildirimleri aç → Chrome kapalı + ekran kilitli → bildirim.
- [ ] İzin reddedilince yönlendirme metni doğru; ayarlardan açınca çalışıyor.
- [ ] Çıkış yapınca o cihaza bildirim gelmiyor; iki garson ikisi de alıyor; uygulama öndeyken tek bildirim.
