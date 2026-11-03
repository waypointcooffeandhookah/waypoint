-- ================================================================
-- WAYPOINT RESTAURANT OS — Süreli sipariş alım penceresi (kontrollü staging testi)
--
-- Eklemelidir: tablo/satır silmez, DROP içermez. fulfillment_settings'e bir kolon eklenir.
-- Herkese açık staging sitesinde müşteri siparişi yalnızca kısa, süreli bir pencerede açılır:
--   * open_ordering_window(dakika): yalnızca yönetici; 1–120 dakika. Süre dolunca sunucu kendiliğinden
--     "ordering_closed" döner; açık kalması unutulamaz.
--   * close_ordering_now(): yalnızca yönetici; alımı hemen kapatır, pencereyi siler.
--   * Ayarlar ekranından (update_ordering_settings) alım açılıp kapatılırsa pencere silinir:
--     yöneticinin bilinçli kararı süresiz geçerlidir (eski davranış korunur).
-- Gönderim RPC'leri değişmez; hepsi pos_private.ordering_block() denetimini kullanır.
-- ================================================================

begin;

alter table public.fulfillment_settings add column if not exists accepting_orders_until timestamptz;

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

-- Alım durumu pencere dışında değişirse (ayarlar ekranı) pencere silinir.
create or replace function pos_private.clear_ordering_window() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.accepting_orders is distinct from old.accepting_orders
     and new.accepting_orders_until is not distinct from old.accepting_orders_until then
    new.accepting_orders_until := null;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'fulfillment_settings_clear_window') then
    create trigger fulfillment_settings_clear_window before update on public.fulfillment_settings
      for each row execute function pos_private.clear_ordering_window();
  end if;
end $$;

create or replace function public.open_ordering_window(p_minutes integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['admin']);
  v_until timestamptz;
begin
  if p_minutes is null or p_minutes < 1 or p_minutes > 120 then perform pos_private.fail('invalid_window'); end if;
  v_until := now() + make_interval(mins => p_minutes);
  update public.fulfillment_settings set accepting_orders = true, accepting_orders_until = v_until, updated_at = now() where id = 1;
  insert into public.audit_log(actor, action, entity, entity_id, details)
    values (v_actor, 'settings.ordering_window', 'fulfillment_settings', '1', jsonb_build_object('minutes', p_minutes, 'until', v_until));
  return jsonb_build_object('accepting_orders', true, 'until', v_until);
end;
$$;

create or replace function public.close_ordering_now() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := pos_private.require_role(array['admin']);
begin
  update public.fulfillment_settings set accepting_orders = false, accepting_orders_until = null, updated_at = now() where id = 1;
  insert into public.audit_log(actor, action, entity, entity_id, details)
    values (v_actor, 'settings.ordering_close', 'fulfillment_settings', '1', '{}'::jsonb);
  return jsonb_build_object('accepting_orders', false);
end;
$$;

revoke all on function pos_private.clear_ordering_window() from public, anon, authenticated;
revoke execute on function public.open_ordering_window(integer), public.close_ordering_now() from public, anon, authenticated;
grant execute on function public.open_ordering_window(integer), public.close_ordering_now() to authenticated;

commit;
