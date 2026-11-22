-- Set short-lived transaction-scoped provenance only around the canonical
-- formal law insert. Subsequent work uses the original signed simulator
-- calculation and existing financial document route without extra queries.
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
 perform set_config('gos.official_budget_plan_creation',pl.id::text,true);
 doc:=public.create_formal_document(pl.game_id,13,pl.title,'federal_budget','government','Правительство Российской Федерации',body,null,null,null,'budget',jsonb_build_object('budget_simulator_plan_id',pl.id,'budget_scenario_id',pl.scenario_id,'budget_base_plan_id',(select last_plan_id from budget_simulator_state where game_id=pl.game_id),'budget_year',2026,'unit','million_rubles','budget_snapshot',c,'budget_draft',pl.draft,'revision',1,'educational_draft',true));
 perform set_config('gos.official_budget_plan_creation','',true);
 update formal_documents set metadata=metadata||jsonb_build_object('budget_amendments',
  (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'party_name',a.party_name,'reason',a.reason,'amount',a.amount,'from_section',a.from_section,'to_section',a.to_section,'applied_revision',a.applied_revision,'vote_id',a.vote_id,'yes',v.result_yes,'no',v.result_no,'abstain',v.result_abstain) order by a.applied_revision),'[]'::jsonb) from budget_faction_amendments a left join game_votes v on v.id=a.vote_id where a.plan_id=pl.id and a.status='applied')) where id=doc;
 update budget_simulator_plans set status='document',document_id=doc,calculation=c,updated_at=now() where id=pl.id;
 update budget_scenarios set status='final',formal_document_id=doc,updated_at=now() where id=pl.scenario_id;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(pl.game_id,'document','Сформирован проект закона; экономические изменения ожидают опубликования.',(c->>'expenditure')::numeric,'document:'||doc);
 return doc;
end$function$;
