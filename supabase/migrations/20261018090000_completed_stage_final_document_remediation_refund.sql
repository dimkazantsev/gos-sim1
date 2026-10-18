-- ГОС.ID: pay official final-document debts after stage closure and refund draft point.
-- Keeps role authorization, source-stage scope, prior-stage holds and approved grades intact.
-- Only an authorised official may make up a currently missing, required final act.
-- Completed stages do not reopen their other procedures.
CREATE OR REPLACE FUNCTION private.can_remediate_stage_final_document(
 p_game uuid,p_stage integer,p_user uuid,p_type text,p_subject text,p_metadata jsonb
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $remediation$
 SELECT EXISTS(
  SELECT 1 FROM public.game_stages s
  CROSS JOIN LATERAL jsonb_array_elements(private.stage_required_final_documents(p_game,p_stage)) d
  WHERE s.game_id=p_game AND s.stage_no=p_stage AND s.status='completed'
    AND d->>'template_key'=p_metadata->>'template_key'
    AND NOT coalesce((d->>'fulfilled')::boolean,false)
    AND private.can_create_formal_subject(p_game,p_user,p_subject)
    AND (
      p_subject=d->>'subject_key'
      OR (d->>'template_key'='financial_economic' AND p_stage=10
           AND p_subject IN ('government','ministry'))
      OR (d->>'subject_key'='any' AND p_subject IN ('president','government','ministry','municipality'))
    )
    AND (
      (d->>'template_key'='minutes' AND p_type IN ('other','minutes','meeting_minutes'))
      OR (d->>'template_key'='financial_economic' AND p_type='other')
      OR (d->>'template_key'='crisis_act' AND p_type IN ('president_decree','government_resolution','ministry_order','municipal_act'))
      OR (d->>'template_key'=p_type)
    )
 );
$remediation$;
REVOKE ALL ON FUNCTION private.can_remediate_stage_final_document(uuid,integer,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;

-- Preserve existing meeting registration and party dossier rules unchanged.
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
  if not exists(select 1 from public.game_stages st
   where st.game_id=v_game and st.stage_no=v_stage and st.status='open'
    and (st.deadline is null or st.deadline>clock_timestamp())) then
  raise exception 'Этап завершён или ещё не открыт. Изменения недоступны.' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end; $function$

CREATE OR REPLACE FUNCTION private.guard_stage_document_hold_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE uid uuid:=auth.uid();v_game uuid;v_stage integer;
BEGIN
 IF uid IS NULL THEN RETURN new; END IF;
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
END;$function$

-- Once the *last* missing document is officially registered/published, restore
-- the draft assessment from current evidence. Do not mutate teacher-final grades.
CREATE OR REPLACE FUNCTION private.refresh_grade_after_final_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $refresh$
DECLARE person record;
BEGIN
 IF NEW.status_code <> 'published'
   AND NOT (NEW.stage_no=10 AND NEW.status_code IN ('draft','submitted','under_review','review'))
 THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=NEW.game_id
   AND s.stage_no=NEW.stage_no AND s.status='completed') THEN RETURN NEW; END IF;
 FOR person IN
   SELECT DISTINCT a.user_id
   FROM public.stage_final_document_obligations o
   JOIN public.stage_assessments a
     ON a.game_id=o.game_id AND a.stage_no=o.stage_no AND a.user_id=o.user_id
   WHERE o.game_id=NEW.game_id AND o.stage_no=NEW.stage_no AND a.status='draft'
     AND coalesce((a.evidence_summary->>'final_document_penalty_points')::numeric,0)>0
     AND private.stage_document_penalty_points(NEW.game_id,a.user_id,NEW.stage_no)=0
 LOOP
   PERFORM private.compute_vsn_assessment(NEW.game_id,person.user_id,NEW.stage_no,'manual');
 END LOOP;
 RETURN NEW;
END;$refresh$;
REVOKE ALL ON FUNCTION private.refresh_grade_after_final_document() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS refresh_grade_after_final_document ON public.formal_documents;
CREATE TRIGGER refresh_grade_after_final_document
AFTER INSERT OR UPDATE OF status_code ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.refresh_grade_after_final_document();
