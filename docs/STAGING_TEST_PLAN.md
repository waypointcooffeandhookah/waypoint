# Staging test planı (Netlify + Supabase staging)

Hedef: herkese açık Netlify sitesinde istenmeyen sipariş olmadan masa QR, paket ve kurye akışlarını gerçek
staging veritabanıyla uçtan uca doğrulamak. Üretim Supabase'i ve `main` dalı hiçbir adımda kullanılmaz.

## 0. Değişmez kurallar

- Varsayılan durum: `accepting_orders=false`. Gönderim **sunucuda** reddedilir; arayüz sepeti gösterir, uyarı verir.
- Uçtan uca test müşteri siparişini **herkese açmadan** yapılır: sunucuda doğrulanan geçici test yetkisi
  (`x-waypoint-test-grant` başlığı). Ön koşul: `supabase/staging/06_test_order_grants.sql` staging'e uygulanmış olmalı.
- `open_ordering_window` (süreli pencere) alımı herkese açar (Netlify, eski Cloudflare yayınları, doğrudan API);
  kontrollü test için kullanılmaz.
- Acil durum: SQL Editor → `select public.revoke_ordering_test_grants();` (yönetici oturumu gerekir) veya
  `update pos_private.ordering_test_grants set revoked_at = now() where revoked_at is null;`
  Alımı kapatma: `update public.fulfillment_settings set accepting_orders = false, accepting_orders_until = null where id = 1;`

## 1. Alım kapalıyken (her zaman çalıştırılabilir)

| Test | Komut | Ne doğrular |
|---|---|---|
| Birim + veritabanı | `npm test` | RPC kuralları, yetkiler, hız sınırları, tekrar gönderim, test yetkisi, yedek geri yükleme, push kuyruğu |
| Netlify paketi | `npm run build:netlify && npm run test:netlify:smoke` | SPA yenileme, başlıklar, CSP, SW, manifest |
| Durum | `npm run test:staging:controlled` | Yalnızca durumu yazar; hiçbir şeyi değiştirmez |

## 2. Kontrollü sipariş testi (test yetkisiyle, açık onayla)

```bash
E2E_BASE=https://waypointcoffeandhookah.netlify.app npm run test:staging:controlled -- --onay --dakika 20 --e2e multichannel,staging
```

| Adım | Ne olur |
|---|---|
| Sır | Bu bilgisayarda 256 bit rastgele üretilir; yalnızca bellekte; ekrana, diske, GitHub'a, pakete yazılmaz |
| Yetki | Yönetici oturumuyla sunucuya yalnızca SHA-256 özeti kaydedilir; en fazla 60 dk; denetim kaydı |
| API testi | Yetkisiz isteğin reddi → masa QR + paket + kurye siparişi → tekrar gönderim → bölge dışı adres reddi |
| Tarayıcı testi | Gerçek Netlify arayüzü; başlık test tarayıcısında yalnızca `*.supabase.co/rest/v1/` isteklerine eklenir |
| Bitiş (her durumda) | `revoke_ordering_test_grants`; ardından hem yetkisiz hem eski sırla gönderimin reddedildiği doğrulanır |

Normal ziyaretçiler test boyunca "Sipariş sistemi geçici olarak kapalı" görür. Siparişler kurgusal veriyle ve
"KONTROLLU STAGING TESTI" notuyla yazılır; silinmez. Yetki yalnızca kapalı/saat engelini aşar: kanal kapalılığı,
stok, asgari tutar, teslimat bölgesi, hız sınırları ve tekrar gönderim koruması aynen uygulanır.

`test:e2e:admin` dahil edilmez: ayarları kendisi geçici değiştirip geri yükler.

## 3. Elle kontrol (yalnızca personel ekranları; müşteri tarafı test yetkisiyle otomatik)

Müşteri siparişini telefondaki normal tarayıcı veremez (başlık yok; doğru davranış). Siparişleri betik verir;
personel adımları telefonda/tablette elle izlenir:

- [ ] Betiğin verdiği masa QR siparişi mutfak ekranında görünür → "hazır" → garson ekranında (ve push kuruluysa kilit ekranında) → servis → adisyon.
- [ ] Paket/gel-al → siparişler ekranında (`/siparisler`) → hazır → teslim → ödeme kaydı.
- [ ] Kurye → bölge dışı posta kodu reddedilir; bölge içi → asgari tutar → kurye ata → teslim.
- [ ] Gönder düğmesine iki kez hızlı basma → tek sipariş.
- [ ] Test bitince normal tarayıcıdan gönderim "Sipariş sistemi geçici olarak kapalı" uyarısı verir.

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
