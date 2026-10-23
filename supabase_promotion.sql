-- Supabase SQL Editor'de bir kez çalıştırın.
create table if not exists public.menu_promotion (
  id integer primary key check (id = 1),
  product_id uuid references public.menu_items(id) on delete set null,
  enabled boolean not null default false
);
alter table public.menu_promotion enable row level security;
grant select on public.menu_promotion to anon, authenticated;
grant insert, update on public.menu_promotion to authenticated;
create policy "Public read promotion" on public.menu_promotion for select using (true);
create policy "Admin insert promotion" on public.menu_promotion for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admin update promotion" on public.menu_promotion for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
