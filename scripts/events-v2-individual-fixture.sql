CREATE SCHEMA auth; CREATE SCHEMA private; CREATE ROLE anon; CREATE ROLE authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE public.event_cases(id uuid PRIMARY KEY,game_id uuid NOT NULL,audience text,status text,effect_plan jsonb,decision_options jsonb,title text);
CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz,role_title text,PRIMARY KEY(game_id,user_id));
CREATE TABLE public.event_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid,game_id uuid,recipient_id uuid,status text DEFAULT 'pending',stage_no integer,created_by uuid,created_at timestamptz DEFAULT now(),UNIQUE(case_id,recipient_id));
CREATE TABLE public.event_collaboration_invites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid,game_id uuid,inviter_id uuid,recipient_id uuid,status text DEFAULT 'pending',responded_at timestamptz,UNIQUE(case_id,recipient_id));
CREATE TABLE public.event_decisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid,case_id uuid,game_id uuid,actor_id uuid,choice text,role_snapshot text,created_at timestamptz DEFAULT now(),CONSTRAINT event_decisions_case_id_actor_id_key UNIQUE(case_id,actor_id));
CREATE TABLE public.event_case_outcomes(case_id uuid PRIMARY KEY,game_id uuid,winner text,trust_delta numeric DEFAULT 0,requested_trust_delta numeric DEFAULT 0,media_post_id uuid);
CREATE TABLE public.event_authority_evidence(decision_id uuid PRIMARY KEY,case_id uuid,game_id uuid,actor_id uuid,stage_no int,authority_ok boolean,lawful boolean,strategy_point boolean,role_snapshot text,legal_basis text,coalition_ids uuid[],delegated_ok boolean,best_option boolean,score_share numeric DEFAULT 0,created_at timestamptz DEFAULT now());
CREATE TABLE public.state_metrics(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid,metric_key text,value numeric,previous_value numeric,min_value numeric,max_value numeric);
CREATE TABLE public.state_metric_history(game_id uuid,metric_id uuid,metric_key text,value numeric,previous_value numeric,delta numeric,source_type text,source_id text,actor_id uuid,note text);
CREATE TABLE public.event_trust_ledger(game_id uuid,action_key text,delta numeric);
CREATE TABLE public.political_posts(id uuid PRIMARY KEY,body text);
CREATE TABLE public.game_stages(game_id uuid,stage_no int,score_closed_at timestamptz,status text,deadline timestamptz,completed_at timestamptz);
CREATE TABLE public.blitz_assignments(game_id uuid,user_id uuid,stage_no int,is_correct boolean,answered_at timestamptz,chosen_index int,available_at timestamptz);
CREATE TABLE public.player_actions(game_id uuid,author_id uuid,round_no int,status text,submitted_at timestamptz);
CREATE FUNCTION private.event_party_controls_region(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION private.apply_event_trust_delta(g uuid,k text,d numeric,n text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.event_trust_ledger VALUES(g,k,d) $$;
CREATE OR REPLACE FUNCTION private.event_role_matches(p_snapshot text, p_roles jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from jsonb_array_elements_text(coalesce(p_roles,'[]'::jsonb)) r where lower(coalesce(p_snapshot,'')) like '%'||lower(r)||'%');$function$;
-- Functions unrelated to this test (e.g. full stage assessment) are compiled in full integration at step 5.
SET check_function_bodies=off;

ALTER TABLE event_cases ADD COLUMN comic_scene jsonb DEFAULT '{}',ADD COLUMN category text DEFAULT 'Экономика',ADD COLUMN seriousness text DEFAULT 'serious',ADD COLUMN case_key text DEFAULT 'fixture';
ALTER TABLE event_decisions ADD COLUMN rationale text;
ALTER TABLE event_case_outcomes ADD COLUMN yes_votes int,ADD COLUMN no_votes int,ADD COLUMN votes_count int,ADD COLUMN assignments_count int,ADD COLUMN resolution_kind text,ADD COLUMN option_tallies jsonb;
ALTER TABLE political_posts ALTER COLUMN id SET DEFAULT gen_random_uuid(),ADD COLUMN game_id uuid,ADD COLUMN author_id uuid,ADD COLUMN process_type text,ADD COLUMN actor_key text,ADD COLUMN actor_label text,ADD COLUMN title text,ADD COLUMN tags text[],ADD COLUMN internal_view text,ADD COLUMN internal_ref_id text,ADD COLUMN status text,ADD COLUMN comic_scene jsonb,ADD COLUMN effects_applied boolean;
CREATE TABLE games(id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE event_auto_settings(game_id uuid,trust_per_20 numeric,backlog_penalty numeric);
CREATE TABLE public.game_member_access_blocks(game_id uuid,user_id uuid,PRIMARY KEY(game_id,user_id));
CREATE TABLE public.platform_admins(user_id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION private.is_game_teacher(g uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;

  if exists (
    select 1
    from public.game_members gm
    where gm.game_id = g
      and gm.user_id = v_uid
      and gm.kind = 'teacher'
      and gm.roster_archived_at IS NULL
      and not exists (select 1 from public.game_member_access_blocks b
                      where b.game_id=gm.game_id and b.user_id=gm.user_id)
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = v_uid
  );
end;
$function$;
CREATE OR REPLACE FUNCTION private.is_game_member(g uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select auth.uid() is not null and (
  exists(select 1 from public.platform_admins a where a.user_id=auth.uid())
  or (
   not exists(select 1 from public.game_member_access_blocks b where b.game_id=g and b.user_id=auth.uid())
   and exists(select 1 from public.game_members m where m.game_id=g and m.user_id=auth.uid() and m.roster_archived_at is null)
  )
 );
$function$;

-- V2 exact institutional authority; fixture contains no real user data.
CREATE TABLE public.event_case_routing(game_id uuid,case_id uuid,earliest_stage int,latest_stage int,destination text,region_code text,PRIMARY KEY(game_id,case_id));
CREATE TABLE public.institution_units(id uuid PRIMARY KEY,game_id uuid,unit_kind text,unit_key text,head_user_id uuid);
CREATE TABLE public.institution_assignments(game_id uuid,unit_id uuid,unit_kind text,user_id uuid,assignment_role text);
CREATE TABLE public.party_member_mandates(game_id uuid,user_id uuid,effective_mandates int);
CREATE TABLE public.government_nominations(game_id uuid,stage_no int,office_key text,status text,candidate_user_id uuid,office_title text);
CREATE TABLE public.game_office_assignments(game_id uuid,user_id uuid,role_title text,status text);
CREATE TABLE public.fixture_suspended(game_id uuid,user_id uuid);
CREATE FUNCTION private.role_is_available(g uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT NOT EXISTS(SELECT 1 FROM public.fixture_suspended WHERE game_id=g AND user_id=u)$$;
