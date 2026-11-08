-- ================================================================
-- WAYPOINT — Personel rolleri sadeleştirme: yalnızca Admin, Garson, Mutfak; tek Admin.
--
--  - Varsa Müdür/Kasa kayıtları Garson olur (Garson adisyon/ödeme işlemlerini yapabilir). Staging'de böyle kayıt yok.
--  - staff_profiles.role yalnızca 'admin' | 'waiter' | 'kitchen' olabilir.
--  - En fazla bir Admin personel kaydı olabilir (benzersiz kısmi dizin).
--  - upsert_staff_profile: personele yalnızca Garson/Mutfak atanabilir; mevcut Admin kendi kaydını (ad) koruyabilir
--    ama rolü değiştirilemez/kapatılamaz. Yeni Admin oluşturulamaz, başka biri Admin yapılamaz.
-- Mevcut Admin hesabı ve yetkileri değişmez. Tekrar çalıştırılabilir.
-- ================================================================

begin;

update public.staff_profiles set role = 'waiter', updated_at = now() where role in ('manager', 'cashier');

do $$
declare v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.staff_profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%'
      and conname <> 'staff_profiles_role_simple_check'
  loop
    execute format('alter table public.staff_profiles drop constraint %I', v_name);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'staff_profiles_role_simple_check') then
    alter table public.staff_profiles add constraint staff_profiles_role_simple_check check (role in ('admin', 'waiter', 'kitchen'));
  end if;
end $$;

create unique index if not exists staff_profiles_single_admin on public.staff_profiles ((true)) where role = 'admin';

create or replace function public.upsert_staff_profile(
  p_user_id uuid, p_display_name text, p_role text, p_is_active boolean default true
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor   uuid := pos_private.require_role(array['admin']);
  v_current text;
begin
  select role into v_current from public.staff_profiles where user_id = p_user_id;
  if v_current = 'admin' then
    -- Tek Admin: rolü değiştirilemez, erişimi kapatılamaz.
    if p_role is distinct from 'admin' or p_is_active is distinct from true then perform pos_private.fail('last_admin'); end if;
  elsif p_role not in ('waiter', 'kitchen') or p_role is null then
    perform pos_private.fail('role_not_allowed');
  end if;
  if nullif(trim(p_display_name), '') is null or char_length(trim(p_display_name)) > 60 then perform pos_private.fail('invalid_name'); end if;

  insert into public.staff_profiles(user_id, display_name, role, is_active)
    values (p_user_id, trim(p_display_name), p_role, p_is_active)
  on conflict (user_id) do update set display_name = excluded.display_name, role = excluded.role,
    is_active = excluded.is_active, updated_at = now();
  insert into public.audit_log(actor, action, entity, entity_id, details)
    values (v_actor, 'staff.upsert', 'staff_profiles', p_user_id::text,
            jsonb_build_object('role', p_role, 'is_active', p_is_active));
end;
$$;

revoke all on function public.upsert_staff_profile(uuid, text, text, boolean) from public, anon;
grant execute on function public.upsert_staff_profile(uuid, text, text, boolean) to authenticated;

commit;
