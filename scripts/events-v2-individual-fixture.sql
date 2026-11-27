CREATE SCHEMA auth; CREATE SCHEMA private; CREATE ROLE anon; CREATE ROLE authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE TABLE public.event_cases(id uuid PRIMARY KEY,game_id uuid NOT NULL,audience text,status text,effect_plan jsonb,decision_options jsonb,title text);
CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz,role_title text,PRIMARY KEY(game_id,user_id));
CREATE TABLE public.event_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid,game_id uuid,recipient_id uuid,status text DEFAULT 'pending',stage_no integer,created_by uuid,created_at timestamptz DEFAULT now(),UNIQUE(case_id,recipient_id));
CREATE TABLE public.event_collaboration_invites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid,game_id uuid,inviter_id uuid,recipient_id uuid,status text DEFAULT 'pending',responded_at timestamptz,UNIQUE(case_id,recipient_id));
CREATE TABLE public.event_decisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid UNIQUE,case_id uuid,game_id uuid,actor_id uuid,choice text,role_snapshot text,created_at timestamptz DEFAULT now());
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
