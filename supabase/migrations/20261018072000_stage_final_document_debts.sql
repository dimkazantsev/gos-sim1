
-- An authorised office holder remains responsible for official final acts
-- after a stage is completed. No original acts, office assignments or grades are removed.
CREATE TABLE IF NOT EXISTS public.stage_final_document_obligations(
 game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
 stage_no integer NOT NULL CHECK(stage_no BETWEEN 1 AND 16),
 template_key text NOT NULL,
 user_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(game_id,stage_no,template_key,user_id)
);
CREATE INDEX IF NOT EXISTS stage_final_document_obligations_member
 ON public.stage_final_document_obligations(game_id,user_id,stage_no);
ALTER TABLE public.stage_final_document_obligations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stage_final_document_obligations FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.capture_stage_document_obligations(p_game uuid,p_stage integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
DECLARE d jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.game_stages s
   WHERE s.game_id=p_game AND s.stage_no=p_stage AND s.status='completed') THEN RETURN; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(private.stage_required_final_documents(p_game,p_stage)) LOOP
   INSERT INTO public.stage_final_document_obligations(game_id,stage_no,template_key,user_id)
   SELECT p_game,p_stage,d->>'template_key',m.user_id
   FROM public.game_members m WHERE m.game_id=p_game AND m.kind='student'
    AND m.roster_archived_at IS NULL
    AND (CASE
      WHEN d->>'subject_key'='ksrf'
       THEN private.can_coordinate_institution_meeting(p_game,'ksrf',m.user_id)
      WHEN d->>'subject_key'='any'
       THEN (private.can_create_formal_subject(p_game,m.user_id,'president')
        OR private.can_create_formal_subject(p_game,m.user_id,'government')
        OR private.can_create_formal_subject(p_game,m.user_id,'ministry')
        OR private.can_create_formal_subject(p_game,m.user_id,'municipality'))
      ELSE private.can_create_formal_subject(p_game,m.user_id,d->>'subject_key')
    END)
   ON CONFLICT DO NOTHING;
 END LOOP;
END;$fn$;
REVOKE ALL ON FUNCTION private.capture_stage_document_obligations(uuid,integer)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.capture_stage_document_obligations_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp AS $fn$
BEGIN
 IF new.status='completed' AND old.status IS DISTINCT FROM 'completed' THEN
  PERFORM private.capture_stage_document_obligations(new.game_id,new.stage_no);
 END IF;
 RETURN new;
END;$fn$;
REVOKE ALL ON FUNCTION private.capture_stage_document_obligations_trigger() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS stage_final_document_responsibility_snapshot ON public.game_stages;
CREATE TRIGGER stage_final_document_responsibility_snapshot
 AFTER UPDATE OF status ON public.game_stages
 FOR EACH ROW EXECUTE FUNCTION private.capture_stage_document_obligations_trigger();

-- Backfill historical completed stages without changing their status.
DO $backfill$ DECLARE s record;
BEGIN
 FOR s IN SELECT game_id,stage_no FROM public.game_stages WHERE status='completed' LOOP
  PERFORM private.capture_stage_document_obligations(s.game_id,s.stage_no);
 END LOOP;
END;$backfill$;

CREATE OR REPLACE FUNCTION private.stage_document_debts(p_game uuid,p_user uuid,p_stage integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
 SELECT coalesce(jsonb_agg(d ORDER BY d->>'title'),'[]'::jsonb)
 FROM jsonb_array_elements(private.stage_required_final_documents(p_game,p_stage)) d
 WHERE coalesce((d->>'fulfilled')::boolean,false)=false AND EXISTS(
  SELECT 1 FROM public.stage_final_document_obligations o
  WHERE o.game_id=p_game AND o.stage_no=p_stage
   AND o.user_id=p_user AND o.template_key=d->>'template_key'
 );
$fn$;
REVOKE ALL ON FUNCTION private.stage_document_debts(uuid,uuid,integer)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.stage_document_penalty_points(p_game uuid,p_user uuid,p_stage integer)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.game_stages
  WHERE game_id=p_game AND stage_no=p_stage AND status='completed')
  AND jsonb_array_length(private.stage_document_debts(p_game,p_user,p_stage))>0
 THEN 1::numeric ELSE 0::numeric END;
$fn$;
REVOKE ALL ON FUNCTION private.stage_document_penalty_points(uuid,uuid,integer)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.has_prior_stage_document_hold(p_game uuid,p_user uuid,p_target_stage integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
 SELECT p_target_stage BETWEEN 2 AND 16
 AND EXISTS(SELECT 1 FROM public.game_stages s
    WHERE s.game_id=p_game AND s.stage_no=p_target_stage-1
      AND s.status='completed')
 AND jsonb_array_length(private.stage_document_debts(p_game,p_user,p_target_stage-1))>0;
$fn$;
REVOKE ALL ON FUNCTION private.has_prior_stage_document_hold(uuid,uuid,integer)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_my_stage_document_holds(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public,private,pg_temp AS $fn$
DECLARE uid uuid:=auth.uid();s record;result jsonb:='[]'::jsonb;d jsonb;
BEGIN
 IF uid IS NULL OR NOT private.is_game_member(p_game_id) THEN
  RAISE EXCEPTION 'Нет доступа к игре' USING ERRCODE='42501';
 END IF;
 FOR s IN SELECT stage_no FROM public.game_stages
   WHERE game_id=p_game_id AND status='completed' AND stage_no<16
   ORDER BY stage_no LOOP
   d:=private.stage_document_debts(p_game_id,uid,s.stage_no);
   IF jsonb_array_length(d)>0 THEN
    result:=result||jsonb_build_array(jsonb_build_object(
     'source_stage',s.stage_no,'blocked_stage',s.stage_no+1,
     'missing_documents',d,'penalty_points',1));
   END IF;
 END LOOP;
 RETURN result;
END;$fn$;
REVOKE ALL ON FUNCTION public.get_my_stage_document_holds(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_stage_document_holds(uuid) TO authenticated;

-- All stage-scoped writes through public tables must honour a member's individual hold.
-- Teacher/system activity and final-document remediation on the previous stage remain permitted.
CREATE OR REPLACE FUNCTION private.guard_stage_document_hold_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
DECLARE uid uuid:=auth.uid();v_game uuid;v_stage integer;
BEGIN
 IF uid IS NULL THEN RETURN new; END IF;
 v_game:=new.game_id;v_stage:=new.stage_no;
 IF NOT private.is_game_teacher(v_game)
    AND private.has_prior_stage_document_hold(v_game,uid,v_stage) THEN
    RAISE EXCEPTION 'Следующий этап недоступен: завершите обязательные итоговые документы предыдущего этапа'
      USING ERRCODE='42501';
 END IF;
 RETURN new;
END;$fn$;
REVOKE ALL ON FUNCTION private.guard_stage_document_hold_write() FROM PUBLIC,anon,authenticated;
DO $install$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY[
  'formal_documents','game_votes','office_elections','institution_session_registrations',
  'duma_sessions','government_sessions','government_nominations','state_programs',
  'budget_scenarios','municipal_projects','game_crises','stage_debriefs',
  'presidential_addresses','ghost_voting_rounds'
 ] LOOP
  IF EXISTS(SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name=t AND column_name='stage_no')
   AND EXISTS(SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name=t AND column_name='game_id') THEN
   EXECUTE format('DROP TRIGGER IF EXISTS stage_document_member_progress_guard ON public.%I',t);
   EXECUTE format('CREATE TRIGGER stage_document_member_progress_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.guard_stage_document_hold_write()',t);
  END IF;
 END LOOP;
END;$install$;

-- Missing final material removes one legal/procedural point from an unapproved
-- automatic grade. Approved teacher grades stay unchanged.
CREATE OR REPLACE FUNCTION private.stage_assessment_deadline_penalty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_penalty numeric:=0;
  v_document_penalty numeric:=0;
begin
  select coalesce(sum(i.penalty_points),0)
    into v_penalty
  from public.stage_deadline_incidents i
  where i.game_id=new.game_id
    and i.stage_no=new.stage_no
    and i.user_id=new.user_id
    and i.status='active';

  v_document_penalty:=private.stage_document_penalty_points(new.game_id,new.user_id,new.stage_no);
  new.auto_score:=greatest(0,least(3,new.auto_score-v_penalty-v_document_penalty));
  new.evidence_summary:=coalesce(new.evidence_summary,'{}'::jsonb)
    || jsonb_build_object('deadline_penalty_points',v_penalty,'final_document_penalty_points',v_document_penalty);
  return new;
end;
$function$;
