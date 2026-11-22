-- Lawfulness: at below 30%, automatic teacher-moderated SF rejection for FZ,
-- or blocked SF approval for FKZ. FZ override requires 2/3 of all Duma mandates.
-- At recovered 30%+, pending automatic rejection is lifted atomically.
-- Existing 40% region control penalty is read-only and has no persistence here.
CREATE OR REPLACE FUNCTION private.formal_vote_required(p_document formal_documents)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 select (p_document.workflow_key='bill' AND p_document.metadata->>'cutoff_price_proposal'='true'
 and p_document.status_code IN ('government','sf')) OR p_document.status_code in ('president_veto','sf_veto','sf_fkz_blocked')
 or (p_document.workflow_key in ('bill','budget') and p_document.status_code in ('reading1','reading2','reading3'))
 or (p_document.workflow_key in ('government_act','gd_resolution','sf_resolution') and p_document.status_code='agenda')
 or (p_document.workflow_key='municipal_act' and p_document.status_code='meeting')
 or (p_document.doc_type='federal_budget' and p_document.workflow_key='budget'
  and (p_document.status_code='government' or p_document.status_code='revision' and p_document.current_owner_key='government' and p_document.current_step=1));
$function$;

-- The gate is enforced inside PostgreSQL, not by hiding a client button.
-- Extra index-free lookups run only on legal-status changes, not on reads.
create or replace function private.lawfulness_sf_document_gate()
returns trigger language plpgsql security definer set search_path to ''
as $function$
declare v_law numeric;
begin
 if new.workflow_key not in ('bill','budget')
    or new.doc_type not in ('fz_bill','fkz_bill','federal_budget')
    or new.status_code is not distinct from old.status_code
    or old.status_code not in ('reading3','sf','sf_veto','sf_fkz_blocked') then
  return new;
 end if;
 select value into v_law from public.state_metrics
 where game_id=new.game_id and metric_key='lawfulness';

 if old.status_code in ('reading3','sf') and new.status_code in ('sf','president')
    and coalesce(v_law,100)<30 then
  new.current_step:=case when old.status_code='reading3' then old.current_step+1 else old.current_step end;
  new.status_code:=case when new.doc_type='fkz_bill' then 'sf_fkz_blocked' else 'sf_veto' end;
  new.status_label:=case when new.doc_type='fkz_bill'
   then 'Совет Федерации не одобрил ФКЗ: правовая устойчивость ниже 30%'
   else 'Совет Федерации отклонил ФЗ: требуется 2/3 голосов Государственной Думы' end;
  new.current_owner_key:=case when new.doc_type='fkz_bill' then 'sf' else 'gd_council' end;
  return new;
 end if;

 if old.status_code='sf_fkz_blocked'
    and new.status_code not in ('sf_fkz_blocked','rejected','revision','withdrawn','superseded')
    and coalesce(v_law,100)<30 then
  raise exception 'ФКЗ не может быть принят без необходимого одобрения Совета Федерации; преодоление вето одной Государственной Думой неприменимо.'
    using errcode='42501';
 end if;

 if old.status_code='sf_veto' and new.status_code not in
    ('sf_veto','rejected','revision','withdrawn','superseded')
    and coalesce(v_law,100)<30 then
  if not exists (
    select 1 from public.game_votes v
    where v.game_id=new.game_id and v.formal_document_id=new.id
      and v.formal_step_code='sf_veto'
      and v.procedure_key='sf_veto_override' and v.institution_key='gd'
      and v.status='closed' and v.result_code='passed' and v.result_quorum_met
      and v.result_eligible>0
      and v.result_yes>=ceil(v.result_eligible*2/3)
  ) then
   raise exception 'Требуется повторное принятие ФЗ не менее чем 2/3 голосов от общего числа депутатов Государственной Думы.'
     using errcode='42501';
  end if;
 end if;
 return new;
end;
$function$;

drop trigger if exists lawfulness_sf_document_gate on public.formal_documents;
create trigger lawfulness_sf_document_gate
before update of status_code on public.formal_documents
for each row
execute function private.lawfulness_sf_document_gate();

-- React only when legal stability crosses the 30% boundary.
-- Changes to every other metric, plus sub-threshold fluctuations, cost no trigger work.
create or replace function private.lawfulness_sf_threshold_reconcile()
returns trigger language plpgsql security definer set search_path to ''
as $function$
declare d public.formal_documents%rowtype; v_step jsonb;
begin
 if old.value>=30 and new.value<30 then
  for d in select * from public.formal_documents
    where game_id=new.game_id and status_code='sf'
      and doc_type in ('fz_bill','fkz_bill','federal_budget')
      and workflow_key in ('bill','budget') for update
  loop
   update public.game_votes set status='closed',closed_at=now(),
      result_code='superseded',result_label='Рассмотрение заменено автоматическим решением Совета Федерации'
   where formal_document_id=d.id and formal_step_code='sf' and status='open';
   update public.formal_documents
   set status_code=case when d.doc_type='fkz_bill' then 'sf_fkz_blocked' else 'sf_veto' end,
       status_label=case when d.doc_type='fkz_bill'
        then 'Совет Федерации не одобрил ФКЗ: правовая устойчивость ниже 30%'
        else 'Совет Федерации отклонил ФЗ: требуется 2/3 голосов Государственной Думы' end,
       current_owner_key=case when d.doc_type='fkz_bill' then 'sf' else 'gd_council' end,updated_at=now()
   where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,
       from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,null,'Автоматическое решение Совета Федерации при падении правовой устойчивости',
      d.status_code,case when d.doc_type='fkz_bill' then 'sf_fkz_blocked' else 'sf_veto' end,
      d.current_owner_key,case when d.doc_type='fkz_bill' then 'sf' else 'gd_council' end,
      'Правовая устойчивость снизилась ниже 30%; действие является игровым условием');
  end loop;
 elsif old.value<30 and new.value>=30 then
  for d in select * from public.formal_documents
    where game_id=new.game_id and status_code in ('sf_veto','sf_fkz_blocked')
      and doc_type in ('fz_bill','fkz_bill','federal_budget')
      and workflow_key in ('bill','budget') for update
  loop
   v_step:=d.workflow_steps->(d.current_step+1);
   if v_step->>'code' is distinct from 'president' then continue; end if;
   update public.game_votes set status='closed',closed_at=now(),
      result_code='superseded',result_label='Автоматическое отклонение снято после восстановления правовой устойчивости'
   where formal_document_id=d.id and formal_step_code=d.status_code and status='open';
   update public.formal_documents
   set current_step=d.current_step+1,status_code=v_step->>'code',
       status_label=v_step->>'label',current_owner_key=v_step->>'owner',updated_at=now()
   where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,
       from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,null,'Автоматическое отклонение Совета Федерации снято после восстановления правовой устойчивости',
      d.status_code,v_step->>'code',d.current_owner_key,v_step->>'owner',
      'Правовая устойчивость восстановлена до 30% или выше; действие является игровым условием');
  end loop;
 end if;
 return new;
end;
$function$;

drop trigger if exists lawfulness_sf_threshold_reconcile on public.state_metrics;
create trigger lawfulness_sf_threshold_reconcile
after update of value on public.state_metrics
for each row
when (old.metric_key='lawfulness' and
    ((old.value>=30 and new.value<30) or (old.value<30 and new.value>=30)))
execute function private.lawfulness_sf_threshold_reconcile();

CREATE OR REPLACE FUNCTION private.apply_formal_vote_transition(p_document uuid, p_transition text, p_actor uuid, p_vote uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 d public.formal_documents%rowtype;
 v_step jsonb;
 v_next integer;
 v_action text;
begin
 if p_document is null or p_transition='none' then return; end if;
 select * into d from public.formal_documents where id=p_document for update;
 if d.id is null then return; end if;
 if d.status_code IN ('rejected','superseded','withdrawn','published') THEN RETURN; END IF;
 if not exists(select 1 from public.game_votes where id=p_vote and formal_document_id=d.id and formal_step_code=d.status_code) then
  update public.game_votes set decision_note=concat_ws(' · ',decision_note,'Стадия документа изменилась; результат сохранён без перехода') where id=p_vote;
  return;
 end if;

 if p_transition='advance' then
   if d.workflow_key='bill' and d.status_code='reading3'
   and coalesce(d.metadata->>'cutoff_price_proposal','false')<>'true' then
     v_next:=d.current_step+2;
     v_step:=d.workflow_steps->v_next;
     update public.formal_documents
       set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
           current_owner_key=v_step->>'owner',updated_at=now()
     where id=d.id;
     v_action:=case
       when (select status_code from public.formal_documents where id=d.id)='sf_veto'
         then 'Закон принят ГД; Совет Федерации автоматически отклонил ФЗ из-за снижения правовой устойчивости'
       when (select status_code from public.formal_documents where id=d.id)='sf_fkz_blocked'
         then 'ФКЗ принят ГД; Совет Федерации автоматически не одобрил ФКЗ из-за снижения правовой устойчивости'
       else 'Закон принят ГД; Совет Федерации автоматически одобрил его по правилам игры; направлен Президенту'
     end;
   else
     v_next:=d.current_step+1;
     if v_next>=jsonb_array_length(d.workflow_steps) then return; end if;
     v_step:=d.workflow_steps->v_next;
     update public.formal_documents
       set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
           current_owner_key=v_step->>'owner',updated_at=now()
     where id=d.id;
     v_action:=case
       when d.status_code='reading3' and (select status_code from public.formal_documents where id=d.id)='sf_veto'
         then 'Совет Федерации автоматически отклонил ФЗ из-за снижения правовой устойчивости'
       when d.status_code='reading3' and (select status_code from public.formal_documents where id=d.id)='sf_fkz_blocked'
         then 'Совет Федерации автоматически не одобрил ФКЗ из-за снижения правовой устойчивости'
       else 'Документ продвинут по результатам голосования'
     end;
   end if;
 elsif p_transition='reject' then
   update public.formal_documents
     set status_code='rejected',status_label='Отклонён голосованием',current_owner_key='system',updated_at=now()
   where id=d.id;
   v_action:='Документ отклонён голосованием';
 elsif p_transition='return_author' then
   v_step:=d.workflow_steps->0;
   update public.formal_documents
     set current_step=0,status_code='revision',status_label='Возвращён автору по результатам голосования',
         current_owner_key='author',updated_at=now()
   where id=d.id;
   v_action:='Документ возвращён автору по результатам голосования';
 elsif p_transition='return_previous' then
   v_next:=greatest(0,d.current_step-1);
   v_step:=d.workflow_steps->v_next;
   update public.formal_documents
     set current_step=v_next,status_code='revision',status_label='Возвращён на предыдущую стадию',
         current_owner_key=v_step->>'owner',updated_at=now()
   where id=d.id;
   v_action:='Документ возвращён на предыдущую стадию по результатам голосования';
 else
   return;
 end if;

 insert into public.formal_document_history(
  document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note
 )
 select d.id,d.game_id,p_actor,v_action,d.status_code,fd.status_code,
        d.current_owner_key,fd.current_owner_key,
        'Голосование '||p_vote::text||coalesce(' · '||nullif(p_note,''),'')
 from public.formal_documents fd where fd.id=d.id;
end;
$function$;
