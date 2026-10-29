-- Reduce duplicate PostgREST badge work at classroom scale.
-- Exact legacy payload, membership/teacher checks and no authorization changes.
-- Compares equal for every member, timestamp cutoff and tombstone.
CREATE OR REPLACE FUNCTION public.get_section_updates(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 u uuid:=auth.uid();
 d timestamptz;v timestamptz;e timestamptz;
 a timestamptz;p timestamptz;s timestamptz;t timestamptz;h timestamptz;
 post_actions bigint; post_dashboard bigint;
begin
 if not private.is_game_member(p_game_id) then
  raise exception 'Нет доступа к игре.' using errcode='42501';
 end if;
 select
  coalesce(max(seen_at) filter (where section_key='documents'),'-infinity'),
  coalesce(max(seen_at) filter (where section_key='votes'),'-infinity'),
  coalesce(max(seen_at) filter (where section_key='events'),'-infinity'),
  coalesce(max(seen_at) filter (where section_key='actions'),'-infinity'),
  coalesce(max(seen_at) filter (where section_key='parties'),'-infinity'),
  coalesce(max(seen_at) filter (where section_key='stages'),'-infinity'),
  coalesce(max(seen_at) filter (where section_key='teacher'),'-infinity'),
  coalesce(max(seen_at) filter (where section_key='dashboard'),'-infinity')
 into d,v,e,a,p,s,t,h
 from section_reads
 where game_id=p_game_id and user_id=u;
 -- Both labels count the same published posts with different seen cutoffs.
 -- One indexed game-scoped scan replaces two independent count queries.
 select count(*) filter (where created_at>a),
        count(*) filter (where created_at>h)
 into post_actions,post_dashboard
 from political_posts
 where game_id=p_game_id and deleted_at is null
   and created_at>least(a,h);
 return jsonb_build_object(
  'documents',(select count(*) from formal_documents where game_id=p_game_id and updated_at>d),
  'votes',(select count(*) from game_votes where game_id=p_game_id and opened_at>v),
  'events',(select count(*) from (
   select id from event_assignments where game_id=p_game_id and recipient_id=u and created_at>e
   union all
   select id from event_collaboration_invites where game_id=p_game_id and recipient_id=u and status='pending' and created_at>e
  ) q),
  'actions',post_actions
     +(select count(*) from formal_documents where game_id=p_game_id and created_at>a),
  'parties',(select count(*) from game_parties where game_id=p_game_id and created_at>p)
     +(select count(*) from party_invitations where game_id=p_game_id and invited_user_id=u and status='pending' and created_at>p),
  'stages',(select count(*) from game_stages where game_id=p_game_id
       and greatest(coalesce(opened_at,'-infinity'),coalesce(completed_at,'-infinity'))>s),
  'dashboard',post_dashboard,
  'teacher',case when private.is_game_teacher(p_game_id) then
    (select count(*) from game_parties where game_id=p_game_id and registration_status='submitted' and registration_submitted_at>t)
    +(select count(*) from party_documents where game_id=p_game_id and created_at>t and status <> 'accepted')
   else 0 end
 );
end $function$

