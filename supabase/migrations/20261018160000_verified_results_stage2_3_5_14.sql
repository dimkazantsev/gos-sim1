-- ГОС.ID. Provenance-preserving decisions for existing procedural sources.
-- These are only four previously unlinked, confirmed-result routes.
-- No automatic signature or publication is impersonated.
CREATE UNIQUE INDEX IF NOT EXISTS official_act_verified_vote_unique
ON public.formal_documents(game_id,(metadata->>'source_vote_id'))
WHERE metadata->>'document_kind'='verified_vote_decision_act';


-- Forged results and reassignment of an already verified source are forbidden.
CREATE OR REPLACE FUNCTION private.guard_verified_vote_act_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $origin$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.metadata->>'document_kind'='verified_vote_decision_act'
      AND auth.uid() IS NOT NULL AND pg_trigger_depth()<=1
   THEN RAISE EXCEPTION 'Служебный документ создаётся только по подтверждённому голосованию'
     USING ERRCODE='42501'; END IF;
   RETURN NEW;
 END IF;
 IF COALESCE(OLD.metadata->>'document_kind','')='verified_vote_decision_act'
 OR COALESCE(NEW.metadata->>'document_kind','')='verified_vote_decision_act' THEN
   IF OLD.metadata->>'document_kind' IS DISTINCT FROM NEW.metadata->>'document_kind'
    OR OLD.metadata->>'source_vote_id' IS DISTINCT FROM NEW.metadata->>'source_vote_id'
    OR OLD.metadata->>'source_entity_id' IS DISTINCT FROM NEW.metadata->>'source_entity_id'
    OR OLD.metadata->>'source_type' IS DISTINCT FROM NEW.metadata->>'source_type'
    OR OLD.metadata->>'template_key' IS DISTINCT FROM NEW.metadata->>'template_key'
    OR OLD.game_id IS DISTINCT FROM NEW.game_id OR OLD.stage_no IS DISTINCT FROM NEW.stage_no
    OR OLD.subject_key IS DISTINCT FROM NEW.subject_key OR OLD.doc_type IS DISTINCT FROM NEW.doc_type
   THEN RAISE EXCEPTION 'Нельзя подменить подтверждённый источник правового акта'
      USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END;$origin$;
REVOKE ALL ON FUNCTION private.guard_verified_vote_act_origin() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_verified_vote_act_origin ON public.formal_documents;
CREATE TRIGGER guard_verified_vote_act_origin BEFORE INSERT OR UPDATE ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.guard_verified_vote_act_origin();

CREATE OR REPLACE FUNCTION private.sync_verified_vote_decision_act(p_vote_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $sync$
DECLARE v public.game_votes%rowtype; v_doc uuid;v_steps jsonb;
 v_type text;v_owner text;v_subject text;v_label text;v_title text;
 v_body text;v_source uuid;v_author uuid;v_stage integer;v_step integer;
 v_code text;v_status_label text;v_registry text;v_project record;
BEGIN
 SELECT * INTO v FROM public.game_votes WHERE id=p_vote_id;
 IF v.id IS NULL OR v.status<>'closed' OR v.result_code<>'passed'
 OR v.formal_document_id IS NOT NULL THEN RETURN NULL; END IF;
 IF NOT (
  (v.stage_no=2 AND v.procedure_key='electoral_system' AND v.institution_key='ksrf')
  OR (v.stage_no=3 AND v.procedure_key='regional_system' AND v.institution_key='ksrf')
  OR (v.stage_no=5 AND v.procedure_key='ghost_policy' AND v.institution_key='gd')
  OR (v.stage_no=14 AND v.procedure_key='municipal_project' AND v.institution_key='municipality')
 ) THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('decision-act:'||v.id::text,0));

 -- An official result must be present in the authoritative source table.
 IF v.stage_no=2 THEN
  SELECT id INTO v_source FROM public.parliamentary_election_rules
   WHERE game_id=v.game_id AND vote_id=v.id AND status='adopted' LIMIT 1;
 ELSIF v.stage_no=3 THEN
  SELECT id INTO v_source FROM public.regional_election_rules
   WHERE game_id=v.game_id AND vote_id=v.id AND status IN('adopted','allocated') LIMIT 1;
 ELSIF v.stage_no=5 THEN
  SELECT id INTO v_source FROM public.ghost_voting_policies
   WHERE game_id=v.game_id AND vote_id=v.id AND status='adopted' LIMIT 1;
 ELSE
  SELECT p.id,p.created_by,p.problem_title,p.location_text,
   p.legal_competence,p.proposed_solution,p.estimated_cost,p.expected_effect
  INTO v_project FROM public.municipal_projects p
   WHERE p.game_id=v.game_id AND p.vote_id=v.id AND p.status='adopted' LIMIT 1;
  v_source:=v_project.id;
 END IF;
 IF v_source IS NULL THEN RETURN NULL; END IF;

 -- The source decision is adopted; publication is an independent legal action.
 v_author:=v.created_by;
 IF v_author IS NULL AND v.stage_no=14 THEN v_author:=v_project.created_by; END IF;
 IF v_author IS NULL THEN RETURN NULL; END IF;
 v_body:=format('Источник решения: голосование № %s. Вопрос: %s.',
   v.id,coalesce(nullif(btrim(v.title),''),'Не указан'));
 v_body:=v_body||E'\nРезультат: принято; за — '
  ||coalesce(v.result_yes::text,'0')||', против — '
  ||coalesce(v.result_no::text,'0')||', воздержались — '
  ||coalesce(v.result_abstain::text,'0')||'.';
 IF nullif(btrim(coalesce(v.body,'')),'') IS NOT NULL THEN
   v_body:=v_body||E'\n\nРассмотренное предложение:\n'||v.body;
 END IF;
 IF v.stage_no IN (2,3) THEN
   v_type:='other';v_subject:='ksrf';v_label:='КСРФ';v_owner:='author';
   v_title:=CASE v.stage_no WHEN 2 THEN
    'Протокол заседания КСРФ об избирательной системе'
    ELSE 'Протокол заседания КСРФ о распределении субъектов РФ' END;
   v_steps:='[{"code":"draft","label":"Проект протокола КСРФ","owner":"author","action":"Подтвердить протокол"},{"code":"published","label":"Протокол опубликован","owner":"system","action":null}]'::jsonb;
   v_step:=0;v_code:='draft';v_status_label:='Проект протокола по подтверждённому решению';
 ELSIF v.stage_no=5 THEN
   v_type:='gd_resolution';v_subject:='gd';v_label:='Государственная Дума Федерального Собрания Российской Федерации';
   v_owner:='gd_staff';v_title:='О введении режима Goust Voting';
   v_steps:=private.formal_workflow('gd_resolution');
   v_step:=2;v_code:='adopted';v_status_label:='Принято голосованием · ожидает опубликования';
 ELSIF v.stage_no=14 THEN
   v_type:='municipal_act';v_subject:='municipality';v_label:='Муниципальное образование';
   v_owner:='municipality';v_title:='О реализации муниципального проекта «'
      ||coalesce(nullif(btrim(v_project.problem_title),''),'без названия')||'»';
   v_body:=v_body||E'\n\nМесто реализации: '
    ||coalesce(v_project.location_text,'Не указано')||'.'
    ||E'\nПредлагаемые меры: '||coalesce(v_project.proposed_solution,'Не указаны')||'.'
    ||E'\nПравовое обоснование: '||coalesce(v_project.legal_competence,'Не указано')||'.'
    ||E'\nОжидаемый эффект: '||coalesce(v_project.expected_effect,'Не указан')||'.';
   v_steps:=private.formal_workflow('municipal_act');
   v_step:=2;v_code:='adopted';v_status_label:='Принято голосованием · ожидает оформления';
 END IF;

 INSERT INTO public.formal_documents(
 game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,
 author_id,body_text,workflow_key,workflow_steps,current_step,status_code,
 status_label,current_owner_key,metadata)
 VALUES(v.game_id,v.stage_no,'ИГРА-РЕШ-'||
  lpad(nextval('public.formal_registry_seq')::text,5,'0'),v_title,
  v_type,v_subject,v_label,v_author,v_body,
  CASE WHEN v.stage_no IN (2,3) THEN 'generic'
   WHEN v.stage_no=5 THEN 'gd_resolution' ELSE 'municipal_act' END,
  v_steps,v_step,v_code,v_status_label,v_owner,
  jsonb_build_object('document_kind','verified_vote_decision_act',
  'source_vote_id',v.id::text,'source_entity_id',v_source::text,
  'source_type',CASE v.stage_no
    WHEN 2 THEN 'parliamentary_election_rules'
    WHEN 3 THEN 'regional_election_rules'
    WHEN 5 THEN 'ghost_voting_policies'
    ELSE 'municipal_projects' END,
  'template_key',CASE v.stage_no
    WHEN 2 THEN 'minutes' WHEN 3 THEN 'minutes'
    WHEN 5 THEN 'gd_resolution' ELSE 'municipal_act' END,
  'auto_generated',true,'vote_result','passed'))
 ON CONFLICT DO NOTHING RETURNING id INTO v_doc;
 IF v_doc IS NOT NULL THEN
  INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
  VALUES(v_doc,v.game_id,NULL,'Сформирован документ по подтверждённому голосованию',
    v_code,v_owner,'Источники и результаты зафиксированы; подпись и публикация не имитируются.');
 END IF;
 RETURN v_doc;
END;$sync$;
REVOKE ALL ON FUNCTION private.sync_verified_vote_decision_act(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.verified_vote_decision_act_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $trigger$
BEGIN
 IF NEW.status='closed' AND (OLD.status IS DISTINCT FROM NEW.status
    OR OLD.result_code IS DISTINCT FROM NEW.result_code) AND NEW.result_code='passed'
 THEN PERFORM private.sync_verified_vote_decision_act(NEW.id); END IF;
 RETURN NEW;
END;$trigger$;
REVOKE ALL ON FUNCTION private.verified_vote_decision_act_trigger() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zzz_sync_verified_vote_decision_act ON public.game_votes;
CREATE TRIGGER zzz_sync_verified_vote_decision_act
AFTER UPDATE OF status,result_code ON public.game_votes
FOR EACH ROW EXECUTE FUNCTION private.verified_vote_decision_act_trigger();

-- Backfill confirmed past results only; non-confirmed and incomplete procedures stay untouched.
DO $backfill$
DECLARE v record;
BEGIN
 FOR v IN SELECT id FROM public.game_votes
  WHERE status='closed' AND result_code='passed'
    AND stage_no IN(2,3,5,14)
    AND procedure_key IN ('electoral_system','regional_system','ghost_policy','municipal_project')
 LOOP
   PERFORM private.sync_verified_vote_decision_act(v.id);
 END LOOP;
END;$backfill$;
