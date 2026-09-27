-- Party cabinet, user profiles and private game assets.
alter table public.game_parties
  add column if not exists description text,
  add column if not exists logo_path text;

create table if not exists public.game_profiles(
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bio text,
  avatar_path text,
  updated_at timestamptz not null default now(),
  primary key(game_id,user_id)
);
create index if not exists game_profiles_user_idx on public.game_profiles(user_id);
alter table public.game_profiles enable row level security;
grant select,insert,update on public.game_profiles to authenticated;

drop policy if exists game_profiles_read on public.game_profiles;
create policy game_profiles_read on public.game_profiles for select to authenticated using(private.is_game_member(game_id));
drop policy if exists game_profiles_own_write on public.game_profiles;
create policy game_profiles_own_write on public.game_profiles for all to authenticated
using(user_id=(select auth.uid()) and private.is_game_member(game_id))
with check(user_id=(select auth.uid()) and private.is_game_member(game_id));

create table if not exists public.party_documents(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  party_id uuid not null references public.game_parties(id) on delete cascade,
  doc_kind text not null check(doc_kind in ('application','charter','program','fee','symbol','congress_minutes','other')),
  title text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'submitted' check(status in ('draft','submitted','accepted','revision')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists party_documents_party_idx on public.party_documents(party_id,created_at desc);
create index if not exists party_documents_game_idx on public.party_documents(game_id);
create index if not exists party_documents_uploaded_by_idx on public.party_documents(uploaded_by);
alter table public.party_documents enable row level security;
grant select,insert,update,delete on public.party_documents to authenticated;

drop policy if exists party_documents_read on public.party_documents;
create policy party_documents_read on public.party_documents for select to authenticated
using(
  private.is_game_teacher(game_id)
  or exists(
    select 1 from public.game_parties p
    join public.game_members gm on gm.game_id=p.game_id and gm.team=p.name
    where p.id=party_id and gm.user_id=(select auth.uid())
  )
  or doc_kind in ('program','symbol')
);

drop policy if exists party_documents_insert on public.party_documents;
create policy party_documents_insert on public.party_documents for insert to authenticated
with check(
  uploaded_by=(select auth.uid())
  and (
    private.is_game_teacher(game_id)
    or exists(
      select 1 from public.game_parties p
      join public.game_members gm on gm.game_id=p.game_id and gm.team=p.name
      where p.id=party_id and gm.user_id=(select auth.uid())
    )
  )
);
drop policy if exists party_documents_update on public.party_documents;
create policy party_documents_update on public.party_documents for update to authenticated
using(private.is_game_teacher(game_id) or uploaded_by=(select auth.uid()))
with check(private.is_game_teacher(game_id) or uploaded_by=(select auth.uid()));
drop policy if exists party_documents_delete on public.party_documents;
create policy party_documents_delete on public.party_documents for delete to authenticated
using(private.is_game_teacher(game_id) or uploaded_by=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('game-assets','game-assets',false,15728640,array[
'image/jpeg','image/png','image/webp','application/pdf',
'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
'application/msword','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists game_assets_read on storage.objects;
create policy game_assets_read on storage.objects for select to authenticated
using(bucket_id='game-assets' and private.is_game_member((split_part(name,'/',1))::uuid));

drop policy if exists game_assets_profile_insert on storage.objects;
create policy game_assets_profile_insert on storage.objects for insert to authenticated
with check(bucket_id='game-assets' and split_part(name,'/',2)='profiles'
and split_part(name,'/',3)=(select auth.uid())::text
and private.is_game_member((split_part(name,'/',1))::uuid));

drop policy if exists game_assets_party_insert on storage.objects;
create policy game_assets_party_insert on storage.objects for insert to authenticated
with check(
  bucket_id='game-assets'
  and split_part(name,'/',2)='parties'
  and (
    private.is_game_teacher((split_part(name,'/',1))::uuid)
    or exists(
      select 1 from public.game_parties p
      join public.game_members gm on gm.game_id=p.game_id and gm.team=p.name
      where p.id=(split_part(name,'/',3))::uuid and gm.user_id=(select auth.uid())
    )
  )
);

create or replace function public.update_my_party_identity(
  p_party_id uuid,
  p_description text default null,
  p_logo_path text default null
)
returns void language plpgsql security definer
set search_path = public, private, pg_temp
as $$
declare v_game_id uuid; v_party_name text;
begin
  select game_id,name into v_game_id,v_party_name from public.game_parties where id=p_party_id;
  if v_game_id is null then raise exception 'Party not found'; end if;
  if not (
    private.is_game_teacher(v_game_id)
    or exists(select 1 from public.game_members gm where gm.game_id=v_game_id and gm.user_id=(select auth.uid()) and gm.team=v_party_name)
  ) then raise exception 'Party access required'; end if;
  update public.game_parties
  set description=coalesce(p_description,description),logo_path=coalesce(p_logo_path,logo_path)
  where id=p_party_id;
end;
$$;
revoke all on function public.update_my_party_identity(uuid,text,text) from public, anon;
grant execute on function public.update_my_party_identity(uuid,text,text) to authenticated;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_profiles') then
    alter publication supabase_realtime add table public.game_profiles;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='party_documents') then
    alter publication supabase_realtime add table public.party_documents;
  end if;
end $$;
