-- ГОС.ID: link reviewed crisis responses with editable legal-act drafts
-- only for the actual official competent to issue that act.
CREATE UNIQUE INDEX IF NOT EXISTS crisis_response_legal_act_source_uq
ON public.formal_documents(game_id,(metadata->>'source_crisis_response_id'))
WHERE metadata->>'document_kind'='crisis_response_act';

CREATE OR REPLACE FUNCTION private.sync_reviewed_crisis_legal_act(p_response uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $sync$
DECLARE r public.crisis_responses%rowtype;
 c public.game_crises%rowtype;
 v_actor uuid;v_subject text;v_doc_type text;v_subject_label text;
 v_doc uuid;v_steps jsonb;v_body text;v_key text;
BEGIN
 SELECT * INTO r FROM public.crisis_responses WHERE id=p_response;
 IF r.id IS NULL OR r.status<>'reviewed' OR r.reviewed_by IS NULL
   OR r.user_id IS NULL OR nullif(btrim(r.action_plan),'') IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.game_crises WHERE id=r.crisis_id AND game_id=r.game_id;
 IF c.id IS NULL OR c.stage_no<>15 THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crisis-act:'||r.id::text,0));

 -- Role availability and official legal competence are checked on the server.
 IF private.can_create_formal_subject(r.game_id,r.user_id,'president') THEN
  v_subject:='president';v_doc_type:='president_decree';
  v_subject_label:='Президент Российской Федерации';
 ELSIF private.can_create_formal_subject(r.game_id,r.user_id,'ministry') THEN
  v_subject:='ministry';v_doc_type:='ministry_order';
  v_subject_label:='Федеральное министерство Российской Федерации';
 ELSIF private.can_create_formal_subject(r.game_id,r.user_id,'government') THEN
  v_subject:='government';v_doc_type:='government_resolution';
  v_subject_label:='Правительство Российской Федерации';
 ELSIF private.can_create_formal_subject(r.game_id,r.user_id,'municipality') THEN
  v_subject:='municipality';v_doc_type:='municipal_act';
  v_subject_label:='Орган местного самоуправления';
 ELSE
  RETURN NULL;
 END IF;
 v_body:=v_subject_label||E'\n\nПРОЕКТ ПРАВОВОГО АКТА'
  ||E'\n\nО мерах по реагированию на кризис: '||c.crisis_type
  ||E'\n\nОснование: '||c.description
  ||E'\n\nПредлагаемые меры:\n'||r.action_plan
  ||E'\n\nПравовое обоснование:\n'||coalesce(nullif(btrim(r.legal_basis),''),'Подлежит уточнению')
  ||E'\n\nНеобходимые ресурсы:\n'||coalesce(nullif(btrim(r.resources),''),'Подлежат уточнению');
 IF nullif(btrim(r.public_message),'') IS NOT NULL THEN
  v_body:=v_body||E'\n\nИнформирование населения:\n'||r.public_message;
 END IF;
 v_steps:=private.formal_workflow(v_doc_type);
 IF v_steps IS NULL OR jsonb_array_length(v_steps)<2 THEN
  RAISE EXCEPTION 'Не определён маршрут правового акта для компетентного органа';
 END IF;
 INSERT INTO public.formal_documents(game_id,stage_no,registry_no,title,
 doc_type,subject_key,subject_label,author_id,body_text,workflow_key,
 workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
 VALUES(r.game_id,15,'ИГРА-КР-'||lpad(nextval('public.formal_registry_seq')::text,5,'0'),
  'О мерах реагирования на кризис: '||c.crisis_type,v_doc_type,
  v_subject,v_subject_label,r.user_id,v_body,v_doc_type,
  v_steps,0,'draft','Проект по проверенному кризисному ответу','author',
  jsonb_build_object(
    'document_kind','crisis_response_act','template_key','crisis_act',
    'source_crisis_id',c.id::text,
    'source_crisis_response_id',r.id::text,
    'source_reviewed_by',r.reviewed_by::text,
    'source_type','crisis_responses','auto_generated',true))
 ON CONFLICT DO NOTHING RETURNING id INTO v_doc;
 IF v_doc IS NOT NULL THEN
  INSERT INTO public.formal_document_history(document_id,game_id,actor_id,
   action,to_status,to_owner,note)
  VALUES(v_doc,r.game_id,NULL,'Подготовлен проект по проверенному ответу',
   'draft','author',
   'Документ содержит предложения компетентного должностного лица. Проверка ответа преподавателем не означает принятия, подписания или публикации акта.');
 END IF;
 RETURN v_doc;
END;$sync$;
REVOKE ALL ON FUNCTION private.sync_reviewed_crisis_legal_act(uuid)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.reviewed_crisis_act_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $trigger$
BEGIN
 IF NEW.status='reviewed' AND NEW.reviewed_by IS NOT NULL
 AND (OLD.status IS DISTINCT FROM NEW.status
      OR OLD.reviewed_by IS DISTINCT FROM NEW.reviewed_by)
 THEN PERFORM private.sync_reviewed_crisis_legal_act(NEW.id); END IF;
 RETURN NEW;
END;$trigger$;
REVOKE ALL ON FUNCTION private.reviewed_crisis_act_trigger()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zzz_reviewed_crisis_legal_act ON public.crisis_responses;
CREATE TRIGGER zzz_reviewed_crisis_legal_act
AFTER UPDATE OF status,reviewed_by ON public.crisis_responses
FOR EACH ROW EXECUTE FUNCTION private.reviewed_crisis_act_trigger();

CREATE OR REPLACE FUNCTION private.guard_crisis_legal_act_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $guard$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.metadata->>'document_kind'='crisis_response_act'
    AND auth.uid() IS NOT NULL AND pg_trigger_depth()<=1
  THEN RAISE EXCEPTION 'Правовой акт по кризису создаётся только из проверенного ответа'
    USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF coalesce(OLD.metadata->>'document_kind','')='crisis_response_act'
  OR coalesce(NEW.metadata->>'document_kind','')='crisis_response_act' THEN
  IF OLD.game_id IS DISTINCT FROM NEW.game_id
    OR OLD.stage_no IS DISTINCT FROM NEW.stage_no
    OR OLD.doc_type IS DISTINCT FROM NEW.doc_type
    OR OLD.subject_key IS DISTINCT FROM NEW.subject_key
    OR OLD.author_id IS DISTINCT FROM NEW.author_id
    OR OLD.metadata->>'document_kind' IS DISTINCT FROM NEW.metadata->>'document_kind'
    OR OLD.metadata->>'source_crisis_id' IS DISTINCT FROM NEW.metadata->>'source_crisis_id'
    OR OLD.metadata->>'source_crisis_response_id' IS DISTINCT FROM NEW.metadata->>'source_crisis_response_id'
  THEN RAISE EXCEPTION 'Нельзя подменить подтверждённый источник кризисного акта'
    USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END;$guard$;
REVOKE ALL ON FUNCTION private.guard_crisis_legal_act_origin()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_crisis_legal_act_origin ON public.formal_documents;
CREATE TRIGGER guard_crisis_legal_act_origin
BEFORE INSERT OR UPDATE ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.guard_crisis_legal_act_origin();

DO $backfill$
DECLARE item record;
BEGIN
 FOR item IN SELECT response.id FROM public.crisis_responses response
 JOIN public.game_crises crisis ON crisis.id=response.crisis_id
   AND crisis.game_id=response.game_id
 WHERE response.status='reviewed' AND response.reviewed_by IS NOT NULL
   AND crisis.stage_no=15
 LOOP
  PERFORM private.sync_reviewed_crisis_legal_act(item.id);
 END LOOP;
END;$backfill$;
