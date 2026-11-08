-- ================================================================
-- WAYPOINT RESTAURANT OS — Geçici adisyon adı (garson masaya o oturum için ad/not yazar)
--
-- Örn. "Ahmet Bey", "Doğum günü". Masa kartında, adisyonda ve mutfakta görünür; masanın kalıcı adı ve QR kodu
-- değişmez. Hesap kapanınca ad kendiliğinden silinir (kişisel veri birikmez).
-- Eklemelidir: tek sütun + tek RPC + kapanışta silen tetikleyici. Mevcut fonksiyonlar değişmez. DROP yok.
-- Müşteri (anon) bu alanı göremez: table_sessions yalnızca personel tarafından okunur (mevcut RLS).
-- ================================================================

begin;

alter table public.table_sessions add column if not exists guest_label text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'table_sessions_guest_label_check') then
    alter table public.table_sessions add constraint table_sessions_guest_label_check
      check (guest_label is null or char_length(guest_label) between 1 and 40);
  end if;
end $$;

-- Garson/kasa/müdür/yönetici: masanın açık oturumuna ad verir. Oturum yoksa açar (müşteri oturdu, sipariş henüz yok).
-- Boş ad = adı kaldır (oturum açmaz).
create or replace function public.set_table_session_label(p_table_id uuid, p_label text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor   uuid := pos_private.require_role(array['waiter', 'cashier', 'manager', 'admin']);
  v_label   text := nullif(btrim(regexp_replace(coalesce(p_label, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), '');
  v_session uuid;
begin
  if char_length(v_label) > 40 then perform pos_private.fail('invalid_label'); end if;
  select id into v_session from public.table_sessions where table_id = p_table_id and status = 'open' for update;
  if v_session is null then
    if v_label is null then return jsonb_build_object('session_id', null, 'guest_label', null); end if;
    v_session := (public.open_table_session(p_table_id) ->> 'session_id')::uuid;
  end if;
  update public.table_sessions set guest_label = v_label where id = v_session;
  return jsonb_build_object('session_id', v_session, 'guest_label', v_label);
end;
$$;

-- Hesap kapanınca (normal veya zorla) ad silinir.
create or replace function pos_private.clear_session_label() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.status = 'closed' then new.guest_label := null; end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'table_sessions_clear_label'
                 and tgrelid = 'public.table_sessions'::regclass and not tgisinternal) then
    create trigger table_sessions_clear_label before update of status on public.table_sessions
      for each row execute function pos_private.clear_session_label();
  end if;
end $$;

revoke all on function pos_private.clear_session_label() from public, anon, authenticated;
revoke execute on function public.set_table_session_label(uuid, text) from public, anon;
grant execute on function public.set_table_session_label(uuid, text) to authenticated;

commit;
