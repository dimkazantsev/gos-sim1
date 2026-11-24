-- Budget planning follows a closed, quorate Government vote; signatures remain a separate publication procedure.
-- A negative quorate decision returns an unsigned programme for revision; no-quorum handling is unchanged.
CREATE OR REPLACE FUNCTION private.signed_program_budget_items(p_game uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id','program-'||p.id::text,'program_id',p.id,'budget_year',2027,
 'section_key',case
  when p.responsible_ministry ilike '%внешн%политик%' then '01'
  when p.responsible_ministry ilike '%оборон%' or p.responsible_ministry ilike '%безопасност%' then '03'
  when p.responsible_ministry ilike '%социальн%политик%' then '10'
  when p.responsible_ministry ilike '%экономическ%политик%' or p.responsible_ministry ilike '%внутренн%политик%' then '04'
  else '01' end,
 'title',left(p.title,200),
 'indicator',coalesce(nullif(left((select string_agg(g.indicator_name||case when nullif(g.unit,'') is not null then ' ('||g.unit||')' else '' end,'; ' order by g.created_at,g.id) from public.state_program_goals g where g.program_id=p.id and g.game_id=p_game),500),''),'Показатели утверждённой государственной программы'),
 'justification',left('Финансирование на 2027 год по государственной программе, принятой голосованием Правительства. Ответственный исполнитель: '||p.responsible_ministry,4000),
 'amount',c.amount/1000000::numeric) order by p.id),'[]'::jsonb)
 FROM public.state_program_budget_years c JOIN public.state_programs p ON p.id=c.program_id AND p.game_id=c.game_id
 JOIN public.game_votes v ON v.id=p.government_vote_id AND v.game_id=p.game_id
 WHERE c.game_id=p_game AND c.budget_year=2027 AND c.amount>0
 AND p.status='adopted' AND v.stage_no=11 AND v.institution_key='government' AND v.procedure_key='state_program'
 AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met;
$function$;

CREATE OR REPLACE FUNCTION public.get_signed_state_program_budget(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_items jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджету этой игры';end if;
 v_items:=private.signed_program_budget_items(p_game_id);
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'ministry',p.responsible_ministry,'total_budget',p.total_budget::text,'program_status',p.status,'signed_by',p.signed_by,'signed_at',p.signed_at,'publication_post_id',p.publication_post_id,'budget_expense_item',(select i from jsonb_array_elements(v_items) i where i->>'program_id'=p.id::text),
  'indicators',coalesce((select string_agg(g.indicator_name||case when nullif(g.unit,'') is not null then ' ('||g.unit||')' else '' end,'; ' order by g.created_at,g.id) from state_program_goals g where g.program_id=p.id and g.game_id=p.game_id),''),
  'expense_breakdown',coalesce((select jsonb_agg(jsonb_build_object('indicator_name',e.indicator_name,'justification',e.justification,'amount',e.amount::text,'budget_year',e.budget_year,'component_title',c.title) order by e.position,e.id)
   from state_program_expenses e join state_program_components c on c.id=e.component_id and c.program_id=e.program_id and c.game_id=e.game_id where e.program_id=p.id and e.game_id=p.game_id and e.budget_year=2027),'[]'::jsonb),
  'years',(select jsonb_agg(jsonb_build_object('year',c.budget_year,'amount',c.amount::text,'status','approved') order by c.budget_year) from state_program_budget_years c where c.program_id=p.id and c.game_id=p.game_id)) order by p.signed_at desc nulls first,p.id)
 from state_programs p join game_votes v on v.id=p.government_vote_id and v.game_id=p.game_id where p.game_id=p_game_id and p.status='adopted' and v.stage_no=11 and v.institution_key='government' and v.procedure_key='state_program' and v.status='closed' and v.result_code='passed' and v.result_quorum_met),'[]'::jsonb);
end;$function$;

CREATE OR REPLACE FUNCTION private.guard_budget_law_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 if old.workflow_key<>'budget' or old.doc_type<>'federal_budget' then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then
  if exists(select 1 from games where id=old.game_id) and exists(select 1 from budget_law_amendments where document_id=old.id) then raise exception 'История бюджетных поправок сохраняется до удаления игры.';end if;
  return old;
 end if;
 if exists(select 1 from budget_law_amendments where document_id=old.id and status in ('submitted','voting')) and (
  new.status_code is distinct from old.status_code or new.current_step is distinct from old.current_step or new.current_owner_key is distinct from old.current_owner_key
  or new.workflow_key is distinct from old.workflow_key or new.workflow_steps is distinct from old.workflow_steps or new.doc_type is distinct from old.doc_type or new.game_id is distinct from old.game_id)
  then raise exception 'Сначала рассмотрите или отзовите все поправки ко II чтению бюджета.';end if;
 if exists(select 1 from budget_law_amendment_packs where document_id=old.id and status in ('opening','voting')) and (
  new.body_text is distinct from old.body_text or new.title is distinct from old.title or new.metadata->>'revision' is distinct from old.metadata->>'revision'
  or new.metadata->'budget_snapshot' is distinct from old.metadata->'budget_snapshot' or new.metadata->'budget_draft' is distinct from old.metadata->'budget_draft')
  then raise exception 'Редакция бюджета зафиксирована до завершения голосования по пакету.';end if;
 if old.metadata ? 'budget_first_reading_snapshot' and (
  new.metadata->'budget_snapshot' is distinct from old.metadata->'budget_snapshot' or new.metadata->'budget_draft' is distinct from old.metadata->'budget_draft') and not exists(
   select 1 from budget_law_amendment_packs p where p.document_id=old.id and p.game_id=old.game_id and p.status='accepted'
    and p.source_revision=coalesce((old.metadata->>'revision')::integer,1) and p.source_calculation=old.metadata->'budget_snapshot' and p.source_draft=old.metadata->'budget_draft' and p.source_body_text=coalesce(old.body_text,'')
    and p.result_calculation=new.metadata->'budget_snapshot' and p.result_draft=new.metadata->'budget_draft' and p.result_body_text=new.body_text and coalesce((new.metadata->>'revision')::integer,1)=p.source_revision+1)
  then raise exception 'Числовые приложения после I чтения меняются только принятыми бюджетными поправками.';end if;
 -- Prevent first reading/publication of a stale 2027 programme allocation set.
 if new.status_code is distinct from old.status_code and new.status_code in ('reading1','published')
 and new.metadata->>'budget_year'='2027' and new.metadata ? 'budget_simulator_plan_id'
 and private.budget_program_expense_keys(new.metadata->'budget_snapshot'->'expense_items') is distinct from private.budget_program_expense_keys(private.signed_program_budget_items(new.game_id)) then
 raise exception 'В проекте бюджета не учтены актуальные принятые госпрограммы. Подготовьте обновлённый расчёт.';end if;
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION private.guard_stage_bound_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare v_game uuid;v_stage integer;v_vote uuid;
begin
 if tg_table_name='game_ballots' then
  v_vote:=new.vote_id;
  select gv.game_id,gv.stage_no into v_game,v_stage
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
    AND exists(select 1 from public.game_votes v where v.id=old.government_vote_id and v.game_id=v_game and v.status='closed' and v.result_code='no_quorum')
  THEN RETURN NEW;END IF;
  IF old.status='government_vote' AND old.signed_at IS NULL AND new.signed_at IS NULL
    AND new.status='revision' AND new.government_vote_id IS NULL
    AND current_setting('app.gos_stage11_program_vote_final_id',true)=old.id::text
    AND EXISTS(select 1 from public.game_votes v where v.id=old.government_vote_id
      and v.game_id=v_game and v.stage_no=11 and v.institution_key='government'
      and v.procedure_key='state_program' and v.status='closed'
      and v.result_code='rejected' and v.result_quorum_met)
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

CREATE OR REPLACE FUNCTION private.state_program_vote_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;v_doc uuid;v_steps jsonb;v_revision boolean;
begin
 if new.status='closed' and old.status is distinct from new.status and new.procedure_key='state_program' then
  select * into p from public.state_programs where government_vote_id=new.id for update;
  if p.id is null then return new; end if;

  v_revision:=new.result_code='rejected' and new.result_quorum_met and p.signed_at is null;
  PERFORM set_config('app.gos_stage11_program_vote_final_id',p.id::text,true);
  update public.state_programs
  set status=case when new.result_code='passed' and new.result_quorum_met then 'adopted' when new.result_code='no_quorum' and p.signed_at is null then 'ready' when v_revision then 'revision' else 'rejected' end,
      government_vote_id=case when v_revision or (new.result_code='no_quorum' and p.signed_at is null) then null else p.government_vote_id end,
      pm_revision_reason=case when v_revision then 'Правительство не поддержало программу. '||coalesce(nullif(btrim(new.decision_note),''),'Доработайте программу и повторно направьте на согласование.') else p.pm_revision_reason end,updated_at=now()
  where id=p.id;

  if v_revision then
   update public.government_program_agenda a
   set status='pending',vote_id=null,started_at=null,completed_at=null,qa_closed_at=null,
       result_note=concat_ws(' · ',nullif(a.result_note,''),'Возвращена на доработку; голосование '||new.id::text)
   from public.government_sessions s
   where s.id=a.session_id and s.game_id=p.game_id and s.status<>'closed'
     and a.game_id=p.game_id and a.program_id=p.id and a.vote_id=new.id;
  end if;

  if new.result_code='passed' and new.result_quorum_met
     and not exists(
       select 1 from public.formal_documents
       where game_id=p.game_id and stage_no=11 and doc_type='government_resolution'
         and metadata->>'state_program_id'=p.id::text and metadata->>'government_vote_id'=new.id::text
     )
  then
    v_doc:=public.create_formal_document(
      p.game_id,11,'Об утверждении государственной программы «'||p.title||'»',
      'government_resolution','government','Правительство Российской Федерации',
      'Правительство Российской Федерации постановляет: утвердить государственную программу «'||p.title||
      '». Ответственный исполнитель: '||p.responsible_ministry||
      '. Срок реализации: '||coalesce(p.start_date::text,'не указан')||' — '||coalesce(p.end_date::text,'не указан')||
      '. Общий объём бюджетных ассигнований: '||p.total_budget::text||'.',
      null,null,null,'government_act',
      jsonb_build_object('state_program_id',p.id,'government_vote_id',new.id,'auto_generated',true)
    );
    UPDATE public.formal_documents SET current_step=2,status_code='adopted',status_label='Принята — ожидает подписи',current_owner_key='government',updated_at=now() WHERE id=v_doc;
    -- A favourable vote creates only the draft resolution.
    -- The published programme and resolution are released together by the PM signature RPC.
  end if;
 end if;
 return new;
end;
$function$;
