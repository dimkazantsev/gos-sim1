-- Preserve the same document type, terminal status, institution, role, quorum and registration rules.
-- The stage is attribution, not a deadline, for reference votes only.
CREATE OR REPLACE FUNCTION private.guard_stage_bound_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare v_game uuid;v_stage integer;v_vote uuid;v_reference boolean:=false;
begin
 if tg_table_name='game_ballots' then
  v_vote:=new.vote_id;
  select gv.game_id,gv.stage_no,coalesce(gv.formal_step_code='reference' and gv.formal_document_id is not null and gv.procedure_key in ('manual','registered_session') and gv.pass_transition='none' and gv.fail_transition='none' and gv.source_post_id is null,false) into v_game,v_stage,v_reference
   from public.game_votes gv where gv.id=v_vote;
  if v_game is null then raise exception 'Unknown vote' using errcode='23503';end if;
 else
  v_game:=new.game_id;
  v_stage:=new.stage_no;
  if tg_op='UPDATE' and (new.game_id is distinct from old.game_id
    or new.stage_no is distinct from old.stage_no) then
   raise exception 'Cannot move a record between stages' using errcode='42501';
  end if;
 end if;
 if auth.uid() is null or private.is_game_teacher(v_game) then return new;end if;
 if not exists(select 1 from public.game_members m
   where m.game_id=v_game and m.user_id=auth.uid() and m.kind='student'
    and m.roster_archived_at is null) then
  raise exception 'Student membership required' using errcode='42501';
 end if;
 -- Standalone registry reference votes have a historical stage for registration
 -- and reporting only. Their creation, casting and closure do not expire
 -- with that stage. Formal votes and other stage-bound records are unchanged.
 IF TG_TABLE_NAME='game_votes' THEN
  v_reference:=coalesce(NEW.formal_step_code='reference' and NEW.formal_document_id is not null
   and NEW.procedure_key in ('manual','registered_session') and NEW.pass_transition='none'
   and NEW.fail_transition='none' and NEW.source_post_id is null,false);
 END IF;
 IF v_reference THEN
  IF NOT EXISTS(SELECT 1 FROM public.games g WHERE g.id=v_game AND g.status='running') THEN
   RAISE EXCEPTION 'Игра завершена или недоступна' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 -- A global vote without a stage remains governed by its own role and vote RPC.
 if v_stage is null then return new;end if;
 -- Stage 11 editing of Stage 10 programmes is allowed ONLY through
 -- existing validated programme RPCs; do not reopen Stage 10 globally.
 IF tg_table_name='state_programs' AND tg_op='UPDATE' AND v_stage=10 THEN
  IF old.signed_at IS NULL AND new.signed_at IS NULL
    AND old.government_vote_id IS NULL AND new.government_vote_id IS NULL
    AND old.status IN ('draft','revision','minister_review','pm_review','ready')
    AND new.status IN ('draft','revision','minister_review','pm_review','ready')
    AND current_setting('app.gos_stage11_program_edit_id',true)=old.id::text
    AND exists(select 1 from public.game_stages s
      where s.game_id=v_game and s.stage_no=11 and s.status='open')
    AND NOT exists(select 1 from public.government_program_agenda a
      where a.program_id=old.id and a.vote_id is not null and exists(select 1 from public.game_votes gv where gv.id=a.vote_id and gv.status='open'))
  THEN RETURN NEW; END IF;
  IF old.status='adopted' AND old.signed_at IS NULL AND new.signed_at IS NULL
    AND new.status='revision' AND new.government_vote_id IS NULL
    AND current_setting('app.gos_stage11_program_return_id',true)=old.id::text
    AND exists(select 1 from public.game_stages s where s.game_id=v_game and s.stage_no=11 and s.status='open')
    AND exists(select 1 from public.game_votes v where v.id=old.government_vote_id and v.game_id=v_game and v.status='closed' and v.result_code='passed' and v.result_quorum_met)
  THEN RETURN NEW;END IF;
  IF old.status='government_vote' AND old.signed_at IS NULL AND new.signed_at IS NULL
    AND new.status='ready' AND new.government_vote_id IS NULL
    AND current_setting('app.gos_stage11_program_vote_final_id',true)=old.id::text
    AND exists(select 1 from public.game_votes v where v.id=old.government_vote_id and v.game_id=v_game and v.status='closed' and v.result_code IN ('no_quorum','no_majority'))
  THEN RETURN NEW;END IF;
  IF old.status='government_vote' AND old.signed_at IS NULL AND new.signed_at IS NULL
    AND new.status='revision' AND new.government_vote_id IS NULL
    AND current_setting('app.gos_stage11_program_vote_final_id',true)=old.id::text
    AND EXISTS(select 1 from public.game_votes v where v.id=old.government_vote_id
      and v.game_id=v_game and v.stage_no=11 and v.institution_key='government'
      and v.procedure_key='state_program' and v.status='closed'
      and (v.result_code='revision' or (v.result_code='rejected' and v.tie_breaker_chair)) and v.result_quorum_met)
  THEN RETURN NEW; END IF;
  -- Voting lifecycle remains functional while Stage 10 is completed.
  IF old.status='ready' AND new.status='government_vote'
     AND old.government_vote_id IS NULL AND new.government_vote_id IS NOT NULL
     AND current_setting('app.gos_stage11_program_vote_id',true)=old.id::text
     AND exists(select 1 from public.game_votes v
        where v.id=new.government_vote_id and v.game_id=v_game
          and v.stage_no=11 and v.procedure_key='state_program'
          and v.institution_key='government' and v.status='open')
  THEN RETURN NEW; END IF;
  IF old.status='government_vote'
     AND new.status IN ('adopted','rejected')
     AND new.government_vote_id IS NOT DISTINCT FROM old.government_vote_id
     AND current_setting('app.gos_stage11_program_vote_final_id',true)=old.id::text
     AND exists(select 1 from public.game_votes v
        where v.id=old.government_vote_id and v.game_id=v_game
          and v.status='closed' and v.procedure_key='state_program'
          and ( (new.status='adopted' AND v.result_code='passed')
             OR (new.status='rejected' AND v.result_code IS DISTINCT FROM 'passed')))
  THEN RETURN NEW; END IF;
  IF old.status='adopted' AND new.status='adopted'
     AND old.signed_at IS NULL AND new.signed_at IS NOT NULL
     AND new.government_vote_id IS NOT DISTINCT FROM old.government_vote_id
     AND current_setting('app.gos_stage11_program_sign_id',true)=old.id::text
     AND exists(select 1 from public.game_votes v
       where v.id=old.government_vote_id and v.game_id=v_game
         and v.status='closed' and v.result_code='passed'
         and v.result_quorum_met)
  THEN RETURN NEW; END IF;
 END IF;

 if not exists(select 1 from public.game_stages s where s.game_id=v_game
   and s.stage_no=v_stage and s.status='open'
   and (s.deadline is null or s.deadline>clock_timestamp())) then
  raise exception 'Этап завершён или ещё не открыт. Изменения недоступны.' using errcode='42501';
 end if;
 -- Stage 2/3 KSRF actions require BOTH an approved agenda AND personal check-in.
 -- Retain stage-window checks above and teacher administrative override.
 if v_stage in (2,3) then
  if tg_table_name='game_votes' then
   if new.institution_key='ksrf' then
    perform private.require_game_meeting_registration(v_game,auth.uid(),v_stage,'ksrf');
   end if;
  elsif tg_table_name='game_ballots' then
   if exists(select 1 from public.game_votes gv where gv.id=v_vote and gv.institution_key='ksrf') then
    perform private.require_game_meeting_registration(v_game,auth.uid(),v_stage,'ksrf');
   end if;
  end if;
 end if;
 return new;
end; $function$;
CREATE OR REPLACE FUNCTION private.can_reference_vote_document(p_doc formal_documents, p_game uuid, p_stage integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(p_doc.game_id=p_game AND p_doc.doc_type IN
 ('fz_bill','fkz_bill','government_resolution','government_order','president_decree','president_order','gd_resolution','sf_resolution','ministry_order','municipal_act','other','meeting_agenda')
 AND p_doc.status_code NOT IN ('rejected','superseded','withdrawn','president_veto','sf_veto','sf_fkz_blocked')
 AND NOT coalesce(p_doc.metadata ? 'party_id',false)
 AND (p_doc.doc_type<>'meeting_agenda' OR (p_doc.status_code='published' AND p_doc.metadata->>'document_kind' IN ('institution_meeting_agenda','duma_session_agenda','government_session_agenda')))
,false)
$function$;
