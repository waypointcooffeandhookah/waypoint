-- ================================================
-- WAYPOINT — QR MENU DATABASE SETUP
-- © 2024 Mehmet Ali ERDOĞAN
-- Supabase SQL Editor'de çalıştırın
-- ================================================

-- 1) Kategoriler Tablosu
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  image_url   text,
  sort_order  int  default 0,
  created_at  timestamptz default now()
);

-- 2) Menü Ürünleri Tablosu
create table if not exists menu_items (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid references categories(id) on delete set null,
  name         text    not null,
  description  text,
  price        numeric not null default 0,
  image_url    text,
  is_available boolean default true,
  created_at   timestamptz default now()
);

-- 3) Row Level Security (RLS) — Herkes okuyabilir, sadece admin rolü yazabilir
alter table categories enable row level security;
alter table menu_items  enable row level security;

-- Herkese okuma izni (müşteriler menüyü görebilir)
create policy "Public read categories"
  on categories for select using (true);

create policy "Public read menu_items"
  on menu_items for select using (true);

-- Sadece kimliği doğrulanmış kullanıcı (admin) yazabilir
create policy "Admin insert categories"
  on categories for insert with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admin update categories"
  on categories for update using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admin delete categories"
  on categories for delete using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admin insert menu_items"
  on menu_items for insert with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admin update menu_items"
  on menu_items for update using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admin delete menu_items"
  on menu_items for delete using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- 4) Örnek veriler (isteğe bağlı — silebilirsiniz)
insert into categories (name, sort_order) values
  ('Başlangıçlar', 1),
  ('Ana Yemekler', 2),
  ('İçecekler',    3),
  ('Tatlılar',     4);

insert into menu_items (category_id, name, description, price, is_available)
select id, 'Mercimek Çorbası', 'Geleneksel tarif, taze ekmek ile', 75, true
from categories where name = 'Başlangıçlar' limit 1;

insert into menu_items (category_id, name, description, price, is_available)
select id, 'Izgara Köfte', 'El yapımı köfte, pilav ve salata ile', 220, true
from categories where name = 'Ana Yemekler' limit 1;

insert into menu_items (category_id, name, description, price, is_available)
select id, 'Taze Sıkılmış Portakal Suyu', 'Günlük taze portakal', 80, true
from categories where name = 'İçecekler' limit 1;

insert into menu_items (category_id, name, description, price, is_available)
select id, 'Künefe', 'Tel kadayıf, antep fıstığı ile', 140, true
from categories where name = 'Tatlılar' limit 1;
