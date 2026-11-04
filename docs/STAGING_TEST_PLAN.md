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
| API testi | Yetkisiz isteğin reddi → masa QR (Masa 9) + paket + kurye siparişi → tekrar gönderim, bölge dışı adres ve tükenen ürün reddi |
| İşleme (gerçek personel hesapları) | Mutfak hazırlanıyor → hazır; garson servis; adisyon bakiyesi, fazla ödeme reddi, kart ödemesi (tekrarında çift kayıt yok), masa kapanışı; paket teslim + nakit; kurye adı zorunlu → kuryeye verildi → teslim + kapıda ödeme; müşteri takip sayfası; rol yetkileri |
| Masa temizliği | Masa 9, 5 ve 6 test öncesi/sonrası normal personel yoluyla kapatılır (servis/gerekçeli iptal, ödeme, kapanış; veri silinmez). Diğer masalara dokunulmaz |
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

## 4. Web Push ve fiziksel cihaz testleri

Kurulum adımları, sırlar ve iPhone/Android kilit ekranı testleri: `docs/WEB_PUSH_SETUP.md`.

## 5. Süreli masa bileti (`20261105090000_pos_qr_visits.sql`)

- QR okutulunca masa kodu **1 saatlik bilete** çevrilir ve adresten silinir (`/masa`). Bilet yalnızca o sekmede tutulur.
- Sayfa yenileme aynı bileti kullanır; süre uzamaz. Süre dolunca, sekme kapanınca, masanın adisyonu kapanınca,
  masa kodu yenilenince veya masa devre dışı kalınca müşteriden QR'ı **tekrar okutması** istenir (sepet korunur).
- Kontrolü sunucu yapar: `place_qr_order` çıplak masa koduyla `qr_visit_required`, bitmiş biletle `qr_visit_expired` döner.
- Bilinen sınır: QR'ın fotoğrafını çeken kişi dışarıda yeni bilet alabilir; bunu yalnızca masa kodunu yenilemek
  (Yönetim → Masalar → QR kodu → Yenile) veya garsonun masayı açmasını zorunlu kılmak kapatır.
- Geri alma: `supabase/staging/rollback_qr_visits.sql` (ön yüz de önceki sürüme alınmalı).
