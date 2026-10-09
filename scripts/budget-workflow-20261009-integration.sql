-- Real APIs, RLS, registered Government/Duma votes, and publication in fictional classrooms.
-- No existing user/classroom is referenced. No helper DDL or durable test write occurs.
-- Run after all six Budget workflow migrations; everything rolls back.
-- Recovered after the runtime restart; covers the same 34 scenarios as the cloud run.
begin;
set local statement_timeout='90s';
set local lock_timeout='5s';
do $fixture$
declare g uuid:=gen_random_uuid();foreign_game uuid:=gen_random_uuid();ids jsonb:='{}';name text;u uuid;
 p uuid:=gen_random_uuid();foreign_program uuid:=gen_random_uuid();component uuid:=gen_random_uuid();party uuid:=gen_random_uuid();
begin
 foreach name in array array['teacher','minister','pm','deputy','region','ordinary','observer','archived','outsider','duma_a','duma_b','president'] loop
  u:=gen_random_uuid();insert into auth.users(id,aud,role) values(u,'authenticated','authenticated');ids:=ids||jsonb_build_object(name,u);
 end loop;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 insert into games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA detailed Budget workflow','QA'||substr(replace(g::text,'-',''),1,12),(ids->>'teacher')::uuid,'running',13,true),
 (foreign_game,'QA separate Budget classroom','QA'||substr(replace(foreign_game::text,'-',''),1,12),(ids->>'teacher')::uuid,'running',13,true);
 insert into game_members(game_id,user_id,full_name,kind,role_title,group_name)
 select g,(ids->>v.name)::uuid,'QA '||v.name,v.kind::public.member_kind,v.role_title,v.grp from (values
 ('teacher','teacher','Преподаватель','QA'),('minister','student','Министр финансов','QA'),
 ('pm','student','Участник','One-person group'),('deputy','student','Заместитель Председателя Правительства РФ — Министр экономики','QA'),
 ('region','student','Губернатор Новосибирской области','QA'),('ordinary','student','Участник','QA'),
 ('observer','observer','Министр финансов','QA'),('archived','student','Министр финансов','QA'),
 ('duma_a','student','Депутат Государственной Думы','QA'),('duma_b','student','Депутат Государственной Думы','QA'),
 ('president','student','Президент Российской Федерации','QA'))v(name,kind,role_title,grp);
 insert into game_members(game_id,user_id,full_name,kind,role_title)
 values(foreign_game,(ids->>'teacher')::uuid,'QA foreign teacher','teacher','Преподаватель'),
 (foreign_game,(ids->>'outsider')::uuid,'QA outsider','student','Председатель Правительства Российской Федерации');
 update game_members set roster_archived_at=now() where game_id=g and user_id=(ids->>'archived')::uuid;
 insert into game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 values(g,(ids->>'pm')::uuid,'Председатель Правительства Российской Федерации','active',(ids->>'teacher')::uuid,(ids->>'teacher')::uuid,'QA formal-office primary PM',true);
 insert into game_stages(game_id,stage_no,title,mode,summary,status)
 select gg,n,'QA stage '||n,'Учебная процедура','QA',case when n=13 then 'open' else 'locked' end
 from (values(g),(foreign_game))games(gg),generate_series(1,16)n on conflict(game_id,stage_no) do nothing;
 insert into state_metrics(game_id,metric_key,label,value,unit,is_public,group_key,min_value,max_value,sort_order)
 values(g,'economy','QA economy',50,'%',true,'QA',0,100,1),(g,'public_trust','QA trust',50,'%',true,'QA',0,100,2) on conflict(game_id,metric_key) do nothing;
 insert into game_parties(id,game_id,name,mandates,leader_user_id) values(party,g,'QA Duma',450,(ids->>'duma_a')::uuid);
 update game_members set team='QA Duma' where game_id=g and user_id in ((ids->>'duma_a')::uuid,(ids->>'duma_b')::uuid);

 -- Immutable signed-program fixture, with exact 2026 kopecks and a separate future year.
 insert into state_programs(id,game_id,title,responsible_ministry,responsible_minister_id,created_by,start_date,end_date,total_budget,national_goal,expected_results)
 values(p,g,'QA signed exact-kopeck program','QA ministry',(ids->>'minister')::uuid,(ids->>'minister')::uuid,'2026-01-01','2027-12-31',123456814.15,'QA source national goal','QA signed measurable results');
 insert into state_program_goals(program_id,game_id,goal_text,indicator_name,unit,baseline_value,target_value,target_year)
 values(p,g,'QA source measurable goal','QA APPROVED INDICATOR','units',1,20,2026);
 insert into state_program_components(id,program_id,game_id,direction_no,direction_title,component_kind,title,goal_text,start_date,end_date,budget)
 values(component,p,g,1,'QA source direction','project','QA approved project','QA source goal','2026-01-01','2027-12-31',123456814.15);
 insert into state_program_expenses(program_id,game_id,component_id,indicator_name,justification,budget_year,amount,position,created_by)
 values(p,g,component,'QA approved expense A','QA approved source cost justification A',2026,100000000.01,1,(ids->>'minister')::uuid),
 (p,g,component,'QA approved expense B','QA approved source cost justification B',2026,23456789.11,2,(ids->>'minister')::uuid),
 (p,g,component,'QA FUTURE EXPENSE','QA future-year source cost',2027,25.03,3,(ids->>'minister')::uuid);
 update state_programs set status='adopted',signed_at=now(),signed_by=(ids->>'teacher')::uuid where id=p;
 insert into state_program_budget_commitments(program_id,game_id,budget_year,amount,status,signed_by,signed_at)
 values(p,g,2026,123456789.12,'approved',(ids->>'teacher')::uuid,now()),(p,g,2027,25.03,'approved',(ids->>'teacher')::uuid,now());
 insert into state_programs(id,game_id,title,responsible_ministry,created_by,total_budget,status,signed_at,signed_by)
 values(foreign_program,foreign_game,'QA foreign signed program','QA ministry',(ids->>'teacher')::uuid,123456789.12,'adopted',now(),(ids->>'teacher')::uuid);
 insert into state_program_budget_commitments(program_id,game_id,budget_year,amount,status,signed_by,signed_at)
 values(foreign_program,foreign_game,2026,123456789.12,'approved',(ids->>'teacher')::uuid,now());
 perform set_config('qa.budget.game',g::text,true);perform set_config('qa.budget.foreign_game',foreign_game::text,true);
 perform set_config('qa.budget.users',ids::text,true);perform set_config('qa.budget.program',p::text,true);perform set_config('qa.budget.foreign_program',foreign_program::text,true);perform set_config('qa.budget.party',party::text,true);
 if (select md5(pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and proname='create_procedural_vote')<>'65bb28bb7fd7f0343e99ac7ce0b23e10'
  or (select md5(pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and proname='close_procedural_vote')<>'59534c38fb95055b541c5d45ae508e7d' then raise exception 'FAIL common voting engines changed';end if;
end;$fixture$;

set local role authenticated;
do $read_and_permissions$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;r jsonb;actor text;statement text;rejected boolean;code text;
begin
 perform set_config('request.jwt.claim.sub',ids->>'observer',true);r:=get_budget_simulator(g);
 if (r->>'can_prepare')::boolean or (r->>'can_request')::boolean then raise exception 'FAIL observer permissions';end if;
 perform set_config('request.jwt.claim.sub',ids->>'minister',true);r:=get_budget_simulator(g);
 if not (r->>'can_prepare')::boolean or jsonb_array_length(r->'regional_events')<>16 then raise exception 'FAIL active actor / regional catalog feed';end if;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 if exists(select 1 from event_assignments where game_id=g) or exists(select 1 from fiscal_change_ledger where game_id=g and source_type='event') then raise exception 'FAIL catalog seeding executes events';end if;
 if exists(select 1 from event_cases where game_id=g and jsonb_typeof(comic_scene->'budget_request')='object' and (verified<>false or source_url is not null)) then raise exception 'FAIL authored catalog misrepresented as verified news';end if;
 perform set_config('qa.budget.event',(select id::text from event_cases where game_id=g and case_key='budget-region-2026-54-school-capacity'),true);
 perform set_config('qa.budget.credit_event',(select id::text from event_cases where game_id=g and jsonb_typeof(comic_scene->'budget_request')='object' and comic_scene->>'region_code'<>'54' order by case_key limit 1),true);
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);perform set_student_mandates(current_setting('qa.budget.party')::uuid,jsonb_build_object(ids->>'duma_a',300,ids->>'duma_b',150));
 foreach actor in array array['ordinary','observer','archived','outsider'] loop
  perform set_config('request.jwt.claim.sub',ids->>actor,true);
  rejected:=false;begin perform save_budget_simulator(g,null,'{}',null);exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;rejected:=true;end;
  if not rejected then raise exception 'FAIL inactive/outsider save accepted: %',actor;end if;
 end loop;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 rejected:=false;begin perform get_budget_simulator(gen_random_uuid());exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'FAIL cross-game read';end if;
 if (select count(*) from budget_simulator_state where game_id<>g)>0 then raise exception 'FAIL RLS financial state scope';end if;
end;$read_and_permissions$;
reset role;

do $math_and_validation$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;b jsonb;d jsonb;c jsonb;x jsonb;l jsonb;variant jsonb;bad jsonb;rejected boolean;code text;grp numeric;
begin
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 select data into b from private.budget_baseline where year=2026;
 d:=jsonb_build_object('title','QA Budget law','note','Обоснование учебного бюджета: подписанные программы и региональные события с измеримыми результатами.','income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,'revenue_adjustments','{}'::jsonb,'financing',b->'financing','terms','{"ofz_fixed":60,"ofz_float":60,"bank_credit":12,"external":60}'::jsonb,'transfer_ids','[]'::jsonb,'expense_items','[]'::jsonb);
 c:=private.calculate_budget_simulator(g,d);
 x:=private.calculate_budget_simulator(g,jsonb_set(d,'{base_reallocations}','{"07":-0.00000001,"04":0.00000001}'::jsonb));
 if (x->>'expenditure')::numeric<>(c->>'expenditure')::numeric
  or (select (a->>'amount')::numeric from jsonb_array_elements(x->'expense_lines')a where a->>'key'='07')<>(select (a->>'amount')::numeric from jsonb_array_elements(c->'expense_lines')a where a->>'key'='07')-0.00000001 then raise exception 'FAIL precise balanced base reallocation';end if;
 if (c->>'revenue')::numeric<>40283300 or (c->>'expenditure')::numeric<>44069700 or (c->>'deficit')::numeric<>3786400 or (c->>'funding_gap')::numeric<>0 then raise exception 'FAIL unchanged baseline totals: %',c;end if;
 if jsonb_array_length(c->'income_details')<>12 then raise exception 'FAIL revenue article count';end if;
 for l in select jsonb_array_elements(c->'income_lines') loop
  select sum((a->>'amount')::numeric) into grp from jsonb_array_elements(c->'income_details')a where a->>'group_key'=l->>'key';
  if abs(grp-(l->>'amount')::numeric)>0.00000001 then raise exception 'FAIL split article aggregate %',l;end if;
 end loop;
 for l in select jsonb_array_elements(c->'income_details') loop
  if abs((l->>'base')::numeric*(l->>'rate')::numeric*(l->>'collection')::numeric*(l->>'federal_share')::numeric/case l->>'rate_unit' when 'rubles' then 1000000 else 100 end-(l->>'amount')::numeric)>0.00000001 then raise exception 'FAIL rate × base identity %',l;end if;
 end loop;
 insert into game_fiscal_rates(game_id,region_code,tax_key,rate) values(g,'00','vat',0) on conflict(game_id,region_code,tax_key) do update set rate=excluded.rate;
 x:=private.calculate_budget_simulator(g,d);
 if (select (a->>'amount')::numeric from jsonb_array_elements(x->'income_details')a where a->>'key'='vat')<>0 or (x->>'revenue')::numeric>=(c->>'revenue')::numeric then raise exception 'FAIL live VAT zero';end if;
 update game_fiscal_rates set rate=22 where game_id=g and region_code='00' and tax_key='vat';
 update budget_simulator_state set revenue_adjustment=0.13 where game_id=g;
 x:=private.calculate_budget_simulator(g,jsonb_set(d,'{revenue_adjustments,turnover}','12.34'));
 if abs((select sum((a->>'amount')::numeric) from jsonb_array_elements(x->'income_details')a)+(x->>'income_rounding')::numeric+(x->>'revenue_adjustment')::numeric-(x->>'revenue')::numeric)>0.00000001 then raise exception 'FAIL independent revenue adjustment footer';end if;
 update budget_simulator_state set revenue_adjustment=0 where game_id=g;
 x:=jsonb_build_object('id','gp-2026','section_key','07','title','QA approved program','indicator','CLIENT UNSUPPORTED CLAIM','justification','QA official signed annual appropriation included once','amount',123.45678912,'program_id',current_setting('qa.budget.program'),'budget_year',2026);
 d:=jsonb_set(d,'{expense_items}',jsonb_build_array(x,jsonb_build_object('id','kopeck','section_key','07','title','QA one kopeck','indicator','QA count of service items','justification','QA exact one-kopeck separate appropriation','amount',0.00000001)));
 d:=jsonb_set(d,'{financing,bank_credit}','123.45678912');d:=jsonb_set(d,'{financing,reserves}',to_jsonb((d#>>'{financing,reserves}')::numeric+1000.12345678));
 c:=private.calculate_budget_simulator(g,d);
 if (select (a->>'items_amount')::numeric from jsonb_array_elements(c->'expense_lines')a where a->>'key'='07')<>123.45678913 then raise exception 'FAIL exact GP / one-kopeck appropriation';end if;
 if (c->>'internal_debt')::numeric<>37436200+123.45678912 then raise exception 'FAIL loan principal precision';end if;
 if c#>>'{program_expenses,0,indicators}' not like '%QA APPROVED INDICATOR%' or jsonb_array_length(c#>'{program_expenses,0,expense_breakdown}')<>2 or c#>>'{program_expenses,0,expense_breakdown,0,amount}'<>'100000000.01' then raise exception 'FAIL server-derived signed GP cost evidence';end if;
 if c#>'{program_expenses}' @> '[{"expense_breakdown":[{"budget_year":2027}]}]'::jsonb then raise exception 'FAIL future GP costs included in 2026';end if;
 -- Invalid client variants must produce validation errors, never SQL/identifier bugs.
 for variant in select v from (values
 (jsonb_set(d,'{base_reallocations}','{"07":0.00000001}'::jsonb)),(jsonb_set(d,'{base_reallocations}','{"13":-1,"07":1}'::jsonb)),
 (jsonb_set(d,'{base_reallocations}','{"07":-0.000000001,"04":0.000000001}'::jsonb)),
 (jsonb_set(d,'{expense_items,0,program_id}',to_jsonb(current_setting('qa.budget.foreign_program')))),
 (jsonb_set(d,'{expense_items,0,budget_year}','2027')),(jsonb_set(d,'{expense_items,0,amount}','123.45')),
 (jsonb_set(d,'{expense_items,1,amount}','0')),(jsonb_set(d,'{expense_items,1,amount}','-1')),
 (jsonb_set(d,'{expense_items,1,amount}','1000001')),(jsonb_set(d,'{expense_items,1,amount}','0.000000001')),
 (jsonb_set(d,'{expense_items,1,section_key}','"13"')),(jsonb_set(d,'{expense_items,1,unknown}','true')),
 (jsonb_set(d,'{expense_items,1,id}','"gp-2026"')),(jsonb_set(d,'{financing,bank_credit}','123.45678912000001')),
 (jsonb_set(d,'{expense_items}',jsonb_build_array(x,jsonb_set(x,'{id}','"gp-duplicate"')))),
 (jsonb_set(d,'{expense_items}',jsonb_build_array(x,jsonb_set(jsonb_set(x,'{id}','"gp-upper"'),'{program_id}',to_jsonb(upper(current_setting('qa.budget.program')))))))
 )invalid(v) loop
  rejected:=false;begin perform private.calculate_budget_simulator(g,variant);exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') and left(code,2) not in ('22','23') then raise;end if;rejected:=true;end;
  if not rejected then raise exception 'FAIL invalid expense/program/precision accepted: %',variant;end if;
 end loop;
 c:=private.calculate_budget_simulator(g,jsonb_set(d,'{expense_items,0,program_id}',to_jsonb(upper(current_setting('qa.budget.program')))));
 if jsonb_array_length(c->'program_expenses')<>1 then raise exception 'FAIL canonical UUID source evidence';end if;
 d:=jsonb_set(d,'{base_reallocations}','{"07":-0.00000001,"04":0.00000001}'::jsonb);
 perform set_config('qa.budget.draft',d::text,true);perform set_config('qa.budget.baseline_debt','37436200',true);
end;$math_and_validation$;

set local role authenticated;
do $events_requests_document$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;ev uuid:=current_setting('qa.budget.event')::uuid;ce uuid:=current_setting('qa.budget.credit_event')::uuid;region text;r jsonb;d jsonb:=current_setting('qa.budget.draft')::jsonb;
 req uuid;credit uuid;doc uuid;query text;rejected boolean;code text;actor text;
begin
 perform set_config('request.jwt.claim.sub',ids->>'minister',true);
 rejected:=false;begin perform create_budget_event_transfer_request(g,ev,'54','subsidy',1.23456789,0.11111111,'QA regional school capacity justified estimate and schedule','07','QA add 10 classroom places');exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'FAIL request for unstarted catalog scenario';end if;
 perform set_config('request.jwt.claim.sub',ids->>'region',true);perform start_regional_case(ev);
 req:=create_budget_event_transfer_request(g,ev,'54','subsidy',1.23456789,0.11111111,'QA regional school capacity justified estimate and schedule','07','QA add 10 classroom places');
 if (select amount from budget_transfer_requests where id=req)<>1.23456789 then raise exception 'FAIL transfer kopeck precision';end if;
 perform set_config('request.jwt.claim.sub',ids->>'minister',true);perform start_regional_case(ce);
 select comic_scene->>'region_code' into region from event_cases where id=ce;
 credit:=create_budget_event_transfer_request(g,ce,region,'budget_credit',2.34567891,0,'QA exact regional cash-gap budget credit with repayment timetable','04','QA maintain delivery until tax receipts');
 for query in select v from (values
 (format('select create_budget_event_transfer_request(%L,%L,''54'',''subsidy'',1,.1,%L,''07'',%L)',g,ev,'QA duplicate justified event request details','QA duplicate outcome target')),
 (format('select create_budget_event_transfer_request(%L,%L,''25'',''subsidy'',1,.1,%L,''07'',%L)',g,ev,'QA mismatched region justified event request','QA region result target')),
 (format('select create_budget_event_transfer_request(%L,%L,''54'',''subsidy'',1,.1,%L,''07'',%L)',current_setting('qa.budget.foreign_game'),ev,'QA foreign event justified request details','QA foreign outcome target')),
 (format('select create_budget_event_transfer_request(%L,%L,''54'',''subsidy'',1,.1,%L,''07'',%L)',g,gen_random_uuid(),'QA nonexistent event justified request details','QA nonexistent outcome target'))
 )invalid(v) loop
  rejected:=false;begin execute query;raise exception using errcode='ZX001',message='QA unexpected success';exception when sqlstate 'ZX001' then rejected:=false;when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') and left(code,2) not in ('22','23') then raise;end if;rejected:=true;end;
  if not rejected then raise exception 'FAIL invalid event request accepted';end if;
 end loop;
 d:=jsonb_set(d,'{transfer_ids}',jsonb_build_array(req,credit));r:=save_budget_simulator(g,null,d,null);
 r:=r||jsonb_build_object('calculation',(select calculation from budget_simulator_plans where id=(r->>'id')::uuid));
 if (r#>>'{calculation,transfer_expense}')::numeric<>1.23456789 or (r#>>'{calculation,credit_outflow}')::numeric<>2.34567891 then raise exception 'FAIL targeted expense and credit separation';end if;
 perform set_config('qa.budget.plan',r->>'id',true);perform set_config('qa.budget.req',req::text,true);perform set_config('qa.budget.credit',credit::text,true);perform set_config('qa.budget.credit_region',region,true);perform set_config('qa.budget.draft',d::text,true);
 rejected:=false;begin perform save_budget_simulator(g,(r->>'id')::uuid,d,0);exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;rejected:=true;end;
 if not rejected or (select revision from budget_simulator_plans where id=(r->>'id')::uuid)<>1 then raise exception 'FAIL atomic optimistic revision';end if;
 doc:=create_budget_simulator_document((r->>'id')::uuid);perform set_config('qa.budget.doc',doc::text,true);
 if create_budget_simulator_document((r->>'id')::uuid)<>doc then raise exception 'FAIL document idempotence';end if;
 if (select body_text from formal_documents where id=doc) not like '%QA APPROVED INDICATOR%' or (select body_text from formal_documents where id=doc) not like '%QA approved expense B%' or (select body_text from formal_documents where id=doc) not like '%QA add 10 classroom places%' then raise exception 'FAIL detailed law appendices';end if;
 if (select jsonb_array_length(metadata#>'{budget_snapshot,transfer_requests}') from formal_documents where id=doc)<>2 then raise exception 'FAIL frozen law-event relationship';end if;
 if exists(select 1 from budget_transfer_requests where game_id=g and status='granted') or (select last_plan_id from budget_simulator_state where game_id=g) is not null or (select internal_debt from budget_simulator_state where game_id=g)<>37436200 then raise exception 'FAIL request/save/document executes finance before law publication';end if;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);perform advance_formal_document(doc,'advance','QA draft prepared for collegial Government consideration');
 if (select status_code from formal_documents where id=doc)<>'government' then raise exception 'FAIL initial budget Government stage';end if;
end;$events_requests_document$;
reset role;

-- Actual regional decisions alter the base once; seeding or requesting never does.
do $event_effect$
declare g uuid:=current_setting('qa.budget.game')::uuid;ev uuid;before_c jsonb;after_c jsonb;before_count integer;
begin
 perform set_config('request.jwt.claim.sub',(current_setting('qa.budget.users')::jsonb)->>'teacher',true);
 select id into ev from event_cases where game_id=g and jsonb_typeof(comic_scene->'budget_request')='object' and exists(select 1 from jsonb_array_elements(effect_plan->'options')o where (o#>>'{fiscal_effect,enterprises}')::int>0) order by case_key limit 1;
 if ev is null then raise exception 'FAIL growth scenario missing';end if;
 before_c:=private.calculate_budget_simulator(g,current_setting('qa.budget.draft')::jsonb);
 select enterprises into before_count from game_fiscal_regions where game_id=g and region_code=(select comic_scene->>'region_code' from event_cases where id=ev);
 insert into event_case_outcomes(game_id,case_id,winner,yes_votes,no_votes,votes_count,assignments_count,trust_delta)
 select g,ev,'option_'||ord,1,0,1,1,0 from event_cases c,jsonb_array_elements(c.effect_plan->'options')with ordinality o(opt,ord) where c.id=ev and (opt#>>'{fiscal_effect,enterprises}')::int>0 limit 1;
 after_c:=private.calculate_budget_simulator(g,current_setting('qa.budget.draft')::jsonb);
 if (after_c->>'activity')::numeric<=(before_c->>'activity')::numeric then raise exception 'FAIL actual outcome did not alter dynamic revenue base';end if;
 insert into event_case_outcomes(game_id,case_id,winner,yes_votes,no_votes,votes_count,assignments_count,trust_delta)
 select game_id,case_id,winner,yes_votes,no_votes,votes_count,assignments_count,trust_delta from event_case_outcomes where case_id=ev on conflict do nothing;
 if (select count(*) from fiscal_change_ledger where game_id=g and source_type='event' and source_id=ev::text)<>1 then raise exception 'FAIL regional outcome applied twice';end if;
 -- Restore the fictional finance inputs before exercising the law's fixed snapshot.
 update game_fiscal_regions set enterprises=(l.before_values->>'enterprises')::int,activity_multiplier=(l.before_values->>'activity_multiplier')::numeric,cost_multiplier=(l.before_values->>'cost_multiplier')::numeric,expenditure=(l.before_values->>'expenditure')::numeric from fiscal_change_ledger l where game_fiscal_regions.game_id=g and l.game_id=g and l.source_type='event' and l.source_id=ev::text and game_fiscal_regions.region_code=l.region_code;
end;$event_effect$;

set local role authenticated;
do $government_vote$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;doc uuid:=current_setting('qa.budget.doc')::uuid;vote uuid;res jsonb;query text;rejected boolean;code text;
begin
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 for query in select v from (values
 (format('select advance_formal_document(%L,''advance'',''QA bypass'')',doc)),
 (format('select create_procedural_vote(%L,''QA forged Government'',null,''member'',''all'',''generic'',''none'',0,''yes_no_simple'',0.5,true,false,%L,''advance'',''none'')',g,doc)),
 (format('select create_procedural_vote(%L,''QA weak Government'',null,''member'',''government'',''budget_government_submission'',''fraction'',0.5,''yes_no_simple'',0.5,true,true,%L,''advance'',''return_author'')',g,doc))
 )invalid(v) loop
  rejected:=false;begin execute query;raise exception using errcode='ZX001',message='QA unexpected success';exception when sqlstate 'ZX001' then rejected:=false;when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;rejected:=true;end;
  if not rejected then raise exception 'FAIL Government required vote bypass';end if;
 end loop;
 perform set_config('app.vote_group','One-person group',true);rejected:=false;
 begin perform create_procedural_vote(g,'QA group shrink',null,'member','government','budget_government_submission','fraction',.5,'present_majority',.5,true,true,doc,'advance','return_author');exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;rejected:=true;end;
 perform set_config('app.vote_group','',true);if not rejected then raise exception 'FAIL Government one-person quorum shrink';end if;
 perform set_config('request.jwt.claim.sub',ids->>'deputy',true);rejected:=false;
 begin perform create_procedural_vote(g,'QA deputy opener',null,'member','government','budget_government_submission','fraction',.5,'present_majority',.5,true,true,doc,'advance','return_author');exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'FAIL deputy PM opened primary PM submission';end if;
 perform set_config('request.jwt.claim.sub',ids->>'pm',true);
 vote:=create_procedural_vote(g,'QA legitimate Government',null,'member','government','budget_government_submission','fraction',.5,'present_majority',.5,true,true,doc,'advance','return_author');
 if (select (electorate_snapshot->>'eligible')::numeric from game_votes where id=vote)<>3 then raise exception 'FAIL formal-office Govt roster / archived filter';end if;
 res:=close_budget_government_vote(vote,'QA no registrations');if res->>'result'<>'no_quorum' or (select status_code from formal_documents where id=doc)<>'government' then raise exception 'FAIL unregistered Government advanced budget';end if;
 vote:=create_procedural_vote(g,'QA registered Government',null,'member','government','budget_government_submission','fraction',.5,'present_majority',.5,true,true,doc,'advance','return_author');
 perform set_config('qa.budget.gov_vote',vote::text,true);
 perform register_institution_session_at_stage(g,'government',13);perform cast_procedural_vote(vote,'yes');
 perform set_config('request.jwt.claim.sub',ids->>'minister',true);perform register_institution_session_at_stage(g,'government',13);perform cast_procedural_vote(vote,'no');
 rejected:=false;begin update game_ballots set weight=1000000,yes_weight=1000000 where vote_id=vote and voter_id=(ids->>'minister')::uuid;exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'FAIL active own ballot UPDATE forged weight';end if;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 for query in select v from (values
 (format('update game_votes set electorate_snapshot=''{"eligible":1,"weights":{}}''::jsonb where id=%L',vote)),
 (format('update game_votes set status=''closed'',result_code=''passed'',result_yes=999,result_present=999,result_quorum_met=true where id=%L',vote)),
 (format('update game_votes set formal_document_id=null,procedure_key=''generic'' where id=%L',vote))
 )invalid(v) loop
  rejected:=false;begin execute query;raise exception using errcode='ZX001',message='QA unexpected success';exception when sqlstate 'ZX001' then rejected:=false;when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;rejected:=true;end;
  if not rejected then raise exception 'FAIL raw teacher vote forgery';end if;
 end loop;
 perform set_config('request.jwt.claim.sub',ids->>'ordinary',true);rejected:=false;
 begin insert into game_ballots(vote_id,voter_id,choice,weight,yes_weight,no_weight,abstain_weight) values(vote,(ids->>'ordinary')::uuid,'yes',1000000,1000000,0,0);exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'FAIL forged raw ballot weight';end if;
 perform set_config('request.jwt.claim.sub',ids->>'pm',true);
 rejected:=false;begin perform close_procedural_vote(vote,'QA generic wrong-chair bypass');exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'FAIL generic close used raw role instead of actual formal PM chair vote';end if;
 res:=close_budget_government_vote(vote,'QA actual formal primary PM yes chair vote');
 if res->>'result'<>'passed' or (res->>'yes')::numeric<>1 or (res->>'no')::numeric<>1 or (select status_code from formal_documents where id=doc)<>'budget_registered' then raise exception 'FAIL legitimate Government tie did not register law %',res;end if;
 res:=close_budget_government_vote(vote,'QA repeated closure after document transition');
 if not (res->>'already_closed')::boolean then raise exception 'FAIL isolated Government closure is not idempotent';end if;
end;$government_vote$;

do $government_no_chair_tie$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;d jsonb:=current_setting('qa.budget.draft')::jsonb;doc uuid;vote uuid;r jsonb;res jsonb;rejected boolean;code text;
begin
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);d:=jsonb_set(d,'{title}','"QA separate Government no-chair tie"'::jsonb);
 r:=save_budget_simulator(g,null,d,null);doc:=create_budget_simulator_document((r->>'id')::uuid);
 perform advance_formal_document(doc,'advance','QA second fictional law for actual PM no chair vote');
 perform set_config('request.jwt.claim.sub',ids->>'pm',true);
 vote:=create_procedural_vote(g,'QA actual Government no-chair tie',null,'member','government','budget_government_submission','fraction',.5,'present_majority',.5,true,true,doc,'advance','return_author');
 perform register_institution_session_at_stage(g,'government',13);perform cast_procedural_vote(vote,'no');
 perform set_config('request.jwt.claim.sub',ids->>'minister',true);perform register_institution_session_at_stage(g,'government',13);perform cast_procedural_vote(vote,'yes');
 perform set_config('request.jwt.claim.sub',ids->>'deputy',true);rejected:=false;
 begin perform close_budget_government_vote(vote,'QA deputy cannot replace actual primary PM');exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'FAIL deputy PM closed Government budget vote';end if;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);res:=close_budget_government_vote(vote,'QA teacher follows actual formal PM no chair vote');
 if res->>'result'<>'rejected' or (res->>'yes')::numeric<>1 or (res->>'no')::numeric<>1 or (select status_code from formal_documents where id=doc)<>'revision' then raise exception 'FAIL teacher did not follow actual formal PM no chair vote %',res;end if;
end;$government_no_chair_tie$;

do $duma_three_readings$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;doc uuid:=current_setting('qa.budget.doc')::uuid;vote uuid;res jsonb;reading integer;rejected boolean;code text;
 ii_before jsonb;ii_after jsonb;ii_draft_before jsonb;ii_draft_after jsonb;ii_meta jsonb;ii_amendment uuid;ii_pack_vote uuid;ii_revision integer;
begin
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);perform advance_formal_document(doc,'advance','QA registered by Duma staff');
 if (select status_code from formal_documents where id=doc)<>'budget_committee' then raise exception 'FAIL budget committee stage missing';end if;
 rejected:=false;begin perform advance_formal_document(doc,'advance','QA omit mandatory preliminary package');exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'FAIL preliminary package gate';end if;
 rejected:=false;begin perform create_procedural_vote(g,'QA bypass committee by generic vote',null,'member','all','generic','none',0,'yes_no_simple',.5,true,false,doc,'advance','none');exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'FAIL custom committee vote bypasses readiness';end if;
 perform save_budget_preliminary_review(doc,true,true,true,'QA Budget committee conclusion after complete package review','accept','QA reviewed');
 perform advance_formal_document(doc,'advance','QA accepted preliminary review');perform advance_formal_document(doc,'advance','QA Duma council scheduled first reading');
 for reading in 1..3 loop
  if (select status_code from formal_documents where id=doc)<>'reading'||reading then raise exception 'FAIL missing mandatory reading %',reading;end if;
  rejected:=false;begin perform advance_formal_document(doc,'advance','QA bypass reading vote');exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;rejected:=true;end;
  if not rejected then raise exception 'FAIL mandatory reading bypass %',reading;end if;
  perform set_config('app.vote_group','QA',true);rejected:=false;
  begin perform create_procedural_vote(g,'QA group-limited Duma',null,'mandate','gd','budget_reading'||reading,'fraction',.5,'eligible_majority',.5,true,false,doc,'advance',case when reading=1 then 'none' else 'reject' end);exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;rejected:=true;end;
  perform set_config('app.vote_group','',true);if not rejected then raise exception 'FAIL Duma group reduction';end if;
  vote:=create_procedural_vote(g,'QA budget reading '||reading,null,'mandate','gd','budget_reading'||reading,'fraction',.5,'eligible_majority',.5,true,false,doc,'advance',case when reading=1 then 'none' else 'reject' end);
  if (select (electorate_snapshot->>'eligible')::numeric from game_votes where id=vote)<>450 then raise exception 'FAIL Duma full mandates';end if;
  perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform register_institution_session_at_stage(g,'gd',13);perform cast_procedural_vote(vote,'yes');
  perform set_config('request.jwt.claim.sub',ids->>'duma_b',true);perform register_institution_session_at_stage(g,'gd',13);perform cast_procedural_vote(vote,'yes');
  perform set_config('request.jwt.claim.sub',ids->>'teacher',true);res:=close_procedural_vote(vote,'QA actual registered reading vote');
  if res->>'result'<>'passed' or (res->>'yes')::numeric<>450 then raise exception 'FAIL registered Duma reading %: %',reading,res;end if;
  if reading=1 then
   if (select status_code from formal_documents where id=doc)<>'amendments' then raise exception 'FAIL second-reading amendments stage missing';end if;
   select metadata->'budget_snapshot',metadata->'budget_draft',coalesce((metadata->>'revision')::integer,1)
    into ii_before,ii_draft_before,ii_revision from formal_documents where id=doc;
   ii_amendment:=submit_budget_law_amendment(doc,ii_revision,'government','QA one kopeck from administration to education',
    'QA selected second-reading reallocation preserves all first-reading characteristics and protected expenses.','01','07',0.00000001,null);
   if (select metadata->'budget_first_reading_snapshot' from formal_documents where id=doc) is distinct from ii_before
    then raise exception 'FAIL first-reading snapshot not frozen from actual passed reading I';end if;
   ii_pack_vote:=open_budget_law_amendment_vote(doc,array[ii_amendment]);
   if (select status_code from formal_documents where id=doc)<>'amendments'
    or (select amendment_ids from budget_law_amendment_packs where vote_id=ii_pack_vote) is distinct from array[ii_amendment]
    then raise exception 'FAIL isolated selected package changes whole-reading status';end if;
   perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform register_institution_session_at_stage(g,'gd',13);
   perform cast_vote_allocation(ii_pack_vote,226,0,0);
   perform set_config('request.jwt.claim.sub',ids->>'duma_b',true);perform register_institution_session_at_stage(g,'gd',13);
   perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
   res:=close_budget_law_amendment_vote(ii_pack_vote,'QA registered 226-vote selected one-kopeck amendment');
   if res->>'result'<>'passed' or (res->>'yes')::numeric<>226 or (res->>'eligible')::numeric<>450 or not (res->>'quorum')::boolean
    then raise exception 'FAIL actual selected amendment package result %',res;end if;
   select metadata into ii_meta from formal_documents where id=doc;
   ii_after:=ii_meta->'budget_snapshot';ii_draft_after:=ii_meta->'budget_draft';
   if (ii_after-'expense_lines') is distinct from (ii_before-'expense_lines')
    or ii_meta->'budget_first_reading_snapshot' is distinct from ii_before
    or (ii_draft_after-'base_reallocations') is distinct from (ii_draft_before-'base_reallocations')
    then raise exception 'FAIL selected package changed frozen macro characteristics or protected draft';end if;
   if (select (a->>'amount')::numeric from jsonb_array_elements(ii_after->'expense_lines')a where a->>'key'='01')
       <> (select (a->>'amount')::numeric from jsonb_array_elements(ii_before->'expense_lines')a where a->>'key'='01')-0.00000001
    or (select (a->>'amount')::numeric from jsonb_array_elements(ii_after->'expense_lines')a where a->>'key'='07')
       <> (select (a->>'amount')::numeric from jsonb_array_elements(ii_before->'expense_lines')a where a->>'key'='07')+0.00000001
    or (ii_draft_after#>>'{base_reallocations,01}')::numeric<>coalesce((ii_draft_before#>>'{base_reallocations,01}')::numeric,0)-0.00000001
    or (ii_draft_after#>>'{base_reallocations,07}')::numeric<>coalesce((ii_draft_before#>>'{base_reallocations,07}')::numeric,0)+0.00000001
    then raise exception 'FAIL exact one-kopeck selected law allocation lost';end if;
   if exists(select 1 from jsonb_array_elements(ii_before->'expense_lines')b
      join jsonb_array_elements(ii_after->'expense_lines')a on a->>'key'=b->>'key'
      where a->>'key' in ('01','07') and (a-'base_amount'-'base_reallocation_amount'-'amount') is distinct from (b-'base_amount'-'base_reallocation_amount'-'amount'))
    then raise exception 'FAIL reallocation touches signed GP, own measures, transfers or debt';end if;
   if (select draft from budget_simulator_plans where id=current_setting('qa.budget.plan')::uuid) is distinct from ii_draft_after
    or (select calculation from budget_simulator_plans where id=current_setting('qa.budget.plan')::uuid) is distinct from ii_after
    or (select status from budget_law_amendments where id=ii_amendment)<>'accepted'
    or (select status from budget_law_amendment_packs where vote_id=ii_pack_vote)<>'accepted'
    then raise exception 'FAIL accepted package not synchronised into saved plan and legal snapshot';end if;
   perform set_config('qa.budget.ii_before',ii_before::text,true);perform set_config('qa.budget.ii_after',ii_after::text,true);
   perform set_config('qa.budget.ii_draft',ii_draft_after::text,true);
   perform advance_formal_document(doc,'advance','QA accepted one-kopeck amendment table prepared for mandatory reading II');
  end if;
 end loop;
 if (select status_code from formal_documents where id=doc)<>'sf' then raise exception 'FAIL third budget reading skipped Federation Council';end if;
 if exists(select 1 from budget_transfer_requests where game_id=g and status='granted') then raise exception 'FAIL legislative voting disburses before publication';end if;
 perform advance_formal_document(doc,'advance','QA Federation Council approved budget');
 if (select status_code from formal_documents where id=doc)<>'president' then raise exception 'FAIL President signature stage';end if;
end;$duma_three_readings$;
reset role;

-- Finished games block signature, copying, preparation and financial execution.
do $additional_precision_and_sources$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;
 d jsonb:=current_setting('qa.budget.draft')::jsonb;c jsonb;x jsonb;v jsonb;r jsonb;from_key text;to_key text;
 pairs integer:=0;rejected boolean;code text;req uuid;ev uuid;reg text;before_reg jsonb;
begin
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);c:=private.calculate_budget_simulator(g,d);
 for from_key in select a->>'key' from jsonb_array_elements(c->'expense_lines')a where a->>'key'<>'13' loop
  for to_key in select a->>'key' from jsonb_array_elements(c->'expense_lines')a where a->>'key'<>'13' and a->>'key'<>from_key loop
   v:=jsonb_set(d,'{base_reallocations}',coalesce(d->'base_reallocations','{}'::jsonb)||jsonb_build_object(
    from_key,coalesce((d->'base_reallocations'->>from_key)::numeric,0)-0.00000001,
    to_key,coalesce((d->'base_reallocations'->>to_key)::numeric,0)+0.00000001));
   x:=private.calculate_budget_simulator(g,v);
   if (x->>'expenditure')::numeric<>(c->>'expenditure')::numeric
    or (select (a->>'amount')::numeric from jsonb_array_elements(x->'expense_lines')a where a->>'key'=from_key)
      <>(select (a->>'amount')::numeric from jsonb_array_elements(c->'expense_lines')a where a->>'key'=from_key)-0.00000001
    or (select (a->>'amount')::numeric from jsonb_array_elements(x->'expense_lines')a where a->>'key'=to_key)
      <>(select (a->>'amount')::numeric from jsonb_array_elements(c->'expense_lines')a where a->>'key'=to_key)+0.00000001
    then raise exception 'FAIL exact reallocation pair % to %',from_key,to_key;end if;
   pairs:=pairs+1;
  end loop;
 end loop;
 if pairs<>156 then raise exception 'FAIL all 156 ordered sections were not checked';end if;
 update state_program_budget_commitments set status='planned' where game_id=g and program_id=current_setting('qa.budget.program')::uuid and budget_year=2026;
 rejected:=false;begin perform private.calculate_budget_simulator(g,d);exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'FAIL planned GP commitment included';end if;
 update state_program_budget_commitments set status='approved' where game_id=g and program_id=current_setting('qa.budget.program')::uuid and budget_year=2026;
 req:=create_budget_transfer_request(g,'54','grant',0.00000001,0,'QA exact one-kopeck legacy request remains unfunded pending a published law','14');
 if (select amount from budget_transfer_requests where id=req)<>0.00000001 or (select status from budget_transfer_requests where id=req)<>'requested' then raise exception 'FAIL legacy one-kopeck request precision';end if;
 update budget_transfer_requests set status='rejected' where id=req;
 rejected:=false;begin perform private.calculate_budget_simulator(g,jsonb_set(d,'{transfer_ids}',jsonb_build_array(req)));exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'FAIL rejected request was selectable';end if;
 v:=jsonb_set(d,'{financing,other}',to_jsonb((d#>>'{financing,other}')::numeric+(c->>'funding_need')::numeric-(c->>'financing')::numeric-0.00000001));
 x:=private.calculate_budget_simulator(g,v);
 if (x->>'funding_gap')::numeric<>0.00000001 then raise exception 'FAIL one-kopeck gap setup';end if;
 r:=save_budget_simulator(g,null,v,null);rejected:=false;
 begin perform create_budget_simulator_document((r->>'id')::uuid);exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;rejected:=true;end;
 if not rejected or (select document_id from budget_simulator_plans where id=(r->>'id')::uuid) is not null then raise exception 'FAIL one-kopeck unfunded law accepted';end if;
 select c0.id,c0.comic_scene->>'region_code' into ev,reg from event_cases c0
 where c0.game_id=g and jsonb_typeof(c0.comic_scene->'budget_request')='object'
 and not exists(select 1 from event_case_outcomes o where o.case_id=c0.id)
 and exists(select 1 from jsonb_array_elements(c0.effect_plan->'options')o where (o#>>'{fiscal_effect,enterprises}')::int>0) order by c0.case_key limit 1;
 if ev is null then raise exception 'FAIL separate growth event for cap fixture missing';end if;
 select to_jsonb(r0) into before_reg from game_fiscal_regions r0 where r0.game_id=g and r0.region_code=reg;
 update game_fiscal_regions set enterprises=10000000 where game_id=g and region_code=reg;
 insert into event_case_outcomes(game_id,case_id,winner,yes_votes,no_votes,votes_count,assignments_count,trust_delta)
 select g,ev,'option_'||ord,1,0,1,1,0 from event_cases c0,jsonb_array_elements(c0.effect_plan->'options')with ordinality o(opt,ord)
 where c0.id=ev and (opt#>>'{fiscal_effect,enterprises}')::int>0 limit 1;
 if (select enterprises from game_fiscal_regions where game_id=g and region_code=reg)<>10000000 then raise exception 'FAIL enterprise cap';end if;
 update game_fiscal_regions set enterprises=(before_reg->>'enterprises')::int,activity_multiplier=(before_reg->>'activity_multiplier')::numeric,
  cost_multiplier=(before_reg->>'cost_multiplier')::numeric,expenditure=(before_reg->>'expenditure')::numeric where game_id=g and region_code=reg;
end;$additional_precision_and_sources$;

update game_members set roster_archived_at=now() where game_id=current_setting('qa.budget.game')::uuid and user_id=(current_setting('qa.budget.users')::jsonb->>'pm')::uuid;
set local role authenticated;
do $archived_government_actor$
declare ids jsonb:=current_setting('qa.budget.users')::jsonb;denied boolean:=false;code text;
begin
 perform set_config('request.jwt.claim.sub',ids->>'pm',true);
 begin perform close_budget_government_vote(current_setting('qa.budget.gov_vote')::uuid,'QA archived formal primary PM');
 exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;denied:=true;end;
 if not denied then raise exception 'FAIL archived formal PM could close budget vote';end if;
end;$archived_government_actor$;
reset role;
update game_members set roster_archived_at=null where game_id=current_setting('qa.budget.game')::uuid and user_id=(current_setting('qa.budget.users')::jsonb->>'pm')::uuid;
set local role anon;
do $anonymous_budget$
declare denied boolean:=false;code text;
begin
 perform set_config('request.jwt.claim.sub','',true);
 begin perform get_budget_simulator(current_setting('qa.budget.game')::uuid);
 exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;denied:=true;end;
 if not denied then raise exception 'FAIL anonymous budget RPC';end if;
end;$anonymous_budget$;
reset role;
set local role authenticated;
do $direct_document_and_own_ballot$
declare ids jsonb:=current_setting('qa.budget.users')::jsonb;doc uuid:=current_setting('qa.budget.doc')::uuid;affected integer;denied boolean;code text;
begin
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);denied:=false;
 begin update formal_documents set status_code='published' where id=doc;get diagnostics affected=row_count;denied:=affected=0;
 exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;denied:=true;end;
 if not denied or (select status_code from formal_documents where id=doc)<>'president' then raise exception 'FAIL raw teacher document mutation';end if;
 perform set_config('request.jwt.claim.sub',ids->>'minister',true);denied:=false;
 begin update game_ballots set weight=1000000,yes_weight=1000000 where vote_id=current_setting('qa.budget.gov_vote')::uuid and voter_id=(ids->>'minister')::uuid;
 get diagnostics affected=row_count;denied:=affected=0;
 exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;denied:=true;end;
 if not denied then raise exception 'FAIL raw own closed ballot mutation';end if;
end;$direct_document_and_own_ballot$;
reset role;

update games set status='archived' where id=current_setting('qa.budget.game')::uuid;
set local role authenticated;
do $archive_guard$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;doc uuid:=current_setting('qa.budget.doc')::uuid;q text;rejected boolean;code text;r jsonb;state_before jsonb;
begin
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);select to_jsonb(s) into state_before from budget_simulator_state s where game_id=g;r:=get_budget_simulator(g);
 if (r->>'can_prepare')::boolean or (select to_jsonb(s) from budget_simulator_state s where game_id=g) is distinct from state_before then raise exception 'FAIL archived budget read mutates finance';end if;
 for q in select v from (values
 (format('select sign_formal_document(%L,''QA archived signature'')',doc)),
 (format('select send_formal_document(%L,''president'',null,''QA archived copy'',false)',doc)),
 (format('select save_budget_simulator(%L,null,%L::jsonb,null)',g,current_setting('qa.budget.draft')))
 )invalid(v) loop
  rejected:=false;begin execute q;raise exception using errcode='ZX001',message='QA unexpected success';exception when sqlstate 'ZX001' then rejected:=false;when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') then raise;end if;rejected:=true;end;
  if not rejected then raise exception 'FAIL archived budget action accepted';end if;
 end loop;
end;$archive_guard$;
reset role;
update games set status='running' where id=current_setting('qa.budget.game')::uuid;
set local role authenticated;

do $publication_and_principal$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;doc uuid:=current_setting('qa.budget.doc')::uuid;r jsonb;s jsonb;bank uuid;before_reg jsonb;before_debt numeric;version integer;
begin
 perform set_config('request.jwt.claim.sub',ids->>'president',true);perform sign_formal_document(doc,'QA actual authorized President signature');
 if (select status_code from formal_documents where id=doc)<>'published' then raise exception 'FAIL President did not publish';end if;
 perform set_config('request.jwt.claim.sub',ids->>'minister',true);
 select to_jsonb(reg) into before_reg from game_fiscal_regions reg where game_id=g and region_code='54';r:=get_budget_simulator(g);s:=r->'state';
 if s->>'last_plan_id'<>current_setting('qa.budget.plan') or (select status from budget_transfer_requests where id=current_setting('qa.budget.req')::uuid)<>'granted' then raise exception 'FAIL published law did not execute selected requests';end if;
 if (select transfer_in from game_fiscal_regions where game_id=g and region_code='54')<>(before_reg->>'transfer_in')::numeric+1.23456789
  or (select expenditure from game_fiscal_regions where game_id=g and region_code='54')<>(before_reg->>'expenditure')::numeric+1.34567900 then raise exception 'FAIL subsidy / local cofinancing precision';end if;
 if (select budget_credit_cash from game_fiscal_regions where game_id=g and region_code=current_setting('qa.budget.credit_region'))<>2.34567891 then raise exception 'FAIL exact budget-credit liquidity';end if;
 version:=(s->>'version')::int;perform get_budget_simulator(g);
 if (select bs.version from budget_simulator_state bs where bs.game_id=g)<>version or (select count(*) from budget_simulator_ledger where game_id=g and kind='publication')<>1 then raise exception 'FAIL publication replay';end if;
 select id into bank from budget_finance_contracts where game_id=g and source_key='bank_credit';
 if (select principal from budget_finance_contracts where id=bank)<>123.45678912 or (s->>'internal_debt')::numeric<>37436200+123.45678912 then raise exception 'FAIL bank principal rounding creates phantom debt';end if;
 perform repay_budget_finance_contract(bank);perform repay_budget_finance_contract(bank);
 if (select internal_debt from budget_simulator_state where game_id=g)<>37436200 or (select principal from budget_finance_contracts where id=bank)<>0 or (select count(*) from budget_simulator_ledger where game_id=g and source_key='repay:'||bank)<>1 then raise exception 'FAIL exact one-time principal repayment';end if;
 before_debt:=(select debt from game_fiscal_regions where game_id=g and region_code=current_setting('qa.budget.credit_region'));
 perform repay_budget_transfer(current_setting('qa.budget.credit')::uuid);perform repay_budget_transfer(current_setting('qa.budget.credit')::uuid);
 if (select budget_credit_cash from game_fiscal_regions where game_id=g and region_code=current_setting('qa.budget.credit_region'))<>0 or (select debt from game_fiscal_regions where game_id=g and region_code=current_setting('qa.budget.credit_region'))<>before_debt-2.34567891 then raise exception 'FAIL exact one-time regional repayment';end if;
end;$publication_and_principal$;

do $legacy_float_save_law_and_principal$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;
 d jsonb:=(current_setting('qa.budget.draft')::jsonb)-'expense_items'-'base_reallocations';
 v jsonb;r jsonb;pl uuid;doc uuid;vote uuid;bank uuid;revision integer;reading integer;
 denied boolean;code text;before_state jsonb;before_debt numeric;expected_principal numeric;
begin
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 d:=jsonb_set(d,'{title}','"QA legacy 16.1B canonical Budget"'::jsonb);d:=jsonb_set(d,'{transfer_ids}','[]'::jsonb);
 d:=jsonb_set(d,'{financing,bank_credit}','16100.000000000002'::jsonb);
 select to_jsonb(s) into before_state from budget_simulator_state s where game_id=g;
 for v in select value from (values
  (jsonb_set(d,'{financing,bank_credit}','-0.0000000000001'::jsonb)),
  (jsonb_set(d,'{financing,bank_credit}','50000000.000000000001'::jsonb)),
  (jsonb_set(d,'{financing,bank_credit}','"NaN"'::jsonb)),
  (jsonb_set(d,'{financing,unexpected}','1'::jsonb)),
  (d||'{"expense_items":[]}'::jsonb),(d||'{"expense_items":null}'::jsonb),
  (d||'{"base_reallocations":{}}'::jsonb)
 )bad(value) loop
  denied:=false;begin perform save_budget_simulator(g,null,v,null);exception when others then get stacked diagnostics code=returned_sqlstate;if code not in ('P0001','42501') and left(code,2)<>'22' then raise;end if;denied:=true;end;
  if not denied then raise exception 'FAIL legacy raw bounds/types or strict new-form precision: %',v;end if;
 end loop;
 r:=save_budget_simulator(g,null,d,null);pl:=(r->>'id')::uuid;revision:=(r->>'revision')::int;
 if revision<>1 or (select (draft#>>'{financing,bank_credit}')::numeric from budget_simulator_plans where id=pl)<>16100
  or (select to_jsonb(s) from budget_simulator_state s where game_id=g) is distinct from before_state then raise exception 'FAIL legacy16.1B canonical storage or premature finance';end if;
 d:=jsonb_set(d,'{financing,bank_credit}','32300.000000000004'::jsonb);
 r:=save_budget_simulator(g,pl,d,revision);revision:=(r->>'revision')::int;
 if revision<>2 or (select (draft#>>'{financing,bank_credit}')::numeric from budget_simulator_plans where id=pl)<>32300 then raise exception 'FAIL legacy32.3B canonical update';end if;
 d:=jsonb_set(d,'{financing,bank_credit}','16100.000000000002'::jsonb);
 r:=save_budget_simulator(g,pl,d,revision);
 if (r->>'revision')::int<>3 or (select (draft#>>'{financing,bank_credit}')::numeric from budget_simulator_plans where id=pl)<>16100 then raise exception 'FAIL legacy canonical restore';end if;
 doc:=create_budget_simulator_document(pl);
 if (select (metadata#>>'{budget_draft,financing,bank_credit}')::numeric from formal_documents where id=doc)<>16100
  or (select body_text from formal_documents where id=doc) like '%16100.000000000002%' then raise exception 'FAIL legacy law uses noncanonical financier';end if;
 select internal_debt,16100-(last_financing->>'bank_credit')::numeric into before_debt,expected_principal from budget_simulator_state where game_id=g;
 if expected_principal<>15976.54321088 then raise exception 'FAIL canonical principal-delta fixture';end if;
 perform advance_formal_document(doc,'advance','QA canonical legacy Budget Government consideration');
 perform set_config('request.jwt.claim.sub',ids->>'pm',true);
 vote:=create_procedural_vote(g,'QA legacy actual Government',null,'member','government','budget_government_submission','fraction',.5,'present_majority',.5,true,true,doc,'advance','return_author');
 perform register_institution_session_at_stage(g,'government',13);perform cast_procedural_vote(vote,'yes');
 perform set_config('request.jwt.claim.sub',ids->>'minister',true);perform register_institution_session_at_stage(g,'government',13);perform cast_procedural_vote(vote,'yes');
 perform set_config('request.jwt.claim.sub',ids->>'pm',true);r:=close_budget_government_vote(vote,'QA canonical legacy collegial decision');
 if r->>'result'<>'passed' then raise exception 'FAIL legacy actual Government';end if;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 perform advance_formal_document(doc,'advance','QA canonical legacy Duma registration');
 perform save_budget_preliminary_review(doc,true,true,true,'QA canonical legacy Budget committee review covers calculations and financial appendices','accept','QA complete package');
 perform advance_formal_document(doc,'advance','QA canonical legacy committee package');perform advance_formal_document(doc,'advance','QA canonical legacy council schedule');
 for reading in 1..3 loop
  vote:=create_procedural_vote(g,'QA legacy reading '||reading,null,'mandate','gd','budget_reading'||reading,'fraction',.5,'eligible_majority',.5,true,false,doc,'advance',case when reading=1 then 'none' else 'reject' end);
  perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform register_institution_session_at_stage(g,'gd',13);perform cast_procedural_vote(vote,'yes');
  perform set_config('request.jwt.claim.sub',ids->>'duma_b',true);perform register_institution_session_at_stage(g,'gd',13);perform cast_procedural_vote(vote,'yes');
  perform set_config('request.jwt.claim.sub',ids->>'teacher',true);r:=close_procedural_vote(vote,'QA canonical legacy mandatory reading');
  if r->>'result'<>'passed' then raise exception 'FAIL legacy mandatory reading %',reading;end if;
  if reading=1 then perform advance_formal_document(doc,'advance','QA no pending numerical amendments in legacy law');end if;
 end loop;
 perform advance_formal_document(doc,'advance','QA canonical legacy Federation Council approval');
 perform set_config('request.jwt.claim.sub',ids->>'president',true);perform sign_formal_document(doc,'QA canonical legacy President signature');
 if (select status_code from formal_documents where id=doc)<>'published' then raise exception 'FAIL legacy publication prerequisite';end if;
 perform set_config('request.jwt.claim.sub',ids->>'minister',true);perform get_budget_simulator(g);
 select id into bank from budget_finance_contracts where game_id=g and source_key='bank_credit' and principal>0;
 if bank is null or (select principal from budget_finance_contracts where id=bank)<>expected_principal
  or (select internal_debt from budget_simulator_state where game_id=g)<>before_debt+expected_principal
  or (select last_plan_id from budget_simulator_state where game_id=g)<>pl then raise exception 'FAIL canonical law produces inexact principal';end if;
 perform repay_budget_finance_contract(bank);
 if (select principal from budget_finance_contracts where id=bank)<>0 or (select internal_debt from budget_simulator_state where game_id=g)<>before_debt then raise exception 'FAIL canonical legacy repayment leaves ghost debt';end if;
end;$legacy_float_save_law_and_principal$;
reset role;
select jsonb_build_object(
 'fictional_scope','PASS','common_engines_unchanged','PASS','rate_times_dynamic_base','PASS','aggregate_compatibility','PASS',
 'signed_2026_program_source','PASS','kopeck_precision','PASS','event_required_requests','PASS','no_prepublication_execution','PASS',
 'active_actor_and_RLS','PASS','raw_vote_and_weight_forgery_blocked','PASS','Government_registration_and_vote','PASS',
 'formal_PM_chair_yes_and_no_ties','PASS','isolated_Government_closure','PASS','committee_package_gate','PASS',
 'all_three_Duma_readings','PASS','SF_and_President','PASS','archive_readonly','PASS','publication_once','PASS','principal_repayment_exact','PASS',
 'exact_all_156_section_pairs','PASS','planned_GP_excluded','PASS','legacy_kopeck_precision','PASS','rejected_transfer_excluded','PASS',
 'strict_one_kopeck_gap','PASS','enterprise_cap_event','PASS','archived_Gov_closer','PASS','anonymous_rejected','PASS',
 'raw_document_and_own_ballot_update','PASS','legacy_16_1B_payload_canonical','PASS','legacy_raw_boundaries_preserved','PASS',
 'new_forms_precision_remains_strict','PASS','legacy_canonical_storage_law_contracts','PASS','legacy_principal_repayment_exact','PASS',
 'real_second_reading_one_kopeck_selected_package','PASS') checks;
rollback;
