-- ГОС.ID 2026-11-07: project only light document and profile columns before JSON construction.
-- Previous JSON keys and RLS execution mode are identical; measured equality on existing rows.
CREATE OR REPLACE FUNCTION public.get_game_entry_v5(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then
  raise exception 'Нет доступа к игре.' using errcode='42501';
 end if;
 return jsonb_build_object(
  'game', (select to_jsonb(g) from public.games g where g.id=p_game_id),
  'metrics', (select coalesce(jsonb_agg(to_jsonb(x) order by x.label),'[]'::jsonb)
   from public.state_metrics x where x.game_id=p_game_id),
  'channels', (select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb)
   from public.chat_channels x where x.game_id=p_game_id),
  'stages', (select coalesce(jsonb_agg(to_jsonb(x) order by x.stage_no),'[]'::jsonb)
   from public.game_stages x where x.game_id=p_game_id),
  'votes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.opened_at desc),'[]'::jsonb)
   from public.game_votes x where x.game_id=p_game_id),
  'crises', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
   from public.game_crises x where x.game_id=p_game_id),
  'profiles', (select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('bio',null)),'[]'::jsonb)
   from (select game_id,user_id,avatar_path,updated_at,signature_path,gender,onboarding_completed_at,intro_seen_at,profile_setup_prompt_seen_at from public.game_profiles where game_id=p_game_id) x),
  'formal_documents', (select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('body_text',null,'metadata','{}'::jsonb) order by x.updated_at desc),'[]'::jsonb)
   from (select id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,source_file_path,source_file_name,source_mime_type,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,created_at,updated_at from public.formal_documents where game_id=p_game_id) x),
  'member', (select to_jsonb(m) from public.game_members m
   where m.game_id=p_game_id and m.user_id=auth.uid()),
  'roster', (select coalesce(jsonb_agg(to_jsonb(m) order by m.full_name),'[]'::jsonb)
   from (select game_id,user_id,full_name,group_name,kind,role_title,team,score,joined_at,
       party_joined_at,roster_archived_at
    from public.game_members where game_id=p_game_id) m),
  'parties', (select coalesce(jsonb_agg(to_jsonb(p) order by p.support desc,p.created_at,p.id),'[]'::jsonb)
   from (select id,game_id,created_by,name,support,mandates,regions,budget,leader_user_id,
       color,logo_path,ghost_loss_current,ghost_active,ghost_started_at,
       representation_penalty,regional_seat_penalty,ghost_risk_weight,presidential_rating_modifier,
       registration_status,registration_submitted_at,registration_reviewed_at,registration_reviewed_by,
       mandate_allocation_mode,regional_seats_awarded,created_at,rating
    from public.game_parties where game_id=p_game_id) p),
  'intro', public.has_seen_my_intro()
 );
end;
$function$;
