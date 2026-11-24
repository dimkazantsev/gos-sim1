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
set local role authenticated;
do $test$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;
 pm uuid:=(ids->>'pm')::uuid; chair uuid:=(ids->>'duma_a')::uuid; minister uuid:=(ids->>'minister')::uuid; t uuid:=(ids->>'teacher')::uuid;
 ga uuid; da uuid; v uuid; v2 uuid; denied boolean;
begin
 perform set_config('request.jwt.claim.sub',pm::text,true);
 ga:=public.save_institution_meeting_document(g,13,'government','agenda','QA signed government agenda for a scoped vote.',null);
 perform public.approve_institution_meeting_agenda(g,13,'government');
 perform set_config('request.jwt.claim.sub',chair::text,true);
 da:=public.save_institution_meeting_document(g,13,'gd','agenda','QA signed Duma agenda for a scoped vote.',null);
 perform public.approve_institution_meeting_agenda(g,13,'gd');
 perform set_config('request.jwt.claim.sub',pm::text,true);
 v:=public.create_procedural_vote(g,'QA government agenda',null,'member','government','registered_session','fraction',.5,'present_majority',.5,true,true,ga,'none','none');
 if not exists(select 1 from public.game_votes where id=v and formal_document_id=ga and formal_step_code='reference') then raise exception 'FAIL PM create with agenda';end if;
 v2:=public.create_procedural_vote(g,'QA independent government vote',null,'member','government','registered_session','fraction',.5,'present_majority',.5,true,true,null,'none','none');
 denied:=false;begin perform public.attach_vote_reference_document(v2,da);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL cross-organ attach';end if;
 denied:=false;begin perform public.create_procedural_vote(g,'QA unauthorized GD',null,'mandate','gd','registered_session','fraction',.5,'eligible_majority',.5,true,false,null,'none','none');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL cross-organ create';end if;
 perform set_config('request.jwt.claim.sub',minister::text,true);
 denied:=false;begin perform public.attach_vote_reference_document(v2,ga);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'FAIL ordinary minister attach';end if;
 perform set_config('request.jwt.claim.sub',chair::text,true);
 v2:=public.create_procedural_vote(g,'QA Duma agenda',null,'mandate','gd','registered_session','fraction',.5,'eligible_majority',.5,true,false,null,'none','none');
 perform public.attach_vote_reference_document(v2,da);
 if not exists(select 1 from public.game_votes where id=v2 and formal_document_id=da and formal_step_code='reference') then raise exception 'FAIL Duma attach agenda';end if;
 perform set_config('request.jwt.claim.sub',pm::text,true);
 perform public.register_institution_session_at_stage(g,'government',13);
 perform set_config('request.jwt.claim.sub',minister::text,true);
 perform public.register_institution_session_at_stage(g,'government',13);
 perform set_config('request.jwt.claim.sub',pm::text,true);
 perform public.cast_procedural_vote(v,'yes');
 perform set_config('request.jwt.claim.sub',minister::text,true);
 perform public.cast_procedural_vote(v,'yes');
 perform set_config('request.jwt.claim.sub',pm::text,true);
 if (select status from public.game_votes where id=v)='open' then perform public.close_procedural_vote(v,'QA close');end if;
 if (select result_code from public.game_votes where id=v)<>'passed' then raise exception 'FAIL PM vote completion';end if;
 if (select status_code from public.formal_documents where id=ga)<>'published' or (select status_code from public.formal_documents where id=da)<>'published' then raise exception 'FAIL agenda status changed';end if;
 perform set_config('qa.chair.gd_agenda',da::text,true);
end;$test$;
reset role;
do $permission$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;
begin
 perform set_config('request.jwt.claim.sub',ids->>'duma_a',true);
 if not private.can_close_procedural_vote(g,(ids->>'duma_a')::uuid,'gd',current_setting('qa.chair.gd_agenda')::uuid) then raise exception 'FAIL Duma close authority';end if;
end;$permission$;
select 'PASS: chair creates and attaches signed agenda, cross-organ/minister denied, Government vote completed without changing agenda, Duma close authority' result;
rollback;
