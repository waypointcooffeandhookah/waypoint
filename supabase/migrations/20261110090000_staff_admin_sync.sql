-- ================================================================
-- WAYPOINT — Yönetici rolü eşitleme
--
-- Sorun: Yönetim paneli girişi ve menü düzenleme hesabın app_metadata.role = 'admin' iznine bakar; Personel ekranındaki
-- rol ise staff_profiles'tadır. Panelden birini Yönetici yapmak panele giriş vermiyordu; yöneticiyi düşürmek veya
-- erişimini kapatmak da app_metadata izni kaldığı için yetkiyi geri almıyordu (pos_current_role bu izni önce okuyordu).
--
-- Çözüm:
--  1) staff_profiles değişince app_metadata.role eşitlenir (aktif yönetici → 'admin', değilse kaldırılır).
--     Yeni izin kişinin oturumu yenilenince (en geç ~1 saat veya yeniden girişte) panele yansır.
--  2) pos_current_role: personel kaydı olan hesapta kayıt esastır (pasif = yetki yok), anında geçerlidir.
--     Personel kaydı olmayan eski menü yöneticileri eskisi gibi app_metadata ile çalışır.
--  3) Son aktif yönetici düşürülemez/kapatılamaz ('last_admin'): panel sahipsiz kalmaz.
-- Eklemelidir; DROP yok. Tekrar çalıştırılabilir.
-- ================================================================

begin;

create or replace function public.pos_current_role() returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from public.staff_profiles sp where sp.user_id = (select auth.uid()))
      then (select case when sp.is_active then sp.role end from public.staff_profiles sp where sp.user_id = (select auth.uid()))
    when (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' then 'admin'
  end
$$;

create or replace function pos_private.sync_staff_admin() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.role = 'admin' and old.is_active and not (new.role = 'admin' and new.is_active)
     and not exists (select 1 from public.staff_profiles where role = 'admin' and is_active and user_id <> new.user_id) then
    perform pos_private.fail('last_admin');
  end if;
  update auth.users u set raw_app_meta_data = case
      when new.role = 'admin' and new.is_active then coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
      else coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'role'
    end
  where u.id = new.user_id
    and (u.raw_app_meta_data ->> 'role') is distinct from (case when new.role = 'admin' and new.is_active then 'admin' end);
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'staff_profiles_sync_admin'
                 and tgrelid = 'public.staff_profiles'::regclass and not tgisinternal) then
    create trigger staff_profiles_sync_admin after insert or update of role, is_active on public.staff_profiles
      for each row execute function pos_private.sync_staff_admin();
  end if;
end $$;

revoke all on function pos_private.sync_staff_admin() from public, anon, authenticated;

-- Mevcut kayıtları bir kez eşitle.
update auth.users u set raw_app_meta_data = case
    when sp.role = 'admin' and sp.is_active then coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
    else coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'role'
  end
from public.staff_profiles sp
where sp.user_id = u.id
  and (u.raw_app_meta_data ->> 'role') is distinct from (case when sp.role = 'admin' and sp.is_active then 'admin' end);

commit;
