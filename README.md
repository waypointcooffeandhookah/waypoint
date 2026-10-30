# Waypoint Restaurant OS: yerel demo

POS tabloları Supabase'de yokken garson (`/waypoint/garson`) ve mutfak (`/waypoint/mutfak`) ekranları **demo modunda** açılır.

- Demo verisi yalnızca o tarayıcının `localStorage` alanında tutulur. Siparişler gerçek mutfağa gitmez, Supabase'e yazılmaz.
- Eşitleme yalnızca **aynı tarayıcının sekmeleri** arasında çalışır. Başka bir cihaz, başka bir tarayıcı veya gizli pencere bu verileri görmez; bu, gerçek çok cihazlı eşitlemenin karşılığı değildir.
- Gerçek akış, migration test edilip onaylandıktan sonra açılır: kalıcı veritabanı kayıtları esastır, Realtime yalnızca yeniden okuma sinyali verir, yeniden bağlanınca kaçırılanlar okunur.

Testler: `npm test` (birim ve PGlite), `npm run dev` açıkken `npm run test:e2e` (Chrome veya Edge ile iki sekmeli uçtan uca akış).

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
