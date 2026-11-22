-- Block unauthorized disclosure of a budget document ID by the
-- idempotent scenario-to-document path. Reuse exactly the existing
-- teacher/government/finance authorization predicate, just before all returns.
-- Remove the redundant private.game_role() call (unused prior to this patch).
-- No changes to document creation, finance calculations, roles, web requests,
-- subscriptions, database tables, RLS, or existing documents.
CREATE OR REPLACE FUNCTION public.create_budget_document_from_scenario(p_scenario_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.budget_scenarios%rowtype;v_uid uuid:=(select auth.uid());v_doc uuid;v_body text;v_programs text;
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Budget scenario not found'; end if;
 -- Check existing authorizations BEFORE returning an already-linked document.
 -- The same check also governs creation of a new document.
 if not private.is_game_teacher(s.game_id)
    and not private.has_effective_role_like(s.game_id,v_uid,ARRAY['%председател%правительств%','%министр%финанс%','%правительств%'])
 then raise exception 'Government / Finance Ministry access required'; end if;
 if s.status<>'final' then raise exception 'Finalize the budget scenario first'; end if;
 if s.formal_document_id is not null then return s.formal_document_id; end if;

 select string_agg('• '||p.title||': '||a.amount::text, E'\n' order by p.title)
 into v_programs
 from public.budget_program_allocations a
 join public.state_programs p on p.id=a.program_id
 where a.scenario_id=s.id;

 v_body:=
   'Проект федерального бюджета на '||s.budget_year||' год.'||E'\n\n'||
   'Макроэкономический сценарий: '||s.title||E'\n'||
   'ВВП: '||s.gdp||E'\n'||
   'Доходы: '||s.revenue||E'\n'||
   'Расходы: '||s.expenditure||E'\n'||
   'Баланс: '||s.balance||E'\n'||
   case when s.deficit_pct_gdp is not null then 'Дефицит к ВВП: '||round(s.deficit_pct_gdp,2)||'%'||E'\n' else '' end||
   'Государственный долг на конец периода: '||s.debt_end||
   case when s.debt_pct_gdp is not null then ' ('||round(s.debt_pct_gdp,2)||'% ВВП)' else '' end||E'\n\n'||
   'Финансирование принятых государственных программ:'||E'\n'||
   coalesce(v_programs,'Связанные государственные программы не указаны.')||E'\n\n'||
   'Источник и допущения сценария: '||coalesce(s.source_note,'не указаны');

 v_doc:=public.create_formal_document(
   s.game_id,13,'О федеральном бюджете на '||s.budget_year||' год','federal_budget',
   'government','Правительство Российской Федерации',v_body,null,null,null,'budget',
   jsonb_build_object('budget_scenario_id',s.id,'budget_year',s.budget_year)
 );

 update public.budget_scenarios set formal_document_id=v_doc,updated_at=now(),updated_by=v_uid where id=s.id;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,13,'Федеральный бюджет','notice','Проект федерального бюджета внесён в реестр НПА',
        'На основе зафиксированного сценария '||s.title,v_uid);
 return v_doc;
end;$function$
;
