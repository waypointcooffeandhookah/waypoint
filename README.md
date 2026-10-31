# Waypoint Restaurant OS: yerel demo

POS tabloları Supabase'de yokken müşteri (`/waypoint/masa/demo-5`), garson (`/waypoint/garson`) ve mutfak (`/waypoint/mutfak`) ekranları **demo modunda** açılır. Normal menü (`/waypoint/`) sipariş arayüzü göstermez.

Gerçek masa QR kodu `/waypoint/masa/<64 haneli gizli kod>` biçimindedir; kod `table_qr_tokens` tablosundan gelir.

- Demo verisi yalnızca o tarayıcının `localStorage` alanında tutulur. Siparişler gerçek mutfağa gitmez, Supabase'e yazılmaz.
- Eşitleme yalnızca **aynı tarayıcının sekmeleri** arasında çalışır. Başka bir cihaz, başka bir tarayıcı veya gizli pencere bu verileri görmez; bu, gerçek çok cihazlı eşitlemenin karşılığı değildir.
- Gerçek akış, migration test edilip onaylandıktan sonra açılır: kalıcı veritabanı kayıtları esastır, Realtime yalnızca yeniden okuma sinyali verir, yeniden bağlanınca kaçırılanlar okunur.

Testler: `npm test` (birim ve PGlite), `npm run dev` açıkken `npm run test:e2e` (Chrome veya Edge ile iki sekmeli uçtan uca akış).

## Staging (gerçek veritabanı, üretimden ayrı)

Staging modu yalnızca `waypoint-pos-staging` projesine bağlanır. Ayar eksik veya hatalıysa uygulama açılmaz, üretime düşmez ve demo moduna geçmez.

1. `.env.staging.example` dosyasını `.env.staging.local` olarak kopyalayıp anon anahtarı girin.
2. Personel hesapları: kendi terminalinizde `npm run staging:staff` (`sb_secret_` anahtarı gizli olarak sorulur ve kaydedilmez; şifreler git dışı `.staging-credentials.local` dosyasına yazılır, var olan hesaplar değiştirilmez).
3. Başlatma: `npm run dev:staging` → `http://<bilgisayar-ip>:5173/waypoint/`
4. Testler: `npm run test:staging` (API) ve `E2E_BASE=http://<bilgisayar-ip>:5173/waypoint npm run test:e2e:staging` (tarayıcı). QR kodları git dışı `.staging-qr.local` dosyasındadır.

`supabase/staging/` yalnızca staging içindir, üretimde çalıştırılmaz. Test siparişlerini silmeden kapatmak için `03_close_test_orders.sql` kullanılır.

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
