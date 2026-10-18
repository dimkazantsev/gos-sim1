-- ГОС.ID: three separate GD decisions are three distinct mandatory acts.
-- Existing generic GD resolutions cannot satisfy all three by accident.

-- Verified act provenance is immutable, even while a legal officer publishes it.
CREATE OR REPLACE FUNCTION private.guard_stage4_act_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $provenance$
BEGIN
 IF COALESCE(OLD.metadata->>'document_kind','')='stage4_office_result'
 OR COALESCE(NEW.metadata->>'document_kind','')='stage4_office_result' THEN
   IF OLD.metadata->>'document_kind' IS DISTINCT FROM NEW.metadata->>'document_kind'
     OR OLD.metadata->>'source_result_key' IS DISTINCT FROM NEW.metadata->>'source_result_key'
     OR OLD.metadata->'source_elections' IS DISTINCT FROM NEW.metadata->'source_elections'
     OR OLD.game_id IS DISTINCT FROM NEW.game_id OR OLD.stage_no IS DISTINCT FROM NEW.stage_no
     OR OLD.doc_type IS DISTINCT FROM NEW.doc_type
     OR OLD.author_id IS DISTINCT FROM NEW.author_id
   THEN RAISE EXCEPTION 'Нельзя изменить источник подтверждённого результата выборов ГД'
     USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END;$provenance$;
REVOKE ALL ON FUNCTION private.guard_stage4_act_provenance() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_stage4_act_provenance ON public.formal_documents;
CREATE TRIGGER guard_stage4_act_provenance BEFORE UPDATE ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.guard_stage4_act_provenance();

CREATE OR REPLACE FUNCTION private.stage4_legal_act_can_finalize(
  p_old public.formal_documents,p_new public.formal_documents,p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $finalize$
 SELECT p_actor IS NOT NULL
 AND p_old.id=p_new.id AND p_old.game_id=p_new.game_id AND p_old.stage_no=4
 AND p_old.doc_type='gd_resolution' AND p_old.subject_key='gd'
 AND p_old.workflow_key='gd_resolution' AND p_old.status_code='adopted'
 AND p_new.status_code IN ('adopted','published')
 AND p_new.doc_type=p_old.doc_type AND p_new.subject_key=p_old.subject_key
 AND p_new.metadata->>'document_kind'='stage4_office_result'
 AND p_old.metadata->>'document_kind'='stage4_office_result'
 AND p_old.metadata->>'source_result_key'=p_new.metadata->>'source_result_key'
 AND p_old.metadata->'source_elections'=p_new.metadata->'source_elections'
 AND private.matches_formal_owner(p_old.game_id,p_actor,p_old.current_owner_key,p_old.author_id);
$finalize$;
REVOKE ALL ON FUNCTION private.stage4_legal_act_can_finalize(public.formal_documents,public.formal_documents,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.stage_required_final_documents(p_game uuid, p_stage integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
WITH policy(stage_no,template_key,label,doc_type,subject_key) AS (
 VALUES
 (2,'minutes','Протокол заседания КСРФ','other','ksrf'),
 (3,'minutes','Протокол заседания КСРФ','other','ksrf'),
 (4,'gd_chair_resolution','Постановление об избрании Председателя Государственной Думы','gd_resolution','gd'),
 (4,'gd_deputies_resolution','Постановление об избрании заместителей Председателя ГД','gd_resolution','gd'),
 (4,'gd_committees_resolution','Постановление об избрании председателей пяти комитетов ГД','gd_resolution','gd'),
 (4,'minutes','Протокол заседания Государственной Думы','other','gd'),
 (5,'gd_resolution','Постановление Государственной Думы','gd_resolution','gd'),
 (5,'minutes','Протокол заседания Государственной Думы','other','gd'),
 (7,'sf_resolution','Постановление Совета Федерации','sf_resolution','sf'),
 (8,'president_decree','Указ Президента Российской Федерации','president_decree','president'),
 (8,'gd_resolution','Постановление Государственной Думы','gd_resolution','gd'),
 (9,'president_decree','Указ Президента о назначении','president_decree','president'),
 (9,'gd_resolution','Постановление Государственной Думы','gd_resolution','gd'),
 (10,'state_program','Государственная программа в реестре','state_program','government'),
 (10,'financial_economic','Финансово-экономическое обоснование','other','government'),
 (11,'minutes','Протокол заседания Правительства','other','government'),
 (14,'municipal_act','Муниципальный правовой акт','municipal_act','municipality'),
 (15,'crisis_act','Правовой акт о реагировании на кризис','any','any')
), matches AS (
 SELECT x.*,
 EXISTS(
 SELECT 1 FROM public.formal_documents d
 WHERE d.game_id=p_game AND d.stage_no=p_stage
   AND (d.status_code='published' OR
       (p_stage=10 AND x.template_key IN ('state_program','financial_economic')
        AND d.status_code IN ('draft','submitted','under_review','review')))
   AND (CASE WHEN x.doc_type='any'
      THEN d.doc_type IN ('president_decree','government_resolution','ministry_order','municipal_act')
      WHEN x.template_key IN ('gd_chair_resolution','gd_deputies_resolution','gd_committees_resolution')
      THEN d.doc_type='gd_resolution' AND d.subject_key='gd'
        AND d.metadata->>'document_kind'='stage4_office_result'
        AND d.metadata->>'source_result_key'=CASE x.template_key
         WHEN 'gd_chair_resolution' THEN 'gd_chair'
         WHEN 'gd_deputies_resolution' THEN 'gd_deputies'
         ELSE 'gd_committees' END
      WHEN x.template_key='minutes'
      THEN ((d.doc_type IN ('meeting_minutes','minutes')
          OR d.metadata->>'template_key'='minutes'
          OR (d.doc_type='other' AND d.title ILIKE 'Протокол заседания%'))
          AND (d.subject_key=x.subject_key OR d.subject_key IS NULL))
      WHEN x.template_key='financial_economic'
      THEN d.metadata->>'template_key'='financial_economic'
      ELSE d.doc_type=x.doc_type AND
        (d.subject_key=x.subject_key OR d.subject_key IS NULL)
   END)
 ) AS fulfilled
 FROM policy x WHERE x.stage_no=p_stage
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'template_key',template_key,'title',label,'subject_key',subject_key,'fulfilled',fulfilled,'evidence_state',case when stage_no=10 then 'prepared' else 'published' end)
 ORDER BY template_key),'[]'::jsonb)
FROM matches;
$function$;

CREATE OR REPLACE FUNCTION private.guard_stage_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_game uuid:=case when tg_op='DELETE' then old.game_id else new.game_id end;
 v_stage integer;
begin
 if auth.uid() is null or private.is_game_teacher(v_game) then
  if tg_op='DELETE' then return old;end if;
  return new;
 end if;
 if tg_table_name='party_documents' or tg_table_name='party_invitations' then
  v_stage:=1;
 elsif tg_table_name='formal_documents' then
  v_stage:=case when tg_op='DELETE' then old.stage_no else new.stage_no end;
 else
  raise exception 'Unsupported stage guard' using errcode='22023';
 end if;
 -- The party dossier must follow a completed chair election. An old
 -- permissive INSERT policy alone cannot enforce this ordering.
 if tg_table_name='party_documents' then
  if tg_op='INSERT' and not exists(
   select 1 from public.game_parties p where p.id=new.party_id
    and p.game_id=v_game and p.leader_user_id is not null
  ) then
   raise exception 'Сначала изберите председателя партии.' using errcode='42501';
  end if;
 end if;
 if not exists(select 1 from public.game_members gm
     where gm.game_id=v_game and gm.user_id=auth.uid() and gm.kind='student'
      and gm.roster_archived_at is null) then
  raise exception 'Student membership required' using errcode='42501';
 end if;
 -- Meeting preparation is separate from stage work. Only an authorized
 -- save_institution_meeting_document RPC sets the transaction-local scope.
 if tg_table_name='formal_documents' and tg_op<>'DELETE' then
  if new.doc_type='meeting_agenda'
     and new.metadata->>'document_kind'='institution_meeting_agenda'
     and current_setting('app.gos_meeting_document_scope',true)
       =concat(new.game_id,':',new.stage_no,':',new.metadata->>'institution_key',':agenda')
  then return new;end if;
  if new.doc_type='minutes'
     and new.metadata->>'document_kind'='institution_meeting_minutes'
     and current_setting('app.gos_meeting_document_scope',true)
       =concat(new.game_id,':',new.stage_no,':',new.metadata->>'institution_key',':minutes')
  then return new;end if;
 end if;
 if tg_table_name='formal_documents' and tg_op<>'DELETE' then
  if (tg_op='INSERT' or (old.game_id=new.game_id and old.stage_no=new.stage_no
   and old.doc_type=new.doc_type and old.subject_key=new.subject_key
   and old.metadata->>'template_key'=new.metadata->>'template_key'))
   and private.can_remediate_stage_final_document(
     new.game_id,new.stage_no,auth.uid(),new.doc_type,new.subject_key,new.metadata) then
   return new;
  end if;
 end if;
  IF tg_table_name='formal_documents' AND tg_op='UPDATE'
      AND private.stage4_legal_act_can_finalize(OLD,NEW,auth.uid()) THEN RETURN NEW; END IF;
  if not exists(select 1 from public.game_stages st
   where st.game_id=v_game and st.stage_no=v_stage and st.status='open'
    and (st.deadline is null or st.deadline>clock_timestamp())) then
  raise exception 'Этап завершён или ещё не открыт. Изменения недоступны.' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end; $function$;

CREATE OR REPLACE FUNCTION private.guard_stage_document_hold_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE uid uuid:=auth.uid();v_game uuid;v_stage integer;
BEGIN
 IF uid IS NULL THEN RETURN new; END IF;
 IF TG_TABLE_NAME='formal_documents' AND TG_OP='UPDATE'
    AND private.stage4_legal_act_can_finalize(OLD,NEW,uid) THEN RETURN NEW; END IF;
 v_game:=new.game_id;v_stage:=new.stage_no;
 IF NOT private.is_game_teacher(v_game)
    AND private.has_prior_stage_document_hold(v_game,uid,v_stage) THEN
    IF TG_TABLE_NAME='formal_documents' AND
       (TG_OP='INSERT' OR (OLD.game_id=NEW.game_id AND OLD.stage_no=NEW.stage_no
          AND OLD.doc_type=NEW.doc_type AND OLD.subject_key=NEW.subject_key
          AND OLD.metadata->>'template_key'=NEW.metadata->>'template_key'))
       AND private.can_remediate_stage_final_document(
         NEW.game_id,NEW.stage_no,uid,NEW.doc_type,NEW.subject_key,NEW.metadata)
    THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Следующий этап недоступен: завершите обязательные итоговые документы предыдущего этапа'
      USING ERRCODE='42501';
 END IF;
 RETURN new;
END;$function$;

-- Preserve existing obligations and add only the newly confirmed requirements.
DO $backfill$ DECLARE g record; BEGIN
 FOR g IN SELECT DISTINCT game_id FROM public.office_elections
   WHERE stage_no=4 AND status='finished'
 LOOP
   PERFORM private.capture_stage_document_obligations(g.game_id,4);
 END LOOP;
END;$backfill$;
