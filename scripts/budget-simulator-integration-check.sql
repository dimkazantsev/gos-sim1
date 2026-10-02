-- Authenticated operations in a temporary classroom, fully rolled back.
begin;
do $$declare g uuid:=gen_random_uuid();t uuid;a uuid:=gen_random_uuid();o uuid:=gen_random_uuid();begin
 select owner_id into t from games where game_code='8.414';if t is null then raise exception 'QA owner missing';end if;
 insert into auth.users(id,aud,role) values(a,'authenticated','authenticated'),(o,'authenticated','authenticated');
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into games(id,title,game_code,owner_id,status,turn_open) values(g,'QA Budget simulator','QA'||substr(replace(g::text,'-',''),1,12),t,'running',true);
 insert into game_members(game_id,user_id,full_name,kind,role_title,group_name) values(g,t,'QA teacher','teacher','Преподаватель','QA'),(g,a,'QA minister','student','Министр финансов','QA'),(g,o,'QA observer','observer','Наблюдатель','QA');
 insert into game_stages(game_id,stage_no,title,mode,summary,status) select g,stage_no,title,mode,summary,case when stage_no=13 then 'open' else 'locked' end from game_stages where game_id=(select id from games where game_code='8.414');
 insert into state_metrics(game_id,metric_key,label,value,unit,is_public,group_key,min_value,max_value,sort_order) select g,metric_key,label,case when metric_key in ('economy','public_trust') then 50 else value end,unit,is_public,group_key,min_value,max_value,sort_order from state_metrics where game_id=(select id from games where game_code='8.414') on conflict(game_id,metric_key) do nothing;
 perform set_config('qa.game',g::text,true);perform set_config('qa.teacher',t::text,true);perform set_config('qa.minister',a::text,true);perform set_config('qa.observer',o::text,true);
end$$;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;r jsonb;bad boolean;d jsonb;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.observer'),true);
 r:=public.get_budget_simulator(g);if (r->>'can_prepare')::boolean then raise exception 'FAIL observer permissions';end if;
 bad:=false;begin perform public.get_budget_simulator(gen_random_uuid());exception when others then bad:=true;end;if not bad then raise exception 'FAIL foreign classroom';end if;
 bad:=false;begin perform public.save_budget_simulator(g,null,'{}',null);exception when others then bad:=true;end;if not bad then raise exception 'FAIL observer write';end if;
 if (select count(*) from budget_simulator_state where game_id<>g)>0 then raise exception 'FAIL RLS';end if;
 if jsonb_array_length(r->'plans')<>0 or jsonb_array_length(r->'contracts')<>0 then raise exception 'FAIL empty classroom';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.minister'),true);
 r:=public.get_budget_simulator(g);if not (r->>'can_prepare')::boolean then raise exception 'FAIL role prepare';end if;
 perform set_config('qa.state',(r->'state')::text,true);
end$$;
reset role;
do $$declare b jsonb;c jsonb;d jsonb;g uuid:=current_setting('qa.game')::uuid;begin
 select data into b from private.budget_baseline where year=2026;
 d:=jsonb_build_object('title','QA бюджет 2026','income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,'revenue_adjustments','{}'::jsonb,'financing',b->'financing','terms','{"ofz_fixed":60,"ofz_float":60,"bank_credit":1,"external":60}'::jsonb,'transfer_ids','[]'::jsonb,'note','Обоснование учебного бюджета с проверкой всех отраслей и источников финансирования.');
 c:=private.calculate_budget_simulator(g,d);
 if (c->>'revenue')::numeric<>40283300 or (c->>'expenditure')::numeric<>44069700 or (c->>'deficit')::numeric<>3786400 or (c->>'funding_gap')::numeric<>0 then raise exception 'FAIL baseline totals %',c;end if;
 if jsonb_array_length(c->'income_lines')<>7 or jsonb_array_length(c->'expense_lines')<>14 then raise exception 'FAIL line counts';end if;
 perform set_config('qa.draft',d::text,true);perform set_config('qa.baseline',c::text,true);
end$$;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;d jsonb:=current_setting('qa.draft')::jsonb;r jsonb;gr uuid;su uuid;cr uuid;bad boolean;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.minister'),true);
 gr:=public.create_budget_transfer_request(g,'05','grant',1000,0,'Выравнивание бюджетной обеспеченности по подтвержденным данным.','14');
 su:=public.create_budget_transfer_request(g,'54','subsidy',1500,200,'Инженерная инфраструктура промышленного кластера с целевыми результатами.','04');
 cr:=public.create_budget_transfer_request(g,'14','budget_credit',500,0,'Покрытие кассового разрыва северного завоза с графиком возврата.','04');
 bad:=false;begin perform public.create_budget_transfer_request(g,'54','subsidy',100,0,'Запрос субсидии без положительного софинансирования.','04');exception when others then bad:=true;end;if not bad then raise exception 'FAIL missing cofinance';end if;
 d:=jsonb_set(d,'{transfer_ids}',jsonb_build_array(gr,su,cr));d:=jsonb_set(d,'{financing,bank_credit}','10000');d:=jsonb_set(d,'{financing,external}','10000');
 r:=public.save_budget_simulator(g,null,d,null);perform set_config('qa.plan',r->>'id',true);perform set_config('qa.draft',d::text,true);perform set_config('qa.grant',gr::text,true);perform set_config('qa.subsidy',su::text,true);perform set_config('qa.credit',cr::text,true);perform set_config('qa.subsidy_expense',(select expenditure::text from game_fiscal_regions where game_id=g and region_code='54'),true);
 if (select internal_debt from budget_simulator_state where game_id=g)<>37436200 then raise exception 'FAIL saving changes debt';end if;
 if exists(select 1 from budget_transfer_requests where game_id=g and status='granted') then raise exception 'FAIL saving disburses transfers';end if;
 bad:=false;begin perform public.save_budget_simulator(g,(r->>'id')::uuid,d,0);exception when others then bad:=true;end;if not bad then raise exception 'FAIL revision conflict';end if;
 bad:=false;begin perform public.save_budget_simulator(g,null,jsonb_set(d,'{financing,bank_credit}','-1'),null);exception when others then bad:=true;end;if not bad then raise exception 'FAIL negative debt source';end if;
 r:=public.save_budget_simulator(g,(r->>'id')::uuid,d,1);if (r->>'revision')::integer<>2 then raise exception 'FAIL revision increment';end if;
 perform set_config('qa.doc',public.create_budget_simulator_document((r->>'id')::uuid)::text,true);
 if public.create_budget_simulator_document((r->>'id')::uuid)::text<>current_setting('qa.doc') then raise exception 'FAIL duplicate document';end if;
 if (select workflow_key from formal_documents where id=current_setting('qa.doc')::uuid)<>'budget' or (select body_text from formal_documents where id=current_setting('qa.doc')::uuid) not like '%Национальная оборона%' then raise exception 'FAIL legal annexes';end if;
 r:=public.get_budget_simulator(g);if r#>>'{state,last_plan_id}' is not null then raise exception 'FAIL draft enacted';end if;
end$$;
reset role;
-- Downstream publication test uses a published NPA fixture, not a fake real-classroom vote.
update formal_documents set status_code='published',status_label='Опубликован' where id=current_setting('qa.doc')::uuid;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;r jsonb;s jsonb;bank uuid;bad boolean;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.minister'),true);
 r:=public.get_budget_simulator(g);s:=r->'state';if s->>'last_plan_id'<>current_setting('qa.plan') then raise exception 'FAIL publication not applied';end if;
 if (s->>'internal_debt')::numeric<>37446200 or (s->>'external_debt')::numeric<>6241900 then raise exception 'FAIL borrowing balances %',s;end if;
 if jsonb_array_length(r->'contracts')<>3 then raise exception 'FAIL contracts';end if;
 if (select count(*) from budget_transfer_requests where game_id=g and status='granted')<>3 then raise exception 'FAIL transfers applied';end if;
 if (select expenditure from game_fiscal_regions where game_id=g and region_code='54')<>current_setting('qa.subsidy_expense')::numeric+1700 then raise exception 'FAIL targeted transfer expense';end if;
 if (select budget_credit_cash from game_fiscal_regions where game_id=g and region_code='14')<>500 then raise exception 'FAIL credit cash accounting';end if;
 perform public.get_budget_simulator(g);if (select version from budget_simulator_state where game_id=g)<>(s->>'version')::integer then raise exception 'FAIL publication replay';end if;
 bad:=false;begin perform public.advance_budget_simulator(g,(s->>'version')::integer);exception when others then bad:=true;end;if not bad then raise exception 'FAIL minister advances period';end if;
 perform public.repay_budget_transfer(current_setting('qa.credit')::uuid);perform public.repay_budget_transfer(current_setting('qa.credit')::uuid);
 if (select budget_credit_cash from game_fiscal_regions where game_id=g and region_code='14')<>0 then raise exception 'FAIL regional credit replay';end if;
end$$;
reset role;
do $$declare g uuid:=current_setting('qa.game')::uuid;bank uuid;begin
 select id into bank from event_cases where game_id=g and case_key='budget-risk-2026-bank_credit';
 insert into event_case_outcomes(game_id,case_id,winner,yes_votes,no_votes,votes_count,assignments_count,trust_delta) values(g,bank,'option_1',1,0,1,1,-2);
end$$;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;r jsonb;v integer;ct uuid;bad boolean;debt numeric;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.teacher'),true);
 r:=public.get_budget_simulator(g);if (r#>>'{state,internal_debt}')::numeric<>37446200 then raise exception 'FAIL bank bankruptcy cancels debt';end if;
 if (r#>>'{state,service_adjustment}')::numeric<>1200 then raise exception 'FAIL risk cost';end if;
 perform public.get_budget_simulator(g);if (select service_adjustment from budget_simulator_state where game_id=g)<>1200 then raise exception 'FAIL outcome replay';end if;
 perform set_config('qa.fixed_rate',(r#>>'{state,financing_rates,ofz_fixed}'),true);
 if current_setting('qa.fixed_rate')::numeric<>16 then raise exception 'FAIL issued fixed quote';end if;
 v:=(select version from budget_simulator_state where game_id=g);perform public.advance_budget_simulator(g,v);
 bad:=false;begin perform public.advance_budget_simulator(g,v);exception when others then bad:=true;end;if not bad then raise exception 'FAIL month replay';end if;
 if (select count(*) from event_assignments a join event_cases c on c.id=a.case_id where a.game_id=g and c.case_key like 'budget-risk-%')<3 then raise exception 'FAIL delayed risks delivered';end if;
 select id into ct from budget_finance_contracts where game_id=g and source_key='bank_credit';
 if (select status from budget_finance_contracts where id=ct)<>'due' then raise exception 'FAIL maturity';end if;
 debt:=(select internal_debt from budget_simulator_state where game_id=g);perform public.repay_budget_finance_contract(ct);perform public.repay_budget_finance_contract(ct);
 if (select internal_debt from budget_simulator_state where game_id=g)<>debt-10000 then raise exception 'FAIL principal accounting';end if;
 if (select count(*) from budget_simulator_ledger where game_id=g and source_key='repay:'||ct)<>1 then raise exception 'FAIL repayment replay';end if;
end$$;
reset role;
-- A second published project prepared against an old budget must not roll back the valid one.
do $$declare g uuid:=current_setting('qa.game')::uuid;p uuid;d uuid;s jsonb;c jsonb;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.teacher'),true);
 s:=current_setting('qa.draft')::jsonb;
 select id into p from budget_simulator_plans where id=current_setting('qa.plan')::uuid;
 select id into d from formal_documents where id=current_setting('qa.doc')::uuid;
 insert into budget_simulator_plans(game_id,title,draft,calculation,status,document_id,scenario_id,created_by) select game_id,'QA stale plan',draft,calculation,'document',document_id,scenario_id,created_by from budget_simulator_plans where id=p returning id into p;
 update formal_documents set metadata=jsonb_set(metadata,'{budget_simulator_plan_id}',to_jsonb(p::text)) where id=d;
 perform public.get_budget_simulator(g);
 if (select last_plan_id from budget_simulator_state where game_id=g)<>current_setting('qa.plan')::uuid then raise exception 'FAIL stale plan rolled back valid budget';end if;
 if (select count(*) from budget_simulator_ledger where game_id=g and kind='publication_blocked')<>1 then raise exception 'FAIL stale plan warning';end if;
 perform public.get_budget_simulator(g);
 if (select count(*) from budget_simulator_ledger where game_id=g and kind='publication_blocked')<>1 then raise exception 'FAIL repeated warnings';end if;
 update game_fiscal_policy set key_rate=24,fx_rate=100 where game_id=g;
 c:=private.calculate_budget_simulator(g,s);
 -- Existing fixed debt retains its coupon despite a new quote; external rates are fixed too.
 if abs((c->>'annual_interest')::numeric-((3980100*16+10000*19+10000*7.5)/100))>.01 then raise exception 'FAIL fixed coupons repriced %',c;end if;
 perform public.advance_budget_simulator(g,(select version from budget_simulator_state where game_id=g));
 if (select amount from budget_simulator_ledger l join budget_finance_contracts c on l.source_key='interest:'||c.id||':2' where c.game_id=g and c.source_key='external')<>round(10000*7.5/1200*((c->>'fx')::numeric/80),2) then raise exception 'FAIL external monthly FX';end if;
end$$;
select jsonb_build_object('baseline_2026','PASS','RLS_scope','PASS','observer_write_blocked','PASS','executive_permissions','PASS','optimistic_revision','PASS','draft_no_economic_mutation','PASS','NPA_annexes','PASS','publication_applied_once','PASS','transfer_and_credit_separation','PASS','regional_repayment_once','PASS','bankruptcy_does_not_cancel_debt','PASS','delayed_events','PASS','maturity_and_principal','PASS','month_idempotence','PASS') checks;
rollback;
