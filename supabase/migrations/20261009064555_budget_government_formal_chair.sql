-- Actual primary formal Prime Minister decides tied budget Government votes.
-- Shared public create/close_procedural_vote engines remain unchanged.
create function private.calculate_budget_government_result(v public.game_votes) returns jsonb
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare d formal_documents%rowtype;eligible numeric;present numeric;casted numeric;y numeric;n numeric;a numeric;needed numeric;q boolean;pass boolean;chair text;result text;label text;
begin
 select * into d from formal_documents where id=v.formal_document_id and game_id=v.game_id;
 if d.id is null or d.doc_type<>'federal_budget' or d.workflow_key<>'budget'
  or not(d.status_code='government' or d.status_code='revision' and d.current_owner_key='government' and d.current_step=1)
  or v.formal_step_code is distinct from d.status_code or v.procedure_key is distinct from 'budget_government_submission'
  or v.institution_key is distinct from 'government' or v.voting_mode is distinct from 'member'
  or nullif(trim(coalesce(v.group_name,'')),'') is not null or v.quorum_kind is distinct from 'fraction' or v.quorum_value is distinct from .5
  or v.majority_kind is distinct from 'present_majority' or v.majority_value is distinct from .5
  or v.allow_abstain is distinct from true or v.tie_breaker_chair is distinct from true
  or v.pass_transition is distinct from 'advance' or v.fail_transition is distinct from 'return_author' then
  raise exception 'Закрытие относится только к установленному коллегиальному внесению федерального бюджета Правительством.';
 end if;
 eligible:=private.vote_total_eligible_weight(v);present:=private.vote_present_weight(v);needed:=ceil(eligible*.5-0.000001);
 select coalesce(sum(b.weight),0),coalesce(sum(coalesce(b.yes_weight,case when b.choice='yes' then b.weight else 0 end)),0),
  coalesce(sum(coalesce(b.no_weight,case when b.choice='no' then b.weight else 0 end)),0),
  coalesce(sum(coalesce(b.abstain_weight,case when b.choice='abstain' then b.weight else 0 end)),0)
 into casted,y,n,a from game_ballots b where b.vote_id=v.id;
 q:=eligible>0 and present>=needed;
 if not q then pass:=false;result:='no_quorum';label:='Нет кворума';
 else
  pass:=y>present/2;
  if not pass and y=n and y>0 then
   select b.choice into chair from game_ballots b join game_members m on m.game_id=v.game_id and m.user_id=b.voter_id
    where b.vote_id=v.id and m.kind='student' and m.roster_archived_at is null
     and private.vote_eligible_weight(v,b.voter_id)>0
     and exists(select 1 from private.formal_user_roles(v.game_id,b.voter_id) rr
      where rr ~ '^председатель[[:space:]]+правительства([[:space:]]|$)')
    order by (b.voter_id=v.created_by) desc,b.created_at,b.voter_id limit 1;
   pass:=coalesce(chair='yes',false);
  end if;
  result:=case when pass then 'passed' else 'rejected' end;label:=case when pass then 'Решение принято' else 'Решение отклонено' end;
 end if;
 return jsonb_build_object('result',result,'label',label,'yes',y,'no',n,'abstain',a,'eligible',eligible,'cast',casted,'present',present,'quorum',q,'needed',needed);
end;$$;
revoke all on function private.calculate_budget_government_result(public.game_votes) from public,anon,authenticated;

create function public.close_budget_government_vote(p_vote_id uuid,p_note text default null) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v game_votes%rowtype;d formal_documents%rowtype;initial_game uuid;result jsonb;uid uuid:=auth.uid();
begin
 select game_id into initial_game from game_votes where id=p_vote_id;
 if initial_game is null then raise exception 'Бюджетное голосование не найдено.';end if;
 perform private.lock_budget_actor(initial_game);
 select * into v from game_votes where id=p_vote_id and game_id=initial_game for update;
 select * into d from formal_documents where id=v.formal_document_id and game_id=v.game_id;
 if uid is null or v.id is null or d.id is null or d.workflow_key<>'budget' or d.doc_type<>'federal_budget'
  or v.procedure_key is distinct from 'budget_government_submission'
  or not(private.is_game_teacher(v.game_id) or exists(select 1 from private.formal_user_roles(v.game_id,uid) rr
   where rr ~ '^председатель[[:space:]]+правительства([[:space:]]|$)')) then raise exception 'Голосование закрывает действующий Председатель Правительства или преподаватель.';end if;
 if v.status<>'open' then return jsonb_build_object('result',v.result_code,'label',v.result_label);end if;
 result:=private.calculate_budget_government_result(v);
 update game_votes set status='closed',closed_at=now(),result_code=result->>'result',result_label=result->>'label',
  result_yes=(result->>'yes')::numeric,result_no=(result->>'no')::numeric,result_abstain=(result->>'abstain')::numeric,
  result_eligible=(result->>'eligible')::numeric,result_cast=(result->>'cast')::numeric,result_present=(result->>'present')::numeric,
  result_quorum_met=(result->>'quorum')::boolean,decision_note=nullif(trim(p_note),'') where id=v.id;
 if (result->>'quorum')::boolean then
  perform private.apply_formal_vote_transition(v.formal_document_id,case when result->>'result'='passed' then v.pass_transition else v.fail_transition end,uid,v.id,p_note);
 end if;
 return result;
end;$$;
revoke all on function public.close_budget_government_vote(uuid,text) from public,anon;
grant execute on function public.close_budget_government_vote(uuid,text) to authenticated;

create function private.guard_budget_government_result() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare expected jsonb;
begin
 if old.procedure_key='budget_government_submission' and old.status='open' and new.status='closed' then
  expected:=private.calculate_budget_government_result(old);
  if new.result_code is distinct from expected->>'result' or new.result_label is distinct from expected->>'label'
   or new.result_quorum_met is distinct from (expected->>'quorum')::boolean
   or new.result_yes is distinct from (expected->>'yes')::numeric or new.result_no is distinct from (expected->>'no')::numeric
   or new.result_abstain is distinct from (expected->>'abstain')::numeric or new.result_eligible is distinct from (expected->>'eligible')::numeric
   or new.result_cast is distinct from (expected->>'cast')::numeric or new.result_present is distinct from (expected->>'present')::numeric
   or new.closed_at is null then raise exception 'Закройте бюджетное заседание через процедуру Правительства: результат учитывает действительного Председателя Правительства.';end if;
 end if;
 return new;
end;$$;
revoke all on function private.guard_budget_government_result() from public,anon,authenticated;
create trigger zz_guard_budget_government_result before update on public.game_votes
 for each row execute function private.guard_budget_government_result();


CREATE OR REPLACE FUNCTION private.can_close_procedural_vote(p_game uuid, p_user uuid, p_institution text, p_formal uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_role text;
  d public.formal_documents%rowtype;
begin
 if p_institution='government' and p_formal is not null then
  select * into d from formal_documents where id=p_formal and game_id=p_game;
  if d.doc_type='federal_budget' and d.workflow_key='budget'
   and (d.status_code='government' or d.status_code='revision' and d.current_owner_key='government' and d.current_step=1) then
   return p_user=auth.uid() and private.active_budget_actor(p_game)
    and (private.is_game_teacher(p_game) or exists(select 1 from private.formal_user_roles(p_game,p_user) rr
     where rr ~ '^председатель[[:space:]]+правительства([[:space:]]|$)'));
  end if;
 end if;
  if private.is_game_teacher(p_game) then return true; end if;

  select coalesce(role_title,'') into v_role
  from public.game_members
  where game_id=p_game and user_id=p_user;

  if p_formal is not null then
    select * into d from public.formal_documents where id=p_formal;
    if d.id is not null
       and private.matches_formal_owner(d.game_id,p_user,d.current_owner_key,d.author_id)
       and (
         (p_institution='gd' and (v_role ilike '%председател%дум%' or v_role ilike '%совет%дум%'))
         or (p_institution='government' and v_role ilike '%председател%правительств%')
         or (p_institution='sf' and v_role ilike '%председател%совет%федерац%')
         or (p_institution='committee' and v_role ilike '%председател%комитет%')
         or (p_institution='municipality' and (v_role ilike '%глава города%' or v_role ilike '%глава%муницип%'))
         or p_institution='all'
       )
    then return true; end if;
  end if;

  return case
    when p_institution='gd' then v_role ilike '%председател%дум%' or v_role ilike '%совет%дум%'
    when p_institution='government' then v_role ilike '%председател%правительств%'
    when p_institution='sf' then v_role ilike '%председател%совет%федерац%'
    when p_institution='committee' then v_role ilike '%председател%комитет%'
    when p_institution='municipality' then v_role ilike '%глава города%' or v_role ilike '%глава%муницип%'
    else false
  end;
end;
$function$;
revoke all on function private.can_close_procedural_vote(uuid,uuid,text,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_budget_simulator_document(p_plan_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare pl budget_simulator_plans%rowtype;c jsonb;body text;l jsonb;pe jsonb;req record;doc uuid;begin
 select * into pl from budget_simulator_plans where id=p_plan_id;
 if pl.id is null or not private.can_prepare_budget(pl.game_id) then raise exception 'Нет права формировать проект бюджета этой игры.';end if;
 perform private.lock_budget_actor(pl.game_id);
 perform pg_advisory_xact_lock(hashtextextended('budget:'||pl.game_id::text,0));select * into pl from budget_simulator_plans where id=p_plan_id for update;
 if pl.document_id is not null then return pl.document_id;end if;
 c:=private.calculate_budget_simulator(pl.game_id,pl.draft);
 if (c->>'funding_gap')::numeric>0 or (c->>'reserve_remaining')::numeric<0 then raise exception 'Покройте дефицит и выдачу бюджетных кредитов допустимыми источниками. Нельзя использовать резерв сверх остатка.';end if;
 if length(trim(coalesce(pl.draft->>'note','')))<30 then raise exception 'Добавьте пояснительную записку с основанием решений: не менее 30 символов.';end if;
 body:=E'РОССИЙСКАЯ ФЕДЕРАЦИЯ\nПРОЕКТ ФЕДЕРАЛЬНОГО ЗАКОНА\nО федеральном бюджете на 2026 год\n\nСтатья 1. Основные характеристики федерального бюджета\n'||
 'Утвердить доходы '||(c->>'revenue')||' млн рублей, расходы '||(c->>'expenditure')||' млн рублей, '||case when (c->>'balance')::numeric<0 then 'дефицит '||(c->>'deficit') else 'профицит '||(c->>'surplus') end||E' млн рублей.\n'||
 'Расчетный государственный внутренний долг на конец года: '||(c->>'internal_debt')||' млн рублей. Внешний долг в рублевом эквиваленте: '||(c->>'external_debt')||E' млн рублей.\n\nСтатья 2. Распределение доходов\n';
 for l in select jsonb_array_elements(c->'income_lines') loop body:=body||(l->>'label')||': '||(l->>'amount')||E' млн рублей.\n';end loop;
 body:=body||'Корректировка округления: '||(c->>'income_rounding')||' млн рублей. Отдельная игровая корректировка доходов: '||(c->>'revenue_adjustment')||E' млн рублей.\n\nСтатья 3. Распределение расходов по разделам\n';
 for l in select jsonb_array_elements(c->'expense_lines') loop body:=body||(l->>'key')||'. '||(l->>'label')||': '||(l->>'amount')||E' млн рублей.\n';end loop;
 body:=body||E'Корректировка округления: −100 млн рублей.\n\nСтатья 4. Источники финансирования дефицита\n'||
 'ОФЗ с постоянным купоном: '||(pl.draft->'financing'->>'ofz_fixed')||' млн рублей; ОФЗ с переменным купоном: '||(pl.draft->'financing'->>'ofz_float')||E' млн рублей.\n'||
 'Кредиты российских кредитных организаций: '||(pl.draft->'financing'->>'bank_credit')||' млн рублей; внешние заимствования: '||(pl.draft->'financing'->>'external')||E' млн рублей.\n'||
 'Резервные средства ФНБ: '||(pl.draft->'financing'->>'reserves')||' млн рублей; приватизация акций: '||(pl.draft->'financing'->>'privatization')||' млн рублей; прочие источники: '||(pl.draft->'financing'->>'other')||E' млн рублей.\n'||
 'Всего источников: '||(c->>'financing')||' млн рублей; потребность с учетом бюджетных кредитов: '||(c->>'funding_need')||E' млн рублей.\n\nСтатья 5. Межбюджетные отношения\n';
 for req in select r.*,f.name from budget_transfer_requests r join fiscal_region_reference f on f.code=r.region_code where r.game_id=pl.game_id and pl.draft->'transfer_ids' ? r.id::text loop
  body:=body||req.name||': '||case req.kind when 'grant' then 'дотация' when 'subsidy' then 'субсидия' when 'subvention' then 'субвенция' else 'бюджетный кредит' end||' '||req.amount||' млн рублей; софинансирование '||req.cofinancing||' млн рублей. '||req.purpose||E'\n';
 end loop;
 body:=body||E'Целевые трансферты включены в профильные разделы, дотации — в раздел 14. Бюджетные кредиты являются возвратным финансированием.\n\nПОЯСНИТЕЛЬНАЯ ЗАПИСКА\n'||(pl.draft->>'note')||E'\n\nИСХОДНЫЕ ДАННЫЕ И ДОПУЩЕНИЯ\nПервоначально утвержденный план 2026 года: Минфин России, «Бюджет для граждан 2026–2028», https://ob.ulminfin.ru/images/brochure/Byudjet_federal/2026f/BDG_2026.pdf. Все суммы — млн рублей. Изменения активности, процентные условия и риски — учебная модель. Налоговые ставки изменяются отдельными НПА.\n\nПолномочия и процедура: БК РФ, статьи 103, 129–133, 192, 199–207; Конституция РФ, статьи 104–107. Подписи и дата фиксируются участниками процедуры в реестре НПА.';
 body:=body||E'\n\nПРИЛОЖЕНИЕ 1. РАСЧЁТ ДОХОДОВ ПО СТАТЬЯМ\n';
 for l in select jsonb_array_elements(c->'income_details') loop
  body:=body||(l->>'label')||': ставка '||(l->>'rate')||case l->>'rate_unit' when 'rubles' then ' рублей за единицу' else ' %' end||', база '||(l->>'base')||case l->>'base_unit' when 'units' then ' единиц' else ' млн рублей' end||', доля федерального бюджета '||((l->>'federal_share')::numeric*100)||' %; доход '||(l->>'amount')||E' млн рублей.\n';
 end loop;
 body:=body||E'Эффективные ставки и распределение внутри доходных групп учебные; НДС и налог на прибыль используют действующие ставки игры. Округление и отдельные корректировки указаны отдельно.\n\nПРИЛОЖЕНИЕ 2. ОБОСНОВАННЫЕ РАСХОДЫ\n';
 for l in select jsonb_array_elements(c->'expense_items') loop
  body:=body||'Раздел '||(l->>'section_key')||'. '||(l->>'title')||'. Показатель: '||(l->>'indicator')||'. Обоснование: '||(l->>'justification')||'. Сумма: '||((l->>'amount')::numeric*1000000)||' рублей.'||case when nullif(l->>'program_id','') is not null then ' Госпрограмма: '||(select title from state_programs where id=(l->>'program_id')::uuid and game_id=pl.game_id)||'; год 2026.' else '' end||E'\n';
 end loop;
 for pe in select jsonb_array_elements(c->'program_expenses') loop
  body:=body||E'\nПОДПИСАННАЯ ГОСПРОГРАММА: '||(pe->>'title')||E'\nПоказатели программы: '||(pe->>'indicators')||E'\n';
  for l in select jsonb_array_elements(pe->'expense_breakdown') loop
   body:=body||(l->>'component_title')||'. '||(l->>'indicator_name')||'. Основание: '||(l->>'justification')||'. 2026 год: '||(l->>'amount')||E' рублей.\n';
  end loop;
 end loop;
 body:=body||E'\nПРИЛОЖЕНИЕ 3. РЕГИОНАЛЬНЫЕ СОБЫТИЯ И ЗАПРОСЫ\n';
 for l in select jsonb_array_elements(c->'transfer_requests') loop
  body:=body||(l->>'region_name')||'. Событие: '||coalesce(l->>'event_title','Запрос предыдущей редакции')||'. Основание: '||(l->>'purpose')||'. Ожидаемый результат: '||coalesce(l->>'expected_result','Указан в обосновании запроса')||'. Федеральная сумма: '||((l->>'amount')::numeric*1000000)||' рублей. Софинансирование: '||((l->>'cofinancing')::numeric*1000000)||E' рублей.\n';
 end loop;
 body:=body||E'\n\nРасчетные приложения закреплены за этим проектом. До первого чтения новая редакция числовых приложений готовится в разделе «Бюджет». После первого чтения перераспределения вносятся через таблицу поправок второго чтения в реестре НПА; выбранный пакет голосуется Государственной Думой и изменяет приложения только после принятия. Редактирование пояснений само по себе не меняет расчётные суммы.';
 for req in select a.*,v.result_yes,v.result_no,v.result_abstain from budget_faction_amendments a left join game_votes v on v.id=a.vote_id where a.plan_id=pl.id and a.status='applied' order by a.applied_revision loop
  body:=body||E'\n\nИСТОРИЯ ПОДГОТОВКИ: ПОПРАВКА '||req.party_name||E'\n'||req.title||'. Перераспределение из раздела '||req.from_section||' в раздел '||req.to_section||': '||req.amount||' млн рублей. Включена в редакцию '||req.applied_revision||E'.\n'||req.reason||E'\nПредварительное голосование: за '||coalesce(req.result_yes,0)||', против '||coalesce(req.result_no,0)||', воздержались '||coalesce(req.result_abstain,0)||' мандатов. Итоговые суммы определяются расчетными приложениями проекта.';
 end loop;
 doc:=public.create_formal_document(pl.game_id,13,pl.title,'federal_budget','government','Правительство Российской Федерации',body,null,null,null,'budget',jsonb_build_object('budget_simulator_plan_id',pl.id,'budget_scenario_id',pl.scenario_id,'budget_base_plan_id',(select last_plan_id from budget_simulator_state where game_id=pl.game_id),'budget_year',2026,'unit','million_rubles','budget_snapshot',c,'budget_draft',pl.draft,'revision',1,'educational_draft',true));
 update formal_documents set metadata=metadata||jsonb_build_object('budget_amendments',
  (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'party_name',a.party_name,'reason',a.reason,'amount',a.amount,'from_section',a.from_section,'to_section',a.to_section,'applied_revision',a.applied_revision,'vote_id',a.vote_id,'yes',v.result_yes,'no',v.result_no,'abstain',v.result_abstain) order by a.applied_revision),'[]'::jsonb) from budget_faction_amendments a left join game_votes v on v.id=a.vote_id where a.plan_id=pl.id and a.status='applied')) where id=doc;
 update budget_simulator_plans set status='document',document_id=doc,calculation=c,updated_at=now() where id=pl.id;
 update budget_scenarios set status='final',formal_document_id=doc,updated_at=now() where id=pl.scenario_id;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(pl.game_id,'document','Сформирован проект закона; экономические изменения ожидают опубликования.',(c->>'expenditure')::numeric,'document:'||doc);
 return doc;
end$function$;
notify pgrst,'reload schema';
