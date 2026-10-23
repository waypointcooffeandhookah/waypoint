-- Supabase SQL Editor'de çalıştırın. Menü fotoğrafları herkese açıktır;
-- yalnızca app_metadata.role = admin olan hesaplar yükleyebilir.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists "Menu images admin select" on storage.objects;
create policy "Menu images admin select" on storage.objects for select to authenticated
using (bucket_id = 'menu-images' and (select auth.jwt()->'app_metadata'->>'role') = 'admin');
drop policy if exists "Menu images admin insert" on storage.objects;
create policy "Menu images admin insert" on storage.objects for insert to authenticated
with check (bucket_id = 'menu-images' and (select auth.jwt()->'app_metadata'->>'role') = 'admin');
drop policy if exists "Menu images admin update" on storage.objects;
create policy "Menu images admin update" on storage.objects for update to authenticated
using (bucket_id = 'menu-images' and (select auth.jwt()->'app_metadata'->>'role') = 'admin')
with check (bucket_id = 'menu-images' and (select auth.jwt()->'app_metadata'->>'role') = 'admin');
