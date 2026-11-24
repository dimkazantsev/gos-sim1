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

  v_revision:=(new.result_code='revision' or (new.result_code='rejected' and new.tie_breaker_chair)) and new.result_quorum_met and p.signed_at is null;
  PERFORM set_config('app.gos_stage11_program_vote_final_id',p.id::text,true);
  update public.state_programs
  set status=case when new.result_code='passed' and new.result_quorum_met then 'adopted' when new.result_code IN ('no_quorum','no_majority') and p.signed_at is null then 'ready' when v_revision then 'revision' else 'rejected' end,
      government_vote_id=case when v_revision or (new.result_code IN ('no_quorum','no_majority') and p.signed_at is null) then null else p.government_vote_id end,
      pm_revision_reason=case when v_revision then 'Правительство возвратило программу на доработку. '||coalesce(nullif(btrim(new.decision_note),''),'Доработайте программу и повторно направьте на согласование.') else p.pm_revision_reason end,updated_at=now()
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
    v_doc:=gen_random_uuid();
    v_steps:=private.formal_workflow('government_act');
    INSERT INTO public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
    VALUES(v_doc,p.game_id,11,'ГОС.ID-ПП-'||lpad(nextval('public.formal_registry_seq')::text,4,'0'),
      'Об утверждении государственной программы «'||p.title||'»','government_resolution','government','Правительство Российской Федерации',new.created_by,
      'Правительство Российской Федерации постановляет: утвердить государственную программу «'||p.title||'». Ответственный исполнитель: '||p.responsible_ministry||'. Срок реализации: '||coalesce(p.start_date::text,'не указан')||' — '||coalesce(p.end_date::text,'не указан')||'. Общий объём бюджетных ассигнований: '||p.total_budget::text||'.',
      'government_act',v_steps,2,'adopted','Принята — ожидает подписи','government',
      jsonb_build_object('state_program_id',p.id,'government_vote_id',new.id,'auto_generated',true));
    INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
    VALUES(v_doc,p.game_id,null,'Сформировано по итогам голосования','adopted','government','Автоматическое постановление по подтверждённому голосованию '||new.id::text);
    -- A favourable vote creates only the draft resolution.
    -- The published programme and resolution are released together by the PM signature RPC.
  end if;
 end if;
 return new;
end;
$function$;
