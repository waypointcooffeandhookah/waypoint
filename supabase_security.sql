-- Supabase SQL Editor: first grant the intended user the admin role.
-- Replace YOUR_ADMIN_USER_UUID using Authentication > Users, then run this
-- statement separately (never grant the role to all authenticated users):
-- update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
--   || '{"role":"admin"}'::jsonb where id = 'YOUR_ADMIN_USER_UUID'::uuid;
-- The admin must sign out and sign in again after the role is assigned.

begin;
do $$
begin
  if not exists (select 1 from auth.users where raw_app_meta_data ->> 'role' = 'admin') then
    raise exception 'Assign the intended admin user first; no policies have been changed.';
  end if;
end $$;

alter table public.categories enable row level security;
alter table public.menu_items enable row level security;

-- Remove existing policies on these two menu tables so permissive legacy
-- policies cannot continue granting write access alongside the new policies.
do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('categories', 'menu_items')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

revoke all on public.categories, public.menu_items from anon, authenticated;
grant select on public.categories, public.menu_items to anon, authenticated;
grant insert, update, delete on public.categories, public.menu_items to authenticated;

create policy "Public read categories" on public.categories for select to anon, authenticated using (true);
create policy "Public read menu_items" on public.menu_items for select to anon, authenticated using (true);

create policy "Admin insert categories" on public.categories for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admin update categories" on public.categories for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admin delete categories" on public.categories for delete to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admin insert menu_items" on public.menu_items for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admin update menu_items" on public.menu_items for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admin delete menu_items" on public.menu_items for delete to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
commit;

-- Inspect the resulting policies:
select tablename, policyname, cmd, roles, qual, with_check from pg_policies
where schemaname = 'public' and tablename in ('categories', 'menu_items');
