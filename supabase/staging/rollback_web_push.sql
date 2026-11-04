-- ================================================================
-- YALNIZCA STAGING — Web Push kurulumunu geri alma (20261103090000_pos_web_push.sql + 05_web_push_dispatch.sql)
--
-- Push migration'ı eklemelidir: mevcut tablolara satır/kolon eklemez; tek dokunuşu order_status_history üzerindeki
-- AFTER INSERT tetikleyicisidir. Bu betik yalnızca o kurulumun oluşturduğu nesneleri kaldırır; sipariş verisine dokunmaz.
-- push_subscriptions/push_outbox içindeki abonelikler silinir (cihazlar yeniden "Bildirimleri aç" ile kaydolur).
-- Supabase SQL Editor'da çalıştırın. Edge Function ayrıca: npx supabase functions delete push-dispatch --project-ref jnnjijmdzcjglclcnwtm
-- ================================================================
begin;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'waypoint-push-dispatch-sweep';
  end if;
end $$;

delete from vault.secrets where name in ('push_dispatch_url', 'push_dispatch_secret');

drop trigger if exists order_status_history_ready_push on public.order_status_history;
drop function if exists pos_private.enqueue_ready_push();
drop function if exists public.push_report_result(bigint, text, integer, text);
drop function if exists public.push_claim_batch(integer);
drop function if exists pos_private.push_kick_if_due();
drop function if exists pos_private.push_kick();
drop function if exists public.unregister_push_subscription(text);
drop function if exists public.register_push_subscription(text, text, text, text);
drop function if exists pos_private.push_user_eligible(uuid);
drop function if exists pos_private.push_endpoint_allowed(text);
drop table if exists public.push_outbox;
drop table if exists public.push_subscriptions;

commit;

-- İsteğe bağlı (başka kullanan yoksa): drop extension pg_cron; drop extension pg_net;
