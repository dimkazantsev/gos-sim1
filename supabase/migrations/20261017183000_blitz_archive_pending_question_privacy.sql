-- ГОС.ID. Prevent pre-reading queued Blitz questions.
-- Pending archive rows expose scheduling metadata only, even if the student
-- calls the RPC directly rather than using the interface. Teachers can review
-- their catalog, and completed attempts retain the question and explanation.
-- The existing 20-second atomic open/answer functions and RLS remain unchanged.
CREATE OR REPLACE FUNCTION public.blitz_archive(p_game uuid, p_student uuid DEFAULT NULL::uuid, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid(); target uuid:=coalesce(p_student,auth.uid()); teacher boolean; payload jsonb;
begin
 teacher:=exists(select 1 from public.game_members where game_id=p_game and user_id=uid and kind='teacher');
 if uid is null or (uid<>target and not teacher) or not exists(select 1 from public.game_members where game_id=p_game and user_id=target) then raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into payload from (
  select a.id,a.stage_no,a.available_at,a.answered_at,a.chosen_index,a.is_correct,
   case when a.answered_at is not null or teacher then q.question else null end question,
   case when a.answered_at is not null or teacher then q.topic else null end topic,
   case when a.answered_at is not null or teacher then q.options else null end options,
   case when a.answered_at is not null or teacher then q.correct_index else null end correct_index,
   case when a.answered_at is not null or teacher then q.explanation else null end explanation,
   case when a.answered_at is not null or teacher then q.legal_act else null end legal_act,
   case when a.answered_at is not null or teacher then q.article else null end article,
   case when a.answered_at is not null or teacher then q.source_url else null end source_url
  from public.blitz_assignments a join public.blitz_questions q on q.id=a.question_id
  where a.game_id=p_game and a.user_id=target order by a.available_at desc offset greatest(0,p_offset) limit least(100,greatest(1,p_limit))
 ) t;
 return payload;
end $function$;

CREATE OR REPLACE FUNCTION public.blitz_archive_filtered(p_game uuid, p_student uuid DEFAULT NULL::uuid, p_state text DEFAULT 'pending'::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid(); target uuid:=coalesce(p_student,auth.uid()); teacher boolean; payload jsonb;
begin
 teacher:=exists(select 1 from public.game_members where game_id=p_game and user_id=uid and kind='teacher');
 if uid is null or (uid<>target and not teacher) or
    not exists(select 1 from public.game_members where game_id=p_game and user_id=target)
 then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_state not in ('pending','answered') then raise exception 'Invalid state' using errcode='22023'; end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into payload from (
  select a.id,a.stage_no,a.available_at,a.started_at,a.answered_at,a.chosen_index,a.is_correct,
   case when a.answered_at is not null or teacher then q.question else null end question,
   case when a.answered_at is not null or teacher then q.topic else null end topic,
   case when a.answered_at is not null or teacher then q.options else null end options,
   case when a.answered_at is not null or teacher then q.correct_index else null end correct_index,
   case when a.answered_at is not null or teacher then q.explanation else null end explanation,
   case when a.answered_at is not null or teacher then q.legal_act else null end legal_act,
   case when a.answered_at is not null or teacher then q.article else null end article,
   case when a.answered_at is not null or teacher then q.source_url else null end source_url
  from public.blitz_assignments a join public.blitz_questions q on q.id=a.question_id
  where a.game_id=p_game and a.user_id=target and
   ((p_state='pending' and a.answered_at is null) or (p_state='answered' and a.answered_at is not null))
  order by a.available_at desc,a.id desc
  offset greatest(0,p_offset) limit least(100,greatest(1,p_limit))
 ) t;
 return payload;
end $function$;
REVOKE ALL ON FUNCTION public.blitz_archive_filtered(uuid,uuid,text,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.blitz_archive(uuid,uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.blitz_archive_filtered(uuid,uuid,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.blitz_archive(uuid,uuid,integer,integer) TO authenticated;
