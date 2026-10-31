-- ================================================================
-- YALNIZCA STAGING (waypoint-pos-staging). Üretimde çalıştırılmaz: üretimde bu
-- nesneler zaten vardır. Bu yüzden supabase/migrations dışında tutulur.
--
-- Boş bir projede QR menünün ve POS migration'ının dayandığı menü tablolarını,
-- üretimle aynı son güvenlik durumuyla kurar (supabase_setup, _security,
-- _promotion, _social, _category_order, _storage betiklerinin birleşimi).
-- Örnek veri içermez; yıkıcı ifade içermez.
-- ================================================================

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  image_url   text,
  sort_order  int  default 0,
  created_at  timestamptz default now()
);

create table if not exists public.menu_items (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid references public.categories(id) on delete set null,
  name         text    not null,
  description  text,
  price        numeric not null default 0,
  image_url    text,
  is_available boolean default true,
  created_at   timestamptz default now()
);
create index if not exists menu_items_category_idx on public.menu_items(category_id);

create table if not exists public.menu_promotion (
  id integer primary key check (id = 1),
  product_id uuid references public.menu_items(id) on delete set null,
  enabled boolean not null default false
);
create index if not exists menu_promotion_product_idx on public.menu_promotion(product_id);

create table if not exists public.social_settings (
  id integer primary key check (id = 1),
  instagram_url text not null default '',
  whatsapp_number text not null default ''
);

alter table public.categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_promotion enable row level security;
alter table public.social_settings enable row level security;

revoke all on public.categories, public.menu_items, public.menu_promotion, public.social_settings from anon, authenticated;
grant select on public.categories, public.menu_items, public.menu_promotion, public.social_settings to anon, authenticated;
grant insert, update, delete on public.categories, public.menu_items to authenticated;
grant insert, update on public.menu_promotion, public.social_settings to authenticated;

create policy "Public read categories" on public.categories for select to anon, authenticated using (true);
create policy "Public read menu_items" on public.menu_items for select to anon, authenticated using (true);
create policy "Public read promotion" on public.menu_promotion for select to anon, authenticated using (true);
create policy "Social public read" on public.social_settings for select to anon, authenticated using (true);

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
create policy "Admin insert promotion" on public.menu_promotion for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Admin update promotion" on public.menu_promotion for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Social admin insert" on public.social_settings for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "Social admin update" on public.social_settings for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.save_category_order(
  p_id uuid, p_name text, p_image_url text, p_position integer
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  category_ids uuid[];
  saved_id uuid;
  target_position integer;
begin
  if coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' then
    raise exception 'Yönetici yetkisi gerekli.';
  end if;
  if nullif(trim(p_name), '') is null or p_position is null or p_position < 1 then
    raise exception 'Kategori adı ve 1 veya daha büyük sıra gerekli.';
  end if;
  lock table public.categories in share row exclusive mode;
  if p_id is not null and not exists (select 1 from public.categories where id = p_id) then
    raise exception 'Kategori bulunamadı.';
  end if;
  select coalesce(array_agg(id order by sort_order nulls last, created_at, id), '{}'::uuid[])
    into category_ids from public.categories where p_id is null or id <> p_id;
  target_position := least(p_position, cardinality(category_ids) + 1);
  if p_id is null then
    insert into public.categories(name, image_url, sort_order)
      values(trim(p_name), nullif(trim(p_image_url), ''), target_position) returning id into saved_id;
  else
    saved_id := p_id;
    update public.categories set name = trim(p_name), image_url = nullif(trim(p_image_url), '') where id = saved_id;
  end if;
  category_ids := coalesce(category_ids[1:target_position-1], '{}'::uuid[])
    || array[saved_id] || coalesce(category_ids[target_position:cardinality(category_ids)], '{}'::uuid[]);
  update public.categories c set sort_order = ordered.position::integer
    from unnest(category_ids) with ordinality as ordered(id, position) where c.id = ordered.id;
  return saved_id;
end;
$$;
revoke all on function public.save_category_order(uuid,text,text,integer) from public, anon;
grant execute on function public.save_category_order(uuid,text,text,integer) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "Menu images admin select" on storage.objects for select to authenticated
  using (bucket_id = 'menu-images' and (select auth.jwt()->'app_metadata'->>'role') = 'admin');
create policy "Menu images admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-images' and (select auth.jwt()->'app_metadata'->>'role') = 'admin');
create policy "Menu images admin update" on storage.objects for update to authenticated
  using (bucket_id = 'menu-images' and (select auth.jwt()->'app_metadata'->>'role') = 'admin')
  with check (bucket_id = 'menu-images' and (select auth.jwt()->'app_metadata'->>'role') = 'admin');
