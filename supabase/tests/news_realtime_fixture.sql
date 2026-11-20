-- Synthetic fixture for a physically isolated disposable Supabase stack only.
do $$begin
 if exists(select 1 from auth.users limit 1)
    or to_regclass('public.games') is not null
    or to_regclass('public.media_news_proposals') is not null then
  raise exception 'Disposable news test database must be empty';
 end if;
end$$;
create schema if not exists private;
create table public.qa_news_members(game_id uuid not null,user_id uuid not null,kind text not null,primary key(game_id,user_id));
create function private.is_game_member(p_game uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.qa_news_members where game_id=p_game and user_id=(select auth.uid()))
$$;
create function private.is_game_teacher(p_game uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.qa_news_members where game_id=p_game and user_id=(select auth.uid()) and kind='teacher')
$$;
create table public.media_news_proposals(id uuid primary key,game_id uuid not null,author_id uuid not null,status text not null,title text not null);
alter table public.media_news_proposals enable row level security;
create policy media_proposals_read on public.media_news_proposals for select to authenticated
 using (private.is_game_member(game_id) and (author_id=(select auth.uid()) or private.is_game_teacher(game_id)));
grant usage on schema private to authenticated;
grant execute on function private.is_game_member(uuid),private.is_game_teacher(uuid) to authenticated;
grant select on public.media_news_proposals to authenticated;
grant all on public.qa_news_members,public.media_news_proposals to service_role;
create table public.qa_news_disposable_guard(marker text primary key);
insert into public.qa_news_disposable_guard values ('gos-id-disposable-news-v1');
revoke all on public.qa_news_disposable_guard from public,anon,authenticated;
grant select on public.qa_news_disposable_guard to service_role;
alter publication supabase_realtime add table public.media_news_proposals;
