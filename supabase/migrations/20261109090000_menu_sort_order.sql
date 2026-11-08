-- ================================================================
-- WAYPOINT — Menü sıralaması: yönetici ürünleri (kategori içinde) ve kategorileri oklarla / sürükleyerek sıralar.
--
-- Eklemelidir: menu_items.sort_order sütunu + dizin + varsayılan sıra tetikleyicisi + tek RPC. DROP yok.
-- İlk çalıştırmada mevcut ürünler bugünkü görünüm sırasıyla (eklenme zamanı) numaralanır; tekrar çalıştırmak
-- yöneticinin sıralamasını bozmaz. Yeni ürün kategorisinin sonuna, başka kategoriye taşınan ürün oranın sonuna eklenir.
-- reorder_menu tek işlemde yazar: yarım kalmış sıralama olmaz; liste eskiyse (başka cihazda ürün eklenmiş/silinmişse)
-- hiçbir şey yazmadan 'stale_order' döner. Yalnızca yönetici (app_metadata.role = admin; fonksiyonun ilk adımı).
-- ================================================================

begin;

alter table public.menu_items add column if not exists sort_order integer not null default 0;

do $$
begin
  if not exists (select 1 from public.menu_items where sort_order <> 0) then
    with ordered as (
      select id, row_number() over (partition by category_id order by created_at, id) as position from public.menu_items
    )
    update public.menu_items m set sort_order = ordered.position from ordered where m.id = ordered.id;
  end if;
end $$;

create index if not exists menu_items_category_sort_idx on public.menu_items (category_id, sort_order);

create or replace function pos_private.menu_item_default_sort() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and coalesce(new.sort_order, 0) = 0)
     or (tg_op = 'UPDATE' and new.category_id is distinct from old.category_id and new.sort_order = old.sort_order) then
    select coalesce(max(sort_order), 0) + 1 into new.sort_order
      from public.menu_items where category_id is not distinct from new.category_id and id <> new.id;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'menu_items_default_sort'
                 and tgrelid = 'public.menu_items'::regclass and not tgisinternal) then
    create trigger menu_items_default_sort before insert or update of category_id on public.menu_items
      for each row execute function pos_private.menu_item_default_sort();
  end if;
end $$;

-- p_kind: 'categories' (bütün kategoriler, yeni sırayla) veya 'items' (tek kategorinin bütün ürünleri, yeni sırayla).
create or replace function public.reorder_menu(p_kind text, p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_total    integer := coalesce(cardinality(p_ids), 0);
  v_category uuid;
  v_expected integer;
  v_updated  integer;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then perform pos_private.fail('forbidden'); end if;
  if v_total = 0 or v_total > 500 or (select count(distinct x) from unnest(p_ids) x) <> v_total
     or array_position(p_ids, null) is not null then
    perform pos_private.fail('invalid_order');
  end if;

  if p_kind = 'categories' then
    lock table public.categories in share row exclusive mode;
    select count(*) into v_expected from public.categories;
    if v_expected <> v_total then perform pos_private.fail('stale_order'); end if;
    update public.categories c set sort_order = o.position::integer
      from unnest(p_ids) with ordinality as o(id, position) where c.id = o.id;
  elsif p_kind = 'items' then
    lock table public.menu_items in share row exclusive mode;
    select category_id into v_category from public.menu_items where id = p_ids[1];
    if not found then perform pos_private.fail('stale_order'); end if;
    select count(*) into v_expected from public.menu_items where category_id is not distinct from v_category;
    if v_expected <> v_total then perform pos_private.fail('stale_order'); end if;
    update public.menu_items m set sort_order = o.position::integer
      from unnest(p_ids) with ordinality as o(id, position)
      where m.id = o.id and m.category_id is not distinct from v_category;
  else
    perform pos_private.fail('invalid_order');
  end if;

  get diagnostics v_updated = row_count;
  if v_updated <> v_total then perform pos_private.fail('stale_order'); end if;
  return v_updated;
end;
$$;

revoke all on function pos_private.menu_item_default_sort() from public, anon, authenticated;
revoke execute on function public.reorder_menu(text, uuid[]) from public, anon;
grant execute on function public.reorder_menu(text, uuid[]) to authenticated;

commit;
