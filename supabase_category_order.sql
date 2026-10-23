-- Bir kez Supabase SQL Editor'de çalıştırın.
-- Kategori düzenleme ve yeniden sıralama tek işlemde tamamlanır.
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
revoke all on function public.save_category_order(uuid,text,text,integer) from public;
grant execute on function public.save_category_order(uuid,text,text,integer) to authenticated;

-- Mevcut eşit sıra numaralarını da tek seferde düzeltir.
with ordered as (
  select id, row_number() over (order by sort_order nulls last, created_at, id) as position from public.categories
)
update public.categories c set sort_order = ordered.position from ordered where c.id = ordered.id;
