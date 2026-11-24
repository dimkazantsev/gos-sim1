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
 from (values('teacher','teacher','Преподаватель'),('pm','student','Участник'),('minister','student','Министерство по экономической политике'),
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
 insert into game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis)
 values(g,(ids->>'minister')::uuid,'Министерство по обороне и внутренней безопасности','active',(ids->>'teacher')::uuid,(ids->>'teacher')::uuid,'QA second ministry');
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
 pm uuid:=(ids->>'pm')::uuid; minister uuid:=(ids->>'minister')::uuid;v uuid;v2 uuid;denied boolean;
begin
 perform set_config('request.jwt.claim.sub',pm::text,true);
 perform public.save_institution_meeting_document(g,13,'government','agenda','QA government agenda to test two ministry votes.',null);
 perform public.approve_institution_meeting_agenda(g,13,'government');
 v:=public.create_procedural_vote(g,'QA weighted government',null,'member','government','registered_session','fraction',.5,'present_majority',.5,true,true,null,'none','none');
 if not exists(select 1 from public.game_votes where id=v and electorate_snapshot->'weights'->>minister::text='2' and electorate_snapshot->'weights'->>pm::text='1' and electorate_snapshot->>'eligible'='3') then raise exception 'FAIL snapshot: %',(select electorate_snapshot from public.game_votes where id=v);end if;
 perform public.register_institution_session_at_stage(g,'government',13);
 perform set_config('request.jwt.claim.sub',minister::text,true);
 perform public.register_institution_session_at_stage(g,'government',13);
 denied:=false;begin perform public.cast_vote_allocation(v,3,0,0);exception when others then if sqlerrm not like 'Число голосов%' then raise;end if;denied:=true;end;
 if not denied then raise exception 'FAIL excess vote';end if;
 denied:=false;begin perform public.cast_vote_allocation(v,1,0,0);exception when others then if sqlerrm not like 'Распределите все%' then raise;end if;denied:=true;end;
 if not denied then raise exception 'FAIL incomplete vote';end if;
 perform public.cast_procedural_vote(v,'yes');
 if not exists(select 1 from public.game_ballots where vote_id=v and voter_id=minister and yes_weight=2 and weight=2) then raise exception 'FAIL double ballot';end if;
 perform set_config('request.jwt.claim.sub',pm::text,true);
 perform public.cast_procedural_vote(v,'no');
 if not exists(select 1 from public.game_votes where id=v and status='closed' and result_code='passed' and result_yes=2 and result_no=1 and result_eligible=3 and result_present=3) then raise exception 'FAIL weighted result';end if;
 v2:=public.create_procedural_vote(g,'QA split government',null,'member','government','registered_session','fraction',.5,'present_majority',.5,true,true,null,'none','none');
 perform set_config('request.jwt.claim.sub',minister::text,true);
 perform public.cast_vote_allocation(v2,1,1,0);
 perform set_config('request.jwt.claim.sub',pm::text,true);
 perform public.cast_procedural_vote(v2,'no');
 if not exists(select 1 from public.game_votes where id=v2 and status='closed' and result_code='rejected' and result_yes=1 and result_no=2) then raise exception 'FAIL split result';end if;
end;$test$;
reset role;
select 'PASS two active ministries, profile not duplicated, two votes, split, excess and incomplete denied, weighted quorum and automatic closure' result;
rollback;
