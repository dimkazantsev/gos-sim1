begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
do $seed$
declare g uuid:=gen_random_uuid();party uuid:=gen_random_uuid();ids jsonb:='{}';k text;u uuid;b jsonb;
begin
 foreach k in array array['teacher','pm','minister','duma_a','duma_b'] loop
  u:=gen_random_uuid();insert into auth.users(id,aud,role) values(u,'authenticated','authenticated');ids:=ids||jsonb_build_object(k,u);
 end loop;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 insert into games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA standalone Budget II failures','QA'||substr(replace(g::text,'-',''),1,12),(ids->>'teacher')::uuid,'running',13,true);
 insert into game_members(game_id,user_id,full_name,kind,role_title,group_name)
 select g,(ids->>v.k)::uuid,'QA '||v.k,v.kind::public.member_kind,v.title,'QA'
 from (values('teacher','teacher','Преподаватель'),('pm','student','Участник'),('minister','student','Министр финансов'),
 ('duma_a','student','Депутат Государственной Думы'),('duma_b','student','Депутат Государственной Думы'))v(k,kind,title);
 insert into game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 values(g,(ids->>'pm')::uuid,'Председатель Правительства Российской Федерации','active',(ids->>'teacher')::uuid,(ids->>'teacher')::uuid,'QA formal primary PM',true);
 insert into game_stages(game_id,stage_no,title,mode,summary,status)
 select g,n,'QA stage '||n,'Учебная процедура','QA',case when n=13 then 'open' else 'locked' end from generate_series(1,16)n
 on conflict(game_id,stage_no) do nothing;
 insert into state_metrics(game_id,metric_key,label,value,unit,is_public,group_key,min_value,max_value,sort_order)
 values(g,'economy','QA economy',50,'%',true,'QA',0,100,1),(g,'public_trust','QA trust',50,'%',true,'QA',0,100,2)
 on conflict(game_id,metric_key) do nothing;
 insert into game_parties(id,game_id,name,mandates,leader_user_id) values(party,g,'QA Duma',450,(ids->>'duma_a')::uuid);
 update game_members set team='QA Duma' where game_id=g and user_id in ((ids->>'duma_a')::uuid,(ids->>'duma_b')::uuid);
 select data into b from private.budget_baseline where year=2026;
 perform set_config('qa.budget.game',g::text,true);perform set_config('qa.budget.users',ids::text,true);
 perform set_config('qa.budget.party',party::text,true);
 perform set_config('qa.budget.draft',jsonb_build_object('title','QA standalone Budget','note','QA balanced baseline budget prepared to test selected second-reading amendment decisions.',
 'income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,'revenue_adjustments','{}'::jsonb,'financing',b->'financing',
 'terms','{"ofz_fixed":60,"ofz_float":60,"bank_credit":12,"external":60}'::jsonb,'transfer_ids','[]'::jsonb,'expense_items','[]'::jsonb)::text,true);
end;$seed$;
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
 vote:=create_procedural_vote(g,'QA actual Government',null,'member','government','budget_government_submission','fraction',.5,'present_majority',.5,true,true,doc,'advance','return_author');
 perform register_institution_session_at_stage(g,'government',13);perform cast_procedural_vote(vote,'yes');
 perform set_config('request.jwt.claim.sub',ids->>'minister',true);perform register_institution_session_at_stage(g,'government',13);perform cast_procedural_vote(vote,'yes');
 perform set_config('request.jwt.claim.sub',ids->>'pm',true);r:=close_budget_government_vote(vote,'QA registered Government approved');
 if r->>'result'<>'passed' then raise exception 'FAIL prerequisite Government %',r;end if;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);perform advance_formal_document(doc,'advance','QA Duma staff registration');
 perform save_budget_preliminary_review(doc,true,true,true,'QA committee examined calculations and all mandatory budget annexes','accept','QA reviewed');
 perform advance_formal_document(doc,'advance','QA complete committee package');perform advance_formal_document(doc,'advance','QA council scheduled I reading');
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
 denied:=false;begin perform advance_formal_document(doc,'advance','QA attempt whole II with pending amendment');
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
 denied:=false;begin perform advance_formal_document(doc,'advance','QA attempt II with restored pending amendment');
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
 perform advance_formal_document(doc,'advance','QA settled table enters mandatory II reading');
 if (select status_code from formal_documents where id=doc)<>'reading2' then raise exception 'FAIL resolved table gate';end if;
end;$failure_branches$;
select jsonb_build_object('pending_II_gate','PASS','no_quorum_restoration_retry','PASS','rejected225_unchanged_law_plan','PASS','fresh226_exact_acceptance','PASS') as checks;
rollback;
