-- Full-stack audit hardening: secure archived data, stabilize function search paths,
-- reduce per-row auth evaluation in RLS, and index production notification hot paths.

alter table public.retired_event_cases enable row level security;
alter function private.stage_comic_summary(jsonb) set search_path = pg_catalog;

do $$
declare
  r record;
  v_using text;
  v_check text;
  v_sql text;
begin
  for r in
    select schemaname,tablename,policyname,qual,with_check
    from pg_policies
    where schemaname='public'
      and (
        (coalesce(qual,'') like '%auth.uid()%' and coalesce(qual,'') not like '%SELECT auth.uid()%')
        or
        (coalesce(with_check,'') like '%auth.uid()%' and coalesce(with_check,'') not like '%SELECT auth.uid()%')
      )
  loop
    v_using:=r.qual;
    v_check:=r.with_check;
    if v_using is not null and v_using like '%auth.uid()%' and v_using not like '%SELECT auth.uid()%' then
      v_using:=replace(v_using,'auth.uid()','(select auth.uid())');
    end if;
    if v_check is not null and v_check like '%auth.uid()%' and v_check not like '%SELECT auth.uid()%' then
      v_check:=replace(v_check,'auth.uid()','(select auth.uid())');
    end if;
    v_sql:=format('alter policy %I on %I.%I',r.policyname,r.schemaname,r.tablename);
    if v_using is not null then v_sql:=v_sql||' using ('||v_using||')'; end if;
    if v_check is not null then v_sql:=v_sql||' with check ('||v_check||')'; end if;
    execute v_sql;
  end loop;
end $$;

alter policy login_email_self_insert on public.member_login_emails
with check (
  user_id=(select auth.uid())
  and private.is_game_member(game_id)
  and lower(email)=lower(((select auth.jwt())->>'email'))
  and coalesce((((select auth.jwt())->>'is_anonymous')::boolean),false)=false
);

alter policy login_email_self_update on public.member_login_emails
using (user_id=(select auth.uid()))
with check (
  user_id=(select auth.uid())
  and lower(email)=lower(((select auth.jwt())->>'email'))
  and coalesce((((select auth.jwt())->>'is_anonymous')::boolean),false)=false
);

create index if not exists event_assignments_badge_idx
  on public.event_assignments(game_id,recipient_id,status,created_at desc);

drop index if exists public.collaboration_invites_badge;
create index collaboration_invites_badge
  on public.event_collaboration_invites(game_id,recipient_id,status,created_at desc);

create index if not exists game_votes_updates_idx
  on public.game_votes(game_id,opened_at desc);
