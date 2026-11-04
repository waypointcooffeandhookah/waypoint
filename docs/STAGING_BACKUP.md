# Staging yedeği ve geri yükleme (ücretsiz)

Proje: `jnnjijmdzcjglclcnwtm` (yalnızca staging). Supabase Free planında indirilebilir otomatik yedek yoktur; bu
yöntem pg_dump, Docker ya da veritabanı şifresi gerektirmez.

## Yedek alma (yalnızca okur)

```bash
npm run backup:staging            # → ../waypoint-yedekler/staging-<zaman>/
```

- Yönetici hesabıyla tüm `public` tabloları JSON olarak indirir; satır sayısını sunucudaki gerçek sayıyla karşılaştırır.
- `menu-images` Storage görsellerini indirir.
- Her dosyanın SHA-256 özetini `manifest.json`'a yazar.
- Hedef klasör deponun **dışındadır**; betik depo içine yazmayı reddeder. Yedek GitHub'a gönderilmez.

## Kapsam ve sınırlar

| Bölüm | Yedekte | Geri yükleme yolu |
|---|---|---|
| `public` tablolarının verisi (17 tablo) | ✔ JSON | `restore.sql` (aşağıda) |
| Menü görselleri (`menu-images`) | ✔ dosyalar | Dashboard → Storage → yükle (aynı yol) |
| Şema (tablo, fonksiyon, RLS, tetikleyici) | depodaki SQL | Şema bölümündeki sıra |
| Personel hesapları (`auth.users`, 3 hesap) | ✖ | Aynı `user_id` ile yeniden oluşturulmalı (`staff_profiles.user_id`) |
| Vault sırları | ✖ (push öncesi boş) | `05_web_push_dispatch.sql` yeniden çalıştırılır |

**Şemanın yeniden üretilebilirliği doğrulandı (2026-11-04):**
- Staging'deki 125 şema nesnesinin parmak izi, depodaki SQL dosyalarından kurulan veritabanıyla karşılaştırıldı.
- Depodaki her nesne staging'de var.
- Dört sipariş fonksiyonu yalnızca gövde içi yorumlarda farklı; yorumlar çıkarılınca birebir aynı.
- Yalnızca staging'de olan nesneler (`menu_promotion`, `social_settings`, `save_category_order`, menü politikaları) depo kökündeki menü SQL dosyalarından gelir.

## Şema sırası (boş projeye kurulum)

1. `supabase/staging/01_menu_baseline.sql`
2. `supabase_promotion.sql`, `supabase_social.sql`, `supabase_category_order.sql`
3. `supabase/migrations/` dosyaları, ad sırasıyla (push migration'ı geri alınıyorsa ona kadar)

## Geri yükleme

**Web Push kurulumunu geri almak** için tam geri yükleme gerekmez:
- `supabase/staging/rollback_web_push.sql` dosyasını çalıştırın. Yalnızca push nesnelerini kaldırır; sipariş verisine dokunmaz.

**Veriyi yedek anına döndürmek** için:

```bash
npm run backup:staging:restore-sql -- ../waypoint-yedekler/staging-<zaman>
```

1. Bu komut `restore.sql` dosyasını üretir. Önce özetler doğrulanır; bozuk ya da eksik yedekten SQL üretilmez.
2. Dosyayı SQL Editor'da çalıştırın.
3. Tek işlemde 17 tabloyu boşaltıp yedekteki satırlarla doldurur. Tetikleyiciler kapalıdır, sayaçlar güncellenir. Bu tablolara başvuran tablolar da boşalır (`cascade`; örneğin Web Push kuyruğu `push_outbox`).
4. Son satır tablo sayılarını gösterir.

**Uyarı:** yedekten sonra oluşan siparişler silinir.
