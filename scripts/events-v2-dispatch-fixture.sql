
-- Minimal isolated fixture for candidate dispatch and new-game seed.
ALTER TABLE games ADD COLUMN current_round int;
ALTER TABLE event_cases ADD COLUMN situation text,ADD COLUMN allowed_roles text[] DEFAULT '{}',ADD COLUMN source_url text,ADD COLUMN source_note text,ADD COLUMN verified bool DEFAULT false;
ALTER TABLE event_cases ADD CONSTRAINT fixture_game_case_unique UNIQUE(game_id,case_key);
ALTER TABLE event_cases ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE event_case_routing ADD COLUMN requires_office bool DEFAULT true;
ALTER TABLE game_members ADD COLUMN team text;
ALTER TABLE event_auto_settings ADD COLUMN enabled bool,ADD COLUMN interval_hours int,ADD COLUMN activity_weight numeric,ADD COLUMN max_daily int,ADD COLUMN last_run_at timestamptz,ADD COLUMN last_dispatched_at timestamptz,ADD COLUMN last_regional_party_id uuid;
CREATE TABLE public.game_presence(game_id uuid,user_id uuid,last_seen_at timestamptz);
CREATE TABLE public.game_parties(id uuid,game_id uuid,name text);
CREATE TABLE public.game_region_party_control(game_id uuid,region_code text,party_id uuid,fixed_at timestamptz);
CREATE TABLE private.authored_event_catalog(case_key text PRIMARY KEY,content jsonb);
CREATE TABLE public.retired_event_cases(game_id uuid,case_key text);
CREATE FUNCTION private.ensure_event_case_routing(uuid) RETURNS integer LANGUAGE sql AS $$SELECT 0$$;
