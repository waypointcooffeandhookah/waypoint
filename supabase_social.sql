create table if not exists public.social_settings (
  id integer primary key check (id = 1),
  instagram_url text not null default '',
  whatsapp_number text not null default ''
);
alter table public.social_settings enable row level security;
grant select on public.social_settings to anon, authenticated;
grant insert, update on public.social_settings to authenticated;
drop policy if exists "Social public read" on public.social_settings;
create policy "Social public read" on public.social_settings for select using (true);
drop policy if exists "Social admin insert" on public.social_settings;
create policy "Social admin insert" on public.social_settings for insert to authenticated
with check ((select auth.jwt()->'app_metadata'->>'role') = 'admin');
drop policy if exists "Social admin update" on public.social_settings;
create policy "Social admin update" on public.social_settings for update to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') = 'admin')
with check ((select auth.jwt()->'app_metadata'->>'role') = 'admin');
insert into public.social_settings (id, instagram_url, whatsapp_number)
values (1, 'https://www.instagram.com/waypoint_coffe_and_hookah/', '905550109134')
on conflict (id) do nothing;
