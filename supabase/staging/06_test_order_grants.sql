-- ================================================================
-- YALNIZCA STAGING — Sunucuda doğrulanan geçici TEST YETKİSİ (müşteri siparişi herkese açılmadan uçtan uca test)
--
-- Sorun: open_ordering_window müşteri siparişini HERKESE açar (Netlify, eski Cloudflare yayınları, doğrudan API).
-- Çözüm: accepting_orders=false KALIR. Yalnızca şu başlığı gönderen istek kapalı sipariş engelini aşar:
--     x-waypoint-test-grant: <rastgele 256 bit sır>
--   * Sır test bilgisayarında üretilir, yalnızca bellekte tutulur; veritabanına yalnızca SHA-256 özeti yazılır.
--     Frontend koduna, GitHub'a ya da tarayıcı paketine girmez.
--   * Yalnızca yönetici oluşturur (create_ordering_test_grant), en fazla 60 dakika, aynı anda en fazla 3 yetki.
--   * Süre dolunca kendiliğinden geçersiz; revoke_ordering_test_grants() hepsini hemen kaldırır.
--   * Yalnızca "alım kapalı / çalışma saati dışı" engelini aşar. Kanal kapalılığı, ürün/stok, asgari tutar,
--     teslimat bölgesi, hız sınırları ve tekrar gönderim koruması AYNEN uygulanır.
--   * Her oluşturma/kaldırma audit_log'a yazılır.
-- Eklemelidir: DROP/DELETE içermez. Geri alma: ordering_block'u 20261102150000_pos_ordering_window.sql'deki
-- tanımla yeniden oluşturmak yeterlidir (yetki tablosu etkisiz kalır).
-- ================================================================

begin;

create table if not exists pos_private.ordering_test_grants (
  id          bigint generated always as identity primary key,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  note        text,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);
revoke all on pos_private.ordering_test_grants from public, anon, authenticated;

-- İstekteki başlık geçerli, süresi dolmamış ve kaldırılmamış bir yetkiyle eşleşiyor mu?
create or replace function pos_private.active_test_grant() returns bigint
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_id    bigint;
begin
  begin
    v_token := nullif(current_setting('request.headers', true), '')::json ->> 'x-waypoint-test-grant';
  exception when others then
    return null;
  end;
  if v_token is null or length(v_token) < 40 or length(v_token) > 200 then return null; end if;
  select id into v_id from pos_private.ordering_test_grants
   where token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex')
     and revoked_at is null and expires_at > now();
  return v_id;
end;
$$;

-- 20261102150000_pos_ordering_window.sql tanımı + test yetkisi denetimi (başta).
create or replace function pos_private.ordering_block() returns text
language plpgsql stable set search_path = public, pg_temp
as $$
declare
  v_settings public.fulfillment_settings;
  v_local    timestamp;
  v_time     time;
  v_today    jsonb;
  v_previous jsonb;
begin
  if pos_private.active_test_grant() is not null then return null; end if;
  select * into v_settings from public.fulfillment_settings where id = 1;
  if not v_settings.accepting_orders then return 'ordering_closed'; end if;
  if v_settings.accepting_orders_until is not null and now() >= v_settings.accepting_orders_until then return 'ordering_closed'; end if;
  if not v_settings.hours_enabled then return null; end if;
  v_local := now() at time zone v_settings.timezone;
  v_time := v_local::time;
  v_today := v_settings.operating_hours -> extract(dow from v_local)::int::text;
  v_previous := v_settings.operating_hours -> extract(dow from v_local - interval '1 day')::int::text;
  if v_today is not null then
    if (v_today ->> 'open')::time < (v_today ->> 'close')::time then
      if v_time >= (v_today ->> 'open')::time and v_time < (v_today ->> 'close')::time then return null; end if;
    elsif v_time >= (v_today ->> 'open')::time then
      return null;
    end if;
  end if;
  if v_previous is not null and (v_previous ->> 'close')::time < (v_previous ->> 'open')::time and v_time < (v_previous ->> 'close')::time then
    return null;
  end if;
  return 'outside_hours';
end;
$$;

create or replace function public.create_ordering_test_grant(p_token_hash text, p_minutes integer, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['admin']);
  v_row   pos_private.ordering_test_grants;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then perform pos_private.fail('invalid_grant'); end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then perform pos_private.fail('invalid_window'); end if;
  if (select count(*) from pos_private.ordering_test_grants where revoked_at is null and expires_at > now()) >= 3 then
    perform pos_private.fail('too_many_grants');
  end if;
  insert into pos_private.ordering_test_grants(token_hash, note, created_by, expires_at)
    values (p_token_hash, left(p_note, 200), v_actor, now() + make_interval(mins => p_minutes)) returning * into v_row;
  insert into public.audit_log(actor, action, entity, entity_id, details)
    values (v_actor, 'settings.test_grant_create', 'ordering_test_grants', v_row.id::text,
            jsonb_build_object('minutes', p_minutes, 'expires_at', v_row.expires_at, 'note', v_row.note));
  return jsonb_build_object('id', v_row.id, 'expires_at', v_row.expires_at);
end;
$$;

create or replace function public.revoke_ordering_test_grants() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['admin']);
  v_count integer;
begin
  update pos_private.ordering_test_grants set revoked_at = now() where revoked_at is null and expires_at > now();
  get diagnostics v_count = row_count;
  insert into public.audit_log(actor, action, entity, entity_id, details)
    values (v_actor, 'settings.test_grant_revoke', 'ordering_test_grants', 'all', jsonb_build_object('revoked', v_count));
  return jsonb_build_object('revoked', v_count,
    'active', (select count(*) from pos_private.ordering_test_grants where revoked_at is null and expires_at > now()));
end;
$$;

revoke all on function pos_private.active_test_grant() from public, anon, authenticated;
revoke execute on function public.create_ordering_test_grant(text, integer, text), public.revoke_ordering_test_grants() from public, anon, authenticated;
grant execute on function public.create_ordering_test_grant(text, integer, text), public.revoke_ordering_test_grants() to authenticated;

commit;
