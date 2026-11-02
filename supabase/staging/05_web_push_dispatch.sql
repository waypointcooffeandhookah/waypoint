-- ================================================================
-- STAGING — Web Push gönderiminin bağlanması (yalnızca staging: jnnjijmdzcjglclcnwtm)
--
-- Önkoşul: 20261103090000_pos_web_push.sql uygulanmış ve push-dispatch fonksiyonu
-- `supabase functions deploy push-dispatch --no-verify-jwt --project-ref jnnjijmdzcjglclcnwtm`
-- ile dağıtılmış, secrets ayarlanmış olmalı.
--
-- <PUSH_DISPATCH_SECRET> yerine `.staging-push-secrets.local` dosyasındaki değeri SQL Editor'de
-- elle yazın. Bu dosyaya gerçek değer YAZMAYIN ve commit etmeyin.
-- Üretim projesinde çalıştırılmaz.
-- ================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Fonksiyon adresi ve gizli başlık Vault'ta şifreli tutulur; tetikleyici buradan okur.
select vault.create_secret('https://jnnjijmdzcjglclcnwtm.supabase.co/functions/v1/push-dispatch', 'push_dispatch_url',
                           'push-dispatch Edge Function adresi');
select vault.create_secret('<PUSH_DISPATCH_SECRET>', 'push_dispatch_secret', 'push-dispatch paylaşılan gizli başlık');

-- Yeniden denemeler ve kaçan çağrılar için dakikalık süpürme (iş yoksa istek atmaz).
select cron.schedule('waypoint-push-dispatch-sweep', '* * * * *', $$select pos_private.push_kick_if_due()$$);

-- Kontrol:
--   select name from vault.decrypted_secrets where name like 'push_dispatch_%';
--   select status, count(*) from public.push_outbox group by status;
--   select id, status_code, error_msg, created from net._http_response order by id desc limit 10;
-- Gizli değeri değiştirmek: select vault.update_secret((select id from vault.secrets where name = 'push_dispatch_secret'), '<YENİ>');
