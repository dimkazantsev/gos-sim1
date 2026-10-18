-- ГОС.ID: audited election results become traceable draft legal acts.
-- Publication and signature stay inside the existing NPA workflow.
CREATE UNIQUE INDEX IF NOT EXISTS formal_stage4_result_source_uq
ON public.formal_documents(game_id,(metadata->>'source_result_key'))
WHERE metadata->>'document_kind'='stage4_office_result';

CREATE OR REPLACE FUNCTION private.stage4_result_act(
 p_game uuid,p_key text,p_title text,p_body text,p_source uuid[],p_author uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $result$
DECLARE v_doc uuid;v_steps jsonb;
BEGIN
 IF p_author IS NULL OR coalesce(array_length(p_source,1),0)=0 THEN RETURN; END IF;
 v_steps:=private.formal_workflow('gd_resolution');
 INSERT INTO public.formal_documents(
 game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,
 author_id,body_text,workflow_key,workflow_steps,current_step,status_code,
 status_label,current_owner_key,metadata)
 VALUES(p_game,4,'ИГРА-ПГД-'||lpad(nextval('public.formal_registry_seq')::text,5,'0'),
 p_title,'gd_resolution','gd','Государственная Дума Федерального Собрания Российской Федерации',
 p_author,p_body,'gd_resolution',v_steps,2,'adopted','Принято по итогам выборов · ожидает опубликования',
 'gd_staff',jsonb_build_object('document_kind','stage4_office_result',
 'template_key','gd_resolution','source_result_key',p_key,'source_elections',
 to_jsonb(p_source),'auto_generated',true,'source_type','office_elections'))
 ON CONFLICT DO NOTHING RETURNING id INTO v_doc;
 IF v_doc IS NOT NULL THEN
   INSERT INTO public.formal_document_history(document_id,game_id,actor_id,
    action,to_status,to_owner,note)
   VALUES(v_doc,p_game,NULL,'Автоматически оформлено принятое постановление',
     'adopted','gd_staff','Основание: завершённые выборы. Результат принят голосованием; для официального опубликования требуется действие уполномоченного лица, подпись не имитируется.');
 END IF;
END;$result$;
REVOKE ALL ON FUNCTION private.stage4_result_act(uuid,text,text,text,uuid[],uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.sync_stage4_election_acts(p_game uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $sync$
DECLARE v_chair record;v_deputies record;v_committees record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('stage4-acts:'||p_game,0));

 SELECT e.created_by author,e.id election_id,m.full_name winner
 INTO v_chair
 FROM public.office_elections e
 JOIN public.office_candidates c ON c.id=e.winner_candidate_id AND c.election_id=e.id
 JOIN public.game_members m ON m.game_id=e.game_id AND m.user_id=c.user_id
 WHERE e.game_id=p_game AND e.stage_no=4 AND e.office_key='gd_chair'
   AND e.status='finished' AND e.winner_candidate_id IS NOT NULL
 ORDER BY e.closed_at DESC NULLS LAST,e.id LIMIT 1;
 IF v_chair.election_id IS NOT NULL THEN
  PERFORM private.stage4_result_act(p_game,'gd_chair',
    'Об избрании Председателя Государственной Думы',
    'ГОСУДАРСТВЕННАЯ ДУМА ФЕДЕРАЛЬНОГО СОБРАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ'
    || E'\n\nПОСТАНОВЛЕНИЕ\n\nОб избрании Председателя Государственной Думы'
    || E'\n\nНа основании завершённого голосования Государственная Дума постановляет:'
    || E'\n1. Избрать ' || v_chair.winner
    || ' Председателем Государственной Думы Федерального Собрания Российской Федерации.'
    || E'\n2. Оформить и опубликовать принятое решение в установленном порядке.',
    ARRAY[v_chair.election_id],v_chair.author);
 END IF;

 SELECT count(DISTINCT e.office_key) total,
  array_agg(e.id ORDER BY e.office_key) elections,
  min(e.created_by::text)::uuid author,
  string_agg(
   CASE e.office_key WHEN 'gd_deputy_1' THEN 'первым заместителем'
       ELSE 'вторым заместителем' END || ' Председателя Государственной Думы — '||m.full_name,
   E';\n' ORDER BY e.office_key) names
 INTO v_deputies
 FROM public.office_elections e
 JOIN public.office_candidates c ON c.id=e.winner_candidate_id AND c.election_id=e.id
 JOIN public.game_members m ON m.game_id=e.game_id AND m.user_id=c.user_id
 WHERE e.game_id=p_game AND e.stage_no=4
   AND e.office_key IN ('gd_deputy_1','gd_deputy_2') AND e.status='finished';
 IF v_deputies.total=2 THEN
  PERFORM private.stage4_result_act(p_game,'gd_deputies',
   'Об избрании заместителей Председателя Государственной Думы',
   'ГОСУДАРСТВЕННАЯ ДУМА ФЕДЕРАЛЬНОГО СОБРАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ'
   || E'\n\nПОСТАНОВЛЕНИЕ\n\nОб избрании заместителей Председателя Государственной Думы'
   || E'\n\nПо итогам завершённых голосований Государственная Дума постановляет:'
   || E'\n1. Избрать следующих заместителей Председателя Государственной Думы:\n'
   || v_deputies.names
   || E'.\n2. Оформить и опубликовать принятое решение в установленном порядке.',
   v_deputies.elections,v_deputies.author);
 END IF;

 SELECT count(*) total,
  array_agg(e.id ORDER BY u.title) elections,
  min(e.created_by::text)::uuid author,
  string_agg(u.title||' — '||m.full_name,E';\n' ORDER BY u.title) names
 INTO v_committees
 FROM public.institution_units u
 JOIN public.office_elections e ON e.game_id=u.game_id AND e.stage_no=4
   AND e.office_key='committee:'||u.id::text AND e.status='finished'
 JOIN public.office_candidates c ON c.id=e.winner_candidate_id
   AND c.election_id=e.id AND c.user_id=u.head_user_id
 JOIN public.game_members m ON m.game_id=e.game_id AND m.user_id=c.user_id
 WHERE u.game_id=p_game AND u.unit_kind='committee';
 IF v_committees.total=5 AND
  (SELECT count(*) FROM public.institution_units u
   WHERE u.game_id=p_game AND u.unit_kind='committee')=5 THEN
  PERFORM private.stage4_result_act(p_game,'gd_committees',
   'Об избрании председателей комитетов Государственной Думы',
   'ГОСУДАРСТВЕННАЯ ДУМА ФЕДЕРАЛЬНОГО СОБРАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ'
   || E'\n\nПОСТАНОВЛЕНИЕ\n\nОб избрании председателей комитетов'
   || E'\n\nПо итогам избрания руководства пяти комитетов Государственная Дума постановляет:'
   || E'\n1. Утвердить результаты избрания председателей комитетов:\n'
   || v_committees.names
   || E'.\n2. Оформить и опубликовать принятое решение в установленном порядке.',
   v_committees.elections,v_committees.author);
 END IF;
END;$sync$;
REVOKE ALL ON FUNCTION private.sync_stage4_election_acts(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.stage4_election_result_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $trigger$
BEGIN
 IF NEW.game_id IS NOT NULL AND NEW.stage_no=4 AND NEW.status='finished'
   AND NEW.winner_candidate_id IS NOT NULL
   AND (OLD.status IS DISTINCT FROM NEW.status OR
        OLD.winner_candidate_id IS DISTINCT FROM NEW.winner_candidate_id)
 THEN PERFORM private.sync_stage4_election_acts(NEW.game_id); END IF;
 RETURN NEW;
END;$trigger$;
REVOKE ALL ON FUNCTION private.stage4_election_result_trigger() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS zzz_sync_stage4_election_results ON public.office_elections;
CREATE TRIGGER zzz_sync_stage4_election_results
AFTER UPDATE OF status,winner_candidate_id ON public.office_elections
FOR EACH ROW EXECUTE FUNCTION private.stage4_election_result_trigger();

-- Existing completed elections are genuine historical sources. Create adopted acts,
-- never forge signatures, rewrite the original results or auto-publish an act.
DO $backfill$
DECLARE rec record;
BEGIN
 FOR rec IN SELECT DISTINCT game_id FROM public.office_elections
   WHERE stage_no=4 AND status='finished' AND winner_candidate_id IS NOT NULL LOOP
   PERFORM private.sync_stage4_election_acts(rec.game_id);
 END LOOP;
END;$backfill$;
