# Yönetici erişimi

Tarayıcıda kullanılan Supabase anon anahtarı herkese açıktır; güvenlik RLS ile sağlanır. Service-role anahtarı tarayıcı koduna konulmamalıdır.

1. Supabase Authentication > Users bölümünden gerçek yöneticinin UUID değerini alın.
2. `supabase_security.sql` başındaki örnek UPDATE komutuna bu UUID değerini yazıp SQL Editor'de çalıştırın. Bu adım yalnızca güvenilen sunucu/SQL Editor üzerinden yapılır.
3. Ardından dosyanın kalan SQL bölümünü çalıştırın. Betik yalnızca categories ve menu_items tablolarının mevcut politikalarını değiştirir; verileri silmez. Yönetici atanmamışsa işlemi durdurur.
4. Yönetici oturumunu kapatıp tekrar açın. Panel artık `app_metadata.role = admin` gerektirir.
5. Ayrı bir test ortamında anonim ve normal kullanıcıyla okumayı, insert/update/delete işlemlerinin reddedildiğini; yöneticiyle yazmanın çalıştığını doğrulayın. SQL henüz canlı ortamda çalıştırılmadıysa mevcut veritabanı kuralları geçerlidir.

Kaynak: https://supabase.com/docs/guides/database/postgres/row-level-security

# Menü önbelleği

Yalnızca herkese açık menü verileri localStorage içinde proje bazında saklanır. En fazla yedi günlük kayıt kullanılır. Her açılışta sunucudan yenilenir; bağlantı geri geldiğinde yeniden denenir. Saklama alanı kapalıysa menü normal ağ isteğiyle çalışır. Bağlantı hatasında eski fiyat/stok bilgisi gösterildiği açıkça belirtilir. Bu özellik uygulama dosyalarını çevrimdışı kurmaz: sayfanın internet olmadan sıfırdan açılması garanti edilmez.
