begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
do $seed$
declare g uuid:=gen_random_uuid();party uuid:=gen_random_uuid();ids jsonb:='{}';k text;u uuid;b jsonb;
begin
 foreach k in array array['teacher','pm','minister','duma_a','duma_b','president'] loop
  u:=gen_random_uuid();insert into auth.users(id,aud,role) values(u,'authenticated','authenticated');ids:=ids||jsonb_build_object(k,u);
 end loop;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 insert into games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA standalone Budget II failures','QA'||substr(replace(g::text,'-',''),1,12),(ids->>'teacher')::uuid,'running',13,true);
 insert into game_members(game_id,user_id,full_name,kind,role_title,group_name)
 select g,(ids->>v.k)::uuid,'QA '||v.k,v.kind::public.member_kind,v.title,'QA'
 from (values('teacher','teacher','Преподаватель'),('pm','student','Участник'),('minister','student','Министр финансов'),
 ('duma_a','student','Депутат Государственной Думы'),('duma_b','student','Депутат Государственной Думы'),('president','student','Президент Российской Федерации'))v(k,kind,title);
 insert into game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 values(g,(ids->>'pm')::uuid,'Председатель Правительства Российской Федерации','active',(ids->>'teacher')::uuid,(ids->>'teacher')::uuid,'QA formal primary PM',true);
 insert into game_stages(game_id,stage_no,title,mode,summary,status)
 select g,n,'QA stage '||n,'Учебная процедура','QA',case when n in (1,12,13) then 'open' else 'locked' end from generate_series(1,16)n
 on conflict(game_id,stage_no) do nothing;
 insert into state_metrics(game_id,metric_key,label,value,unit,is_public,group_key,min_value,max_value,sort_order)
 values(g,'economy','QA economy',50,'%',true,'QA',0,100,1),(g,'public_trust','QA trust',50,'%',true,'QA',0,100,2)
 on conflict(game_id,metric_key) do nothing;
 insert into game_parties(id,game_id,name,mandates,leader_user_id) values(party,g,'QA Duma',450,(ids->>'duma_a')::uuid);
 update game_members set team='QA Duma' where game_id=g and user_id in ((ids->>'duma_a')::uuid,(ids->>'duma_b')::uuid);
 insert into game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis) values
 (g,(ids->>'duma_a')::uuid,'Председатель Государственной Думы','active',(ids->>'teacher')::uuid,(ids->>'teacher')::uuid,'QA fixture'),
 (g,(ids->>'president')::uuid,'Президент Российской Федерации','active',(ids->>'teacher')::uuid,(ids->>'teacher')::uuid,'QA fixture'),
 (g,(ids->>'minister')::uuid,'Министерство по экономической политике','active',(ids->>'teacher')::uuid,(ids->>'teacher')::uuid,'QA fixture') on conflict do nothing;
 insert into game_profiles(game_id,user_id,signature_path) select g,(ids->>x)::uuid,g::text||'/profiles/'||(ids->>x)||'/signature-qa.png' from unnest(array['pm','duma_a','president']) x;
 insert into storage.objects(bucket_id,name) select 'game-assets',g::text||'/profiles/'||(ids->>x)||'/signature-qa.png' from unnest(array['pm','duma_a','president']) x;
 select data into b from private.budget_baseline where year=2026;
 perform set_config('qa.budget.game',g::text,true);perform set_config('qa.budget.users',ids::text,true);
 perform set_config('qa.budget.party',party::text,true);
 perform set_config('qa.budget.draft',jsonb_build_object('title','QA standalone Budget','note','QA balanced baseline budget prepared to test selected second-reading amendment decisions.',
 'income_changes','{}'::jsonb,'spending_changes',(select jsonb_object_agg(l->>'key',-50) from jsonb_array_elements(b->'expense_lines') l),'revenue_adjustments','{}'::jsonb,'financing',(select jsonb_object_agg(z.key,0) from jsonb_object_keys(b->'financing') z(key)),
 'terms','{"ofz_fixed":60,"ofz_float":60,"bank_credit":12,"external":60}'::jsonb,'transfer_ids','[]'::jsonb,'expense_items','[]'::jsonb)::text,true);
end;$seed$;
select private.ensure_budget_simulator(current_setting('qa.budget.game')::uuid);
update game_fiscal_policy set oil_price=45,cutoff_price=40 where game_id=current_setting('qa.budget.game')::uuid;
update budget_simulator_state set fnb_last_oil_allocation=0 where game_id=current_setting('qa.budget.game')::uuid;
do $program$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;p uuid:=gen_random_uuid();component uuid:=gen_random_uuid();c jsonb;d jsonb:=current_setting('qa.budget.draft')::jsonb;before_c jsonb;
begin
 before_c:=private.calculate_budget_simulator(g,d);
 insert into state_programs(id,game_id,title,responsible_ministry,responsible_minister_id,created_by,start_date,end_date,total_budget,national_goal,expected_results)
 values(p,g,'QA signed 2027 programme','Министерство по социальной политике',(ids->>'minister')::uuid,(ids->>'minister')::uuid,'2027-01-01','2028-12-31',123456814.15,'QA national goal','QA measurable results');
 insert into state_program_goals(program_id,game_id,goal_text,indicator_name,unit,baseline_value,target_value,target_year)
 values(p,g,'QA measurable goal','QA APPROVED INDICATOR','units',1,20,2027);
 insert into state_program_components(id,program_id,game_id,direction_no,direction_title,component_kind,title,goal_text,start_date,end_date,budget)
 values(component,p,g,1,'QA source direction','project','QA approved project','QA source goal','2027-01-01','2028-12-31',123456814.15);
 insert into state_program_expenses(program_id,game_id,component_id,indicator_name,justification,budget_year,amount,position,created_by)
 values(p,g,component,'QA approved expense A','QA approved source cost justification A',2027,100000000.01,1,(ids->>'minister')::uuid),
 (p,g,component,'QA approved expense B','QA approved source cost justification B',2027,23456789.11,2,(ids->>'minister')::uuid),
 (p,g,component,'QA FUTURE EXPENSE','QA future-year source cost',2028,25.03,3,(ids->>'minister')::uuid);
 update state_programs set status='adopted',signed_at=now(),signed_by=(ids->>'pm')::uuid where id=p;
 insert into state_program_budget_commitments(program_id,game_id,budget_year,amount,status,signed_by,signed_at)
 values(p,g,2027,123456789.12,'approved',(ids->>'pm')::uuid,now()),(p,g,2028,25.03,'approved',(ids->>'pm')::uuid,now());
 c:=private.calculate_budget_simulator(g,d);
 if jsonb_array_length(c->'expense_items')<>1 or (c#>>'{expense_items,0,amount}')::numeric<>123.45678912
 or c#>>'{expense_items,0,budget_year}'<>'2027'
 or (c->>'expenditure')::numeric-(before_c->>'expenditure')::numeric<>123.45678912 then raise exception 'FAIL signed GP year and amount';end if;
 if (c->>'fnb_oil_allocation')::numeric<=0 or (c->>'surplus')::numeric<=(c->>'fnb_oil_change')::numeric
 or (c->>'funding_need')::numeric<>0 or (c->>'funding_gap')::numeric<>0
 or (c->>'cash_excess')::numeric<>(c->>'balance')::numeric-(c->>'fnb_oil_change')::numeric then raise exception 'FAIL net FNB cash identity: %',jsonb_build_object('surplus',c->'surplus','oil',c->'fnb_oil_change','need',c->'funding_need','gap',c->'funding_gap','cash',c->'cash_excess');end if;
 begin
  update game_fiscal_policy set cutoff_price=50 where game_id=g;
  c:=private.calculate_budget_simulator(g,d);
  if (c->>'fnb_oil_allocation')::numeric<>0 then raise exception 'FAIL oil at/below cutoff';end if;
  raise exception using errcode='ZX001',message='rollback price scenario';
 exception when sqlstate 'ZX001' then null;end;
end;$program$;
set local role authenticated;
do $government_and_reading1$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;r jsonb;doc uuid;vote uuid;
begin
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);perform get_budget_simulator(g);
 perform set_student_mandates(current_setting('qa.budget.party')::uuid,jsonb_build_object(ids->>'duma_a',226,ids->>'duma_b',224));
 r:=save_budget_simulator(g,null,current_setting('qa.budget.draft')::jsonb,null);
 perform set_config('qa.budget.plan',r->>'id',true);doc:=create_budget_simulator_document((r->>'id')::uuid);
 perform set_config('qa.budget.doc',doc::text,true);perform advance_formal_document(doc,'advance','QA submit Government consideration');
 perform set_config('request.jwt.claim.sub',ids->>'pm',true);
 perform save_institution_meeting_document(g,13,'government','agenda','Рассмотрение проекта федерального закона о бюджете на 2027 год.',null);
 perform approve_institution_meeting_agenda(g,13,'government');
 vote:=create_procedural_vote(g,'QA actual Government',null,'member','government','budget_government_submission','fraction',.5,'present_majority',.5,true,true,doc,'advance','return_author');
 perform register_institution_session_at_stage(g,'government',13);perform cast_procedural_vote(vote,'yes');
 perform set_config('request.jwt.claim.sub',ids->>'minister',true);perform register_institution_session_at_stage(g,'government',13);perform cast_procedural_vote(vote,'yes');
 perform set_config('request.jwt.claim.sub',ids->>'pm',true);r:=close_budget_government_vote(vote,'QA registered Government approved');
 if r->>'result'<>'passed' then raise exception 'FAIL prerequisite Government %',r;end if;
 perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform advance_formal_document(doc,'advance','QA Duma staff registration');
 perform save_budget_preliminary_review(doc,true,true,true,'QA committee examined calculations and all mandatory budget annexes','accept','QA reviewed');
 perform advance_formal_document(doc,'advance','QA complete committee package');perform advance_formal_document(doc,'advance','QA council scheduled I reading');
 perform save_institution_meeting_document(g,13,'gd','agenda','Рассмотрение проекта федерального закона о бюджете в трёх чтениях.',null);
 perform approve_institution_meeting_agenda(g,13,'gd');
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 vote:=create_procedural_vote(g,'QA actual budget I reading',null,'mandate','gd','budget_reading1','fraction',.5,'eligible_majority',.5,true,false,doc,'advance','none');
 perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform register_institution_session_at_stage(g,'gd',13);perform cast_procedural_vote(vote,'yes');
 perform set_config('request.jwt.claim.sub',ids->>'duma_b',true);perform register_institution_session_at_stage(g,'gd',13);
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);r:=close_procedural_vote(vote,'QA I reading passed with actual 226 votes');
 if r->>'result'<>'passed' or (r->>'yes')::numeric<>226 or (select status_code from formal_documents where id=doc)<>'amendments'
 then raise exception 'FAIL prerequisite I reading %',r;end if;
end;$government_and_reading1$;
reset role;
-- Move only this new QA game's registrations to another stage. No rows are deleted.
update institution_session_registrations set stage_no=12 where game_id=current_setting('qa.budget.game')::uuid and institution_key='gd' and stage_no=13;
set local role authenticated;
do $failure_branches$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;
 doc uuid:=current_setting('qa.budget.doc')::uuid;plan uuid:=current_setting('qa.budget.plan')::uuid;
 a uuid;fresh uuid;v0 uuid;v225 uuid;v226 uuid;r jsonb;m0 jsonb;p0 jsonb;m1 jsonb;c0 jsonb;c1 jsonb;rev integer;denied boolean;code text;
begin
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 select coalesce((metadata->>'revision')::integer,1) into rev from formal_documents where id=doc;
 a:=submit_budget_law_amendment(doc,rev,'government','QA one-kopeck reallocation',
 'QA test restores an unconsidered amendment after no quorum and rejects 225 votes without changing the approved budget.','01','07',0.00000001,null);
 select metadata into m0 from formal_documents where id=doc;
 select to_jsonb(p) into p0 from budget_simulator_plans p where id=plan;c0:=m0->'budget_snapshot';
 denied:=false;begin perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform advance_formal_document(doc,'advance','QA attempt whole II with pending amendment');
 exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;denied:=true;end;
 if not denied or (select status_code from formal_documents where id=doc)<>'amendments' then raise exception 'FAIL pending amendment gate';end if;

 v0:=open_budget_law_amendment_vote(doc,array[a]);r:=close_budget_law_amendment_vote(v0,'QA no registered deputies');
 if r->>'result'<>'no_quorum' or (r->>'present')::numeric<>0 or (r->>'yes')::numeric<>0 or (r->>'quorum')::boolean
 then raise exception 'FAIL no quorum %',r;end if;
 if (select status from budget_law_amendment_packs where vote_id=v0)<>'no_quorum'
 or (select status from budget_law_amendments where id=a)<>'submitted' or (select vote_id from budget_law_amendments where id=a) is not null
 or (select metadata from formal_documents where id=doc) is distinct from m0
 or (select to_jsonb(p) from budget_simulator_plans p where id=plan) is distinct from p0
 then raise exception 'FAIL no-quorum restoration or unchanged law/plan';end if;
 denied:=false;begin perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform advance_formal_document(doc,'advance','QA attempt II with restored pending amendment');
 exception when others then get stacked diagnostics code=returned_sqlstate;if code<>'P0001' then raise;end if;denied:=true;end;
 if not denied then raise exception 'FAIL restored pending amendment gate';end if;

 v225:=open_budget_law_amendment_vote(doc,array[a]);if v225=v0 then raise exception 'FAIL reused closed vote';end if;
 perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform register_institution_session_at_stage(g,'gd',13);perform cast_vote_allocation(v225,225,1,0);
 perform set_config('request.jwt.claim.sub',ids->>'duma_b',true);perform register_institution_session_at_stage(g,'gd',13);
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);r:=close_budget_law_amendment_vote(v225,'QA 225 yes plus 1 no');
 if r->>'result'<>'rejected' or (r->>'yes')::numeric<>225 or (r->>'no')::numeric<>1 or (r->>'cast')::numeric<>226
 or not (r->>'quorum')::boolean or (r->>'eligible')::numeric<>450 then raise exception 'FAIL 225 rejection %',r;end if;
 if (select status from budget_law_amendment_packs where vote_id=v225)<>'rejected' or (select status from budget_law_amendments where id=a)<>'rejected'
 or (select metadata from formal_documents where id=doc) is distinct from m0
 or (select to_jsonb(p) from budget_simulator_plans p where id=plan) is distinct from p0
 then raise exception 'FAIL rejected package changed law/plan';end if;

 select coalesce((metadata->>'revision')::integer,1) into rev from formal_documents where id=doc;
 fresh:=submit_budget_law_amendment(doc,rev,'government','QA fresh one-kopeck proposal',
 'QA fresh proposal after a rejected package keeps first-reading characteristics and protected commitments unchanged.','01','07',0.00000001,null);
 if fresh=a then raise exception 'FAIL fresh proposal identity';end if;
 v226:=open_budget_law_amendment_vote(doc,array[fresh]);
 perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform cast_vote_allocation(v226,226,0,0);
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);r:=close_budget_law_amendment_vote(v226,'QA fresh selected proposal accepted');
 if r->>'result'<>'passed' or (r->>'yes')::numeric<>226 or not (r->>'quorum')::boolean then raise exception 'FAIL fresh226 %',r;end if;
 select metadata into m1 from formal_documents where id=doc;c1:=m1->'budget_snapshot';
 if (c1-'expense_lines') is distinct from (c0-'expense_lines') or m1->'budget_first_reading_snapshot' is distinct from m0->'budget_first_reading_snapshot'
 or (select (l->>'amount')::numeric from jsonb_array_elements(c1->'expense_lines')l where l->>'key'='01')
 <>(select (l->>'amount')::numeric from jsonb_array_elements(c0->'expense_lines')l where l->>'key'='01')-0.00000001
 or (select (l->>'amount')::numeric from jsonb_array_elements(c1->'expense_lines')l where l->>'key'='07')
 <>(select (l->>'amount')::numeric from jsonb_array_elements(c0->'expense_lines')l where l->>'key'='07')+0.00000001
 or (select draft from budget_simulator_plans where id=plan) is distinct from m1->'budget_draft'
 or (select calculation from budget_simulator_plans where id=plan) is distinct from c1
 or (select status from budget_law_amendments where id=fresh)<>'accepted' or (select status from budget_law_amendments where id=a)<>'rejected'
 then raise exception 'FAIL fresh acceptance exactness or old rejection isolation';end if;
 perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform advance_formal_document(doc,'advance','QA settled table enters mandatory II reading');
 if (select status_code from formal_documents where id=doc)<>'reading2' then raise exception 'FAIL resolved table gate';end if;
end;$failure_branches$;
reset role;
update state_metrics set value=70 where game_id=current_setting('qa.budget.game')::uuid and metric_key='lawfulness';
do $legacy_sf$
declare g uuid:=current_setting('qa.budget.game')::uuid;u uuid:=gen_random_uuid();
begin
 insert into auth.users(id,aud,role) values(u,'authenticated','authenticated');
 insert into game_members(game_id,user_id,full_name,kind,role_title,group_name) values(g,u,'QA legacy senator','student','Сенатор Российской Федерации','QA');
 if not private.vote_member_has_office(g,u,'sf') then raise exception 'FAIL legacy senator fixture';end if;
 perform set_config('qa.budget.legacy_sf',u::text,true);
end;$legacy_sf$;
set local role authenticated;
do $publish$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;doc uuid:=current_setting('qa.budget.doc')::uuid;pl uuid:=current_setting('qa.budget.plan')::uuid;v uuid;r jsonb;reading integer;scenario integer;denied boolean;
begin
 for reading in 2..3 loop
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 v:=create_procedural_vote(g,'QA budget reading '||reading,null,'mandate','gd','budget_reading'||reading,'fraction',.5,'eligible_majority',.5,true,false,doc,'advance','reject');
 perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform cast_vote_allocation(v,226,0,0);
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);r:=close_procedural_vote(v,'QA reading accepted');
 if r->>'result'<>'passed' then raise exception 'FAIL budget reading %: %',reading,r;end if;
 end loop;
 if (select status_code from formal_documents where id=doc)<>'sf' then raise exception 'FAIL budget SF route: % lawfulness %',(select status_code from formal_documents where id=doc),(select value from state_metrics where game_id=g and metric_key='lawfulness');end if;
 if (select last_plan_id from budget_simulator_state where game_id=g) is not null then raise exception 'FAIL prematurely executed';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.budget.legacy_sf'),true);
 denied:=false;begin perform advance_formal_document(doc,'advance','QA prohibited senator approval');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL senator bypassed teacher';end if;
 denied:=false;begin perform confirm_budget_sf_review(doc,true,'QA unauthorized approval');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL participant confirmed SF';end if;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 for scenario in 1..2 loop
 begin
 perform confirm_budget_sf_review(doc,false,'QA SF rejection for repeated vote');
 if (select status_code from formal_documents where id=doc)<>'sf_veto' then raise exception 'FAIL SF rejection status';end if;
 v:=create_procedural_vote(g,'QA budget SF override',null,'mandate','gd','sf_veto_override','fraction',.5,'eligible_fraction',2.0/3.0,true,false,doc,'advance','reject');
 perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);perform cast_vote_allocation(v,226,0,0);
 perform set_config('request.jwt.claim.sub',ids->>'duma_b',true);perform cast_vote_allocation(v,case when scenario=1 then 73 else 74 end,case when scenario=1 then 151 else 150 end,0);
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);r:=close_procedural_vote(v,'QA repeated budget approval');
 if scenario=1 and ((r->>'result')<>'rejected' or (select status_code from formal_documents where id=doc)<>'rejected') then raise exception 'FAIL 299 rejection: %',r;end if;
 if scenario=2 and ((r->>'result')<>'passed' or (select status_code from formal_documents where id=doc)<>'president') then raise exception 'FAIL 300 override: %',r;end if;
 raise exception using errcode='ZX001',message='rollback SF branch';
 exception when sqlstate 'ZX001' then null;end;
 end loop;
 perform confirm_budget_sf_review(doc,true,'QA teacher confirms SF review despite legacy senator role');
 if (select status_code from formal_documents where id=doc)<>'president' then raise exception 'FAIL confirmed SF approval';end if;
 denied:=false;begin perform advance_formal_document(doc,'advance','QA unauthorized teacher signature');exception when others then if sqlerrm not like '%Current stage belongs%' then raise;end if;denied:=true;end;
 if not denied then raise exception 'FAIL teacher signed as President';end if;
 perform set_config('request.jwt.claim.sub',ids->>'president',true);perform advance_formal_document(doc,'advance','QA presidential signature');
 if (select status_code from formal_documents where id=doc)<>'published' or (select status from budget_simulator_plans where id=pl)<>'published' or (select last_plan_id from budget_simulator_state where game_id=g) is distinct from pl then raise exception 'FAIL atomic enactment';end if;
 if (select count(*) from budget_simulator_ledger where game_id=g and source_key='published:'||pl::text)<>1 or (select count(*) from budget_simulator_ledger where game_id=g and source_key='fnb-oil-plan:'||pl::text)<>1 then raise exception 'FAIL unique publication/FNB ledger';end if;
 if (select metadata->>'budget_year' from formal_documents where id=doc)<>'2027' or (select (metadata#>>'{budget_snapshot,expense_items,0,amount}')::numeric from formal_documents where id=doc)<>123.45678912 then raise exception 'FAIL frozen budget programme';end if;
 perform get_budget_simulator(g);
 if (select count(*) from budget_simulator_ledger where game_id=g and source_key='published:'||pl::text)<>1 then raise exception 'FAIL repeated application';end if;
end;$publish$;
reset role;
select 'PASS: signed 2027 GP, oil above/below cutoff, surplus covers FNB, Government, three readings, no-quorum/rejected/accepted amendment, SF 299/300 and confirmation, presidential signature, atomic publication and FNB application once' as result;
rollback;
