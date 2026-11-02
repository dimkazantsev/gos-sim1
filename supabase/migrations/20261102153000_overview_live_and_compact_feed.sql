-- Read-only, teacher-only lightweight counters; full management snapshot remains authoritative.
-- No triggers, materialized views, timers or additional subscriptions.
create or replace function public.get_teacher_overview_live(p_game_id uuid)
returns jsonb language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare
 n timestamptz:=clock_timestamp();
 v_online bigint;v_actions bigint;v_active bigint;v_votes bigint;
 v_ballots bigint;v_overdue bigint;v_changes bigint;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Обзор управления доступен только преподавателю этой игры.';
 end if;
 select count(*) into v_online
 from game_presence p join game_members s
  on s.game_id=p_game_id and s.user_id=p.user_id
 where p.game_id=p_game_id and s.kind='student' and s.roster_archived_at is null
 and p.last_seen_at between n-interval '90 seconds' and n+interval '5 seconds';

 select count(*),count(distinct a.actor_id) into v_actions,v_active
 from game_activity a join game_members s
  on s.game_id=p_game_id and s.user_id=a.actor_id
 where a.game_id=p_game_id and s.kind='student' and s.roster_archived_at is null
 and a.created_at between n-interval '24 hours' and n;

 select count(*) into v_votes
 from game_votes where game_id=p_game_id and status='open';

 select count(*) into v_ballots
 from game_ballots b join game_votes v on v.id=b.vote_id
 where v.game_id=p_game_id and v.status='open';

 select count(*) into v_overdue
 from game_stages where game_id=p_game_id and status='open' and deadline<n;

 select count(*) into v_changes from state_metric_history
 where game_id=p_game_id and source_type<>'baseline'
 and recorded_at between n-interval '24 hours' and n;

 return jsonb_build_object('as_of',n,'online',v_online,'active_day',v_active,
  'actions_day',v_actions,'votes_open',v_votes,'ballots_open',v_ballots,
  'stages_overdue',v_overdue,'changes_day',v_changes);
end$$;
revoke all on function public.get_teacher_overview_live(uuid) from public,anon;
grant execute on function public.get_teacher_overview_live(uuid) to authenticated;

-- Return only the four titles and short excerpts needed on the public Overview.
-- SECURITY INVOKER intentionally preserves political_posts row-level security.
create or replace function public.get_dashboard_recent_posts(p_game_id uuid)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]'::jsonb)
 from (
  select id,title,left(body,211) as body,created_at,status
  from public.political_posts
  where game_id=p_game_id and deleted_at is null
  order by created_at desc
  limit 4
 ) p
$$;
revoke all on function public.get_dashboard_recent_posts(uuid) from public,anon;
grant execute on function public.get_dashboard_recent_posts(uuid) to authenticated;
