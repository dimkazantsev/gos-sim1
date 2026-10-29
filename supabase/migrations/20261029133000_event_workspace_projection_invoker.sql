-- Step 2/9: consistent, per-request EventWorkspace projection.
-- Read-only: no materialized rows, triggers, locks, invalidation jobs or WAL amplification.
-- SECURITY INVOKER deliberately preserves the *distinct* RLS policies on all six tables.
-- Only explicit display columns are included; bank text / unassigned cases never enter the feed.
create or replace function public.get_event_workspace_projection(
 p_game_id uuid, p_include_ready_count boolean default false
) returns jsonb language plpgsql stable security invoker
set search_path = ''
as $function$
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then
  raise exception 'Нет доступа к игре.' using errcode='42501';
 end if;
 return jsonb_build_object(
  'assignments', coalesce((select jsonb_agg(to_jsonb(x) order by x.id)
   from (select id,case_id,game_id,recipient_id,status,created_at from public.event_assignments
     where game_id=p_game_id) x),'[]'::jsonb),
  'decisions', coalesce((select jsonb_agg(to_jsonb(x) order by x.id)
   from (select id,case_id,actor_id,choice,role_snapshot from public.event_decisions
     where game_id=p_game_id) x),'[]'::jsonb),
  'outcomes', coalesce((select jsonb_agg(to_jsonb(x) order by x.case_id)
   from (select case_id,winner,trust_delta,votes_count,assignments_count,media_post_id,requested_trust_delta,resolution_kind from public.event_case_outcomes
     where game_id=p_game_id) x),'[]'::jsonb),
  'invitations', coalesce((select jsonb_agg(to_jsonb(x) order by x.id)
   from (select id,case_id,inviter_id,recipient_id,status from public.event_collaboration_invites
     where game_id=p_game_id) x),'[]'::jsonb),
  'authority', coalesce((select jsonb_agg(to_jsonb(x) order by x.decision_id)
   from (select decision_id,case_id,actor_id,authority_ok,lawful,strategy_point,role_snapshot,legal_basis from public.event_authority_evidence
     where game_id=p_game_id) x),'[]'::jsonb),
  'ready_case_count', case when p_include_ready_count then
   (select count(*) from public.event_cases where game_id=p_game_id and status='ready')
   else null end
 );
end;
$function$;

revoke all on function public.get_event_workspace_projection(uuid,boolean) from public, anon;
grant execute on function public.get_event_workspace_projection(uuid,boolean) to authenticated;
