-- Isolated VSN data for the production-derived private.blitz_vsn_components.
CREATE TABLE public.event_authority_evidence (
  game_id uuid,actor_id uuid,stage_no integer,
  score_share numeric,best_option boolean,authority_ok boolean,lawful boolean
);
CREATE TABLE public.player_actions (
  game_id uuid,author_id uuid,round_no integer,status text
);
-- Student 2 has a fully correct case, three lawful accepted actions,
-- and one answered Blitz card (created by the 30-student parallel test).
INSERT INTO public.event_authority_evidence VALUES
 (md5('game')::uuid,md5('student-2')::uuid,1,1,true,true,true);
INSERT INTO public.player_actions
 SELECT md5('game')::uuid,md5('student-2')::uuid,1,'accepted' FROM generate_series(1,3);
-- Student 3 has case evidence but no accepted actions.
INSERT INTO public.event_authority_evidence VALUES
 (md5('game')::uuid,md5('student-3')::uuid,1,1,true,true,true);
