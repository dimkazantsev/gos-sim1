-- ГОС.ID. Automatic, idempotent session minutes. No polling and no retrospective changes.
-- The platform attests the generated record; it does NOT imitate a personal or qualified e-signature.
CREATE UNIQUE INDEX IF NOT EXISTS formal_automatic_session_minutes_unique
 ON public.formal_documents(game_id, (metadata->>'automatic_session_id'))
 WHERE doc_type='minutes' AND metadata->>'automatic_session_id' IS NOT NULL;

CREATE OR REPLACE FUNCTION private.publish_closed_session_minutes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,private,pg_temp AS $$
DECLARE
 v_id uuid; v_actor uuid; v_steps jsonb; v_text text; v_questions text;
 v_label text; v_subject text; v_workflow text; v_stage integer;
BEGIN
 IF NEW.status<>'closed' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
 -- The original closing RPC is authoritative for the chairman's permissions.
 -- A deferred trigger observes the final carried-over questions in that transaction.
 IF EXISTS(
   SELECT 1 FROM public.formal_documents d WHERE d.game_id=NEW.game_id
    AND d.doc_type='minutes'
    AND d.metadata->>'automatic_session_id'=NEW.id::text
 ) THEN RETURN NEW; END IF;
 v_actor:=coalesce(NEW.chair_user_id,NEW.created_by);
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Не определено ответственное лицо заседания'; END IF;
 v_stage:=NEW.stage_no;
 IF TG_TABLE_NAME='duma_sessions' THEN
  v_subject:='gd'; v_workflow:='gd_resolution';
  v_label:='Государственной Думы Федерального Собрания Российской Федерации';
  SELECT string_agg(
   a.agenda_no::text||'. '||coalesce(d.title,'Документ из реестра НПА')
   ||E'\nРезультат: '||CASE a.status WHEN 'completed' THEN 'Вопрос рассмотрен'
      WHEN 'carried_over' THEN 'Перенесён на следующее заседание'
      WHEN 'withdrawn' THEN 'Снят с рассмотрения'
      ELSE 'Вопрос не завершён' END
   ||CASE WHEN nullif(btrim(coalesce(a.result_note,'')),'') IS NOT NULL
        THEN E'\nРешение: '||a.result_note ELSE '' END
   ||CASE WHEN v.id IS NULL THEN '' ELSE
      E'\nГолосование: за — '||coalesce(v.result_yes,0)::text
      ||', против — '||coalesce(v.result_no,0)::text
      ||', воздержались — '||coalesce(v.result_abstain,0)::text
      ||'. '||CASE WHEN v.result_code IN ('passed','approved','accepted','adopted') THEN 'Решение принято.'
           WHEN v.result_code IN ('failed','rejected','declined') THEN 'Решение не принято.'
           ELSE 'Итог зафиксирован в реестре голосований.' END END,
   E'\n\n' ORDER BY a.agenda_no)
  INTO v_questions
  FROM public.duma_agenda_items a
  LEFT JOIN public.formal_documents d ON d.id=a.formal_document_id AND d.game_id=NEW.game_id
  LEFT JOIN LATERAL (
    SELECT gv.id,gv.result_yes,gv.result_no,gv.result_abstain,gv.result_code
    FROM public.game_votes gv
    WHERE gv.game_id=NEW.game_id AND gv.formal_document_id=a.formal_document_id
     AND gv.status='closed' AND gv.opened_at>=NEW.opened_at
     AND gv.closed_at<=coalesce(NEW.closed_at,now())
    ORDER BY gv.closed_at DESC LIMIT 1
  ) v ON true
  WHERE a.session_id=NEW.id;
 ELSE
  v_subject:='government'; v_workflow:='government_act';
  v_label:='Правительства Российской Федерации';
  SELECT string_agg(
   a.agenda_no::text||'. '||coalesce(p.title,'Государственная программа')
   ||E'\nРезультат: '||CASE a.status WHEN 'completed' THEN 'Рассмотрена'
      WHEN 'withdrawn' THEN 'Снята с рассмотрения'
      ELSE 'Рассмотрение не завершено' END
   ||CASE WHEN nullif(btrim(coalesce(a.result_note,'')),'') IS NOT NULL
        THEN E'\nРешение: '||a.result_note ELSE '' END
   ||CASE WHEN v.id IS NULL THEN '' ELSE
      E'\nГолосование: за — '||coalesce(v.result_yes,0)::text
      ||', против — '||coalesce(v.result_no,0)::text
      ||', воздержались — '||coalesce(v.result_abstain,0)::text
      ||'. '||CASE WHEN v.result_code IN ('passed','approved','accepted','adopted') THEN 'Решение принято.'
           WHEN v.result_code IN ('failed','rejected','declined') THEN 'Решение не принято.'
           ELSE 'Итог зафиксирован в реестре голосований.' END END,
   E'\n\n' ORDER BY a.agenda_no)
  INTO v_questions
  FROM public.government_program_agenda a
  LEFT JOIN public.state_programs p ON p.id=a.program_id AND p.game_id=NEW.game_id
  LEFT JOIN public.game_votes v ON v.id=a.vote_id AND v.game_id=NEW.game_id AND v.status='closed'
  WHERE a.session_id=NEW.id;
 END IF;
 v_text:='ПРОТОКОЛ заседания '||v_label
  ||E'\n' ||coalesce(nullif(btrim(NEW.title),''),'Очередное заседание')
  ||E'\nДата завершения: '||to_char(coalesce(NEW.closed_at,now()) AT TIME ZONE 'Asia/Novosibirsk','DD.MM.YYYY HH24:MI')
  ||E'\n\nПОВЕСТКА И РЕШЕНИЯ\n'
  ||coalesce(nullif(v_questions,''),'Вопросы в повестку не включены.')
  ||E'\n\nДокумент сформирован и удостоверен системой ГОС.ID по сохранённым данным заседания. Личная электронная подпись должностного лица не применялась.';
 v_steps:=private.formal_workflow(v_workflow);
 -- Match the existing protected meeting-document RPC scope, never broaden RLS.
 PERFORM set_config('app.gos_meeting_document_scope',
   concat(NEW.game_id,':',v_stage,':',v_subject,':minutes'),true);
 v_id:=gen_random_uuid();
 INSERT INTO public.formal_documents
  (id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
   body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
 VALUES
  (v_id,NEW.game_id,v_stage,'ИГРА-ПР-'||lpad(nextval('public.formal_registry_seq')::text,6,'0'),
   'Протокол заседания '||v_label,'minutes',v_subject,v_label,v_actor,
   v_text,v_workflow,v_steps,0,'draft','Протокол подготовлен',v_subject,
   jsonb_build_object('document_kind','institution_meeting_minutes',
    'institution_key',v_subject,'stage_no',v_stage,
    'automatic_session_id',NEW.id::text,'session_no',NEW.session_no,
    'automatic_attestation',true,'signed_name','Система ГОС.ID',
    'signed_role','Автоматическое удостоверение игровой записи','signed_on',now()));
 UPDATE public.formal_documents SET status_code='published',status_label='Протокол опубликован системой ГОС.ID',
  current_owner_key='system',updated_at=now() WHERE id=v_id;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 VALUES(v_id,NEW.game_id,v_actor,'Автоматическое удостоверение и публикация протокола',
        'draft','published',v_subject,'system','Создано один раз при закрытии заседания. Личная подпись не имитируется.');
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.publish_closed_session_minutes() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS a_closed_duma_auto_minutes ON public.duma_sessions;
CREATE CONSTRAINT TRIGGER a_closed_duma_auto_minutes AFTER UPDATE OF status
 ON public.duma_sessions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (NEW.status='closed' AND OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION private.publish_closed_session_minutes();

DROP TRIGGER IF EXISTS a_closed_government_auto_minutes ON public.government_sessions;
CREATE CONSTRAINT TRIGGER a_closed_government_auto_minutes AFTER UPDATE OF status
 ON public.government_sessions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (NEW.status='closed' AND OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION private.publish_closed_session_minutes();
