-- ================================================================
-- WAYPOINT RESTAURANT OS — Garson cihazlarına arka plan Web Push
--
-- Eklemelidir: mevcut tablo/fonksiyonlara dokunmaz, DROP içermez.
-- Akış: order_status_history'ye 'ready' satırı → tetikleyici push_outbox'a abonelik başına
-- bir satır yazar (unique: aynı sipariş aynı cihaza iki kez gitmez) → pg_net push-dispatch
-- Edge Function'ını çağırır → fonksiyon service_role ile satırları talep eder ve gönderir.
-- pg_net / Vault ayarlanmamışsa kuyruk dolar ama çağrı yapılmaz (staging kurulumu ayrı adımdır:
-- supabase/staging/05_web_push_dispatch.sql). Push hatası sipariş akışını asla bozmaz.
-- ================================================================

begin;

create table if not exists public.push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  endpoint       text not null unique check (char_length(endpoint) <= 1024),
  p256dh         text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,88}$'),
  auth           text not null check (auth ~ '^[A-Za-z0-9_-]{21,24}$'),
  user_agent     text check (char_length(user_agent) <= 200),
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count  integer not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table if not exists public.push_outbox (
  id              bigint generated always as identity primary key,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  order_id        uuid not null references public.orders(id) on delete cascade,
  event_key       text not null,
  payload         jsonb not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'sending', 'sent', 'failed', 'expired', 'skipped')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at       timestamptz,
  last_status     integer,
  last_error      text check (char_length(last_error) <= 200),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unique (event_key, subscription_id)
);
create index if not exists push_outbox_due_idx on public.push_outbox(status, next_attempt_at);
create index if not exists push_outbox_created_idx on public.push_outbox(created_at);

-- Tarayıcı bu tablolara doğrudan erişemez; yalnızca aşağıdaki RPC'ler.
revoke all on public.push_subscriptions, public.push_outbox from public, anon, authenticated;
alter table public.push_subscriptions enable row level security;
alter table public.push_outbox enable row level security;

-- ── Yardımcılar ────────────────────────────────────────────────
-- Yalnızca bilinen push servisleri (SSRF koruması; Edge Function aynı listeyi tekrar uygular).
create or replace function pos_private.push_endpoint_allowed(p_endpoint text) returns boolean
language sql immutable as $$
  select coalesce(char_length(p_endpoint) <= 1024 and p_endpoint ~ (
    '^https://(fcm\.googleapis\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|' ||
    'updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/[^\s@]*$'), false)
$$;

-- Bildirim alabilecek kişi: aktif garson/müdür profili veya app_metadata yöneticisi. Gönderim anında yeniden bakılır.
create or replace function pos_private.push_user_eligible(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.staff_profiles where user_id = p_user_id and is_active and role in ('waiter', 'manager', 'admin'))
      or exists (select 1 from auth.users where id = p_user_id and raw_app_meta_data ->> 'role' = 'admin')
$$;

-- ── Garson RPC'leri ────────────────────────────────────────────
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['waiter', 'manager', 'admin']);
  v_id    uuid;
begin
  if not pos_private.push_endpoint_allowed(p_endpoint) then perform pos_private.fail('push_endpoint_invalid'); end if;
  if p_p256dh !~ '^[A-Za-z0-9_-]{86,88}$' or p_auth !~ '^[A-Za-z0-9_-]{21,24}$' then perform pos_private.fail('push_keys_invalid'); end if;
  -- Aynı cihaz başka bir personelle açılırsa abonelik son giriş yapana geçer: önceki kişi bu cihazda bildirim almaz.
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, user_agent)
    values (v_actor, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = now(), failure_count = 0
  returning id into v_id;
  -- Kişi başına en fazla 5 cihaz; en eski görülen silinir.
  delete from public.push_subscriptions
   where user_id = v_actor and id in (
     select id from public.push_subscriptions where user_id = v_actor order by last_seen_at desc offset 5);
  return jsonb_build_object('id', v_id);
end;
$$;

-- Yalnızca kendi aboneliği silinebilir (çıkışta ve "kapat" ile çağrılır).
create or replace function public.unregister_push_subscription(p_endpoint text) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_count int;
begin
  if auth.uid() is null then perform pos_private.fail('forbidden'); end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- ── Kuyruğa alma (tetikleyici) ─────────────────────────────────
create or replace function pos_private.push_kick() returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') or to_regclass('vault.decrypted_secrets') is null then return; end if;
  execute $q$select (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_url'),
                    (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret')$q$
    into v_url, v_secret;
  if v_url is null or v_secret is null then return; end if;
  -- pg_net isteği işlem tamamlanınca gönderilir; işlem geri alınırsa istek de gitmez.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 8000)'
    using v_url, '{}'::jsonb, jsonb_build_object('Content-Type', 'application/json', 'x-push-dispatch-secret', v_secret);
exception when others then
  raise warning 'push_kick: %', sqlerrm;
end;
$$;

-- pg_cron süpürmesi: yalnızca bekleyen iş varsa fonksiyon çağrılır (boş dakikalarda istek yok).
create or replace function pos_private.push_kick_if_due() returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.push_outbox
              where (status = 'pending' and next_attempt_at <= now())
                 or (status = 'sending' and locked_at < now() - interval '2 minutes')) then
    perform pos_private.push_kick();
  end if;
end;
$$;

create or replace function pos_private.enqueue_ready_push() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_order   public.orders;
  v_label   text;
  v_lines   text[];
  v_total   int;
  v_payload jsonb;
  v_count   int;
begin
  begin
    select * into v_order from public.orders where id = new.order_id;
    if not found or v_order.fulfillment_type <> 'dine_in' then return null; end if;
    select label into v_label from public.restaurant_tables where id = v_order.table_id;
    select array_agg(quantity || ' × ' || item_name order by position), count(*)
      into v_lines, v_total from public.order_items where order_id = new.order_id;
    v_lines := coalesce(v_lines[1:6], '{}');
    if v_total > 6 then v_lines := v_lines || ('+' || (v_total - 6) || ' ürün daha'); end if;
    -- Yükte müşteri bilgisi yoktur; yalnızca masa, sipariş no ve ürünler.
    v_payload := jsonb_build_object(
      'type', 'order_ready', 'v', 1,
      'title', coalesce(v_label, 'Masa') || ' — Siparişiniz Hazır!',
      'body', left(array_to_string(v_lines, E'\n'), 900),
      'tag', 'waypoint-ready-' || new.id,
      'orderId', v_order.id, 'orderNumber', v_order.order_number, 'tableId', v_order.table_id,
      'url', 'garson/masa/' || v_order.table_id,
      'at', new.changed_at);
    insert into public.push_outbox(subscription_id, order_id, event_key, payload)
      select s.id, v_order.id, 'order_ready:' || v_order.id, v_payload
        from public.push_subscriptions s
       where pos_private.push_user_eligible(s.user_id)
    on conflict (event_key, subscription_id) do nothing;
    get diagnostics v_count = row_count;
    if v_count > 0 then perform pos_private.push_kick(); end if;
  exception when others then
    raise warning 'enqueue_ready_push: %', sqlerrm; -- bildirim kuyruğu sipariş durum değişikliğini engellemez
  end;
  return null;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'order_status_history_ready_push') then
    create trigger order_status_history_ready_push after insert on public.order_status_history
      for each row when (new.to_status = 'ready') execute function pos_private.enqueue_ready_push();
  end if;
end $$;

-- ── Gönderici RPC'leri (yalnızca service_role / Edge Function) ──
create or replace function public.push_claim_batch(p_limit integer default 50)
returns table (id bigint, endpoint text, p256dh text, auth text, payload jsonb, topic text)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- Eski veya artık geçerli olmayan bildirimler gönderilmez.
  update public.push_outbox o set status = 'expired'
   where o.status in ('pending', 'sending') and o.created_at < now() - interval '15 minutes';
  update public.push_outbox o set status = 'skipped', last_error = 'not_ready_or_ineligible'
    from public.push_subscriptions s
   where o.status = 'pending' and s.id = o.subscription_id
     and (not pos_private.push_user_eligible(s.user_id)
          or not exists (select 1 from public.orders r where r.id = o.order_id and r.status = 'ready'));
  delete from public.push_outbox o where o.created_at < now() - interval '3 days';

  return query
  with due as (
    select o.id from public.push_outbox o
     where (o.status = 'pending' and o.next_attempt_at <= now())
        or (o.status = 'sending' and o.locked_at < now() - interval '2 minutes')
     order by o.id
     for update skip locked
     limit least(greatest(p_limit, 1), 200)
  ), claimed as (
    update public.push_outbox o set status = 'sending', locked_at = now(), attempts = o.attempts + 1
      from due where o.id = due.id
    returning o.id, o.subscription_id, o.payload, o.order_id
  )
  select c.id, s.endpoint, s.p256dh, s.auth, c.payload, replace(c.order_id::text, '-', '')
    from claimed c join public.push_subscriptions s on s.id = c.subscription_id;
end;
$$;

create or replace function public.push_report_result(p_id bigint, p_outcome text, p_status integer default null, p_error text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row public.push_outbox;
begin
  select * into v_row from public.push_outbox where id = p_id and status = 'sending' for update;
  if not found then return; end if;
  if p_outcome = 'sent' then
    update public.push_outbox set status = 'sent', sent_at = now(), last_status = p_status, last_error = null where id = p_id;
    update public.push_subscriptions set last_success_at = now(), failure_count = 0 where id = v_row.subscription_id;
  elsif p_outcome = 'gone' then
    -- 404/410: tarayıcı aboneliği iptal etmiş; cihaz kaydı silinir (kuyruk satırları da).
    delete from public.push_subscriptions where id = v_row.subscription_id;
  elsif p_outcome = 'retry' and v_row.attempts < 5 then
    update public.push_outbox set status = 'pending', next_attempt_at = now() + (v_row.attempts * interval '20 seconds'),
           last_status = p_status, last_error = left(p_error, 200) where id = p_id;
  else
    update public.push_outbox set status = 'failed', last_status = p_status, last_error = left(coalesce(p_error, p_outcome), 200) where id = p_id;
    update public.push_subscriptions set failure_count = failure_count + 1 where id = v_row.subscription_id;
  end if;
end;
$$;

revoke all on all functions in schema pos_private from public, anon, authenticated;
revoke execute on function public.register_push_subscription(text, text, text, text), public.unregister_push_subscription(text),
  public.push_claim_batch(integer), public.push_report_result(bigint, text, integer, text) from public, anon, authenticated;
grant execute on function public.register_push_subscription(text, text, text, text), public.unregister_push_subscription(text) to authenticated;
grant execute on function public.push_claim_batch(integer), public.push_report_result(bigint, text, integer, text) to service_role;

commit;
