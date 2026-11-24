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
 select g,n,'QA stage '||n,'Учебная процедура','QA',case when n in (1,11,12,13) then 'open' else 'locked' end from generate_series(1,16)n
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
do $programs$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;t uuid:=(ids->>'teacher')::uuid;m uuid:=(ids->>'minister')::uuid;
 a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();d uuid;s uuid;
begin
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into public.state_programs(id,game_id,title,responsible_ministry,responsible_minister_id,created_by,status) values
 (a,g,'QA first programme','Министерство по экономической политике',m,m,'ready'),(b,g,'QA second programme','Министерство по экономической политике',m,m,'ready');
 select id into s from public.government_sessions where game_id=g and stage_no=11 and status='draft';
 if (select count(*) from public.government_program_agenda where session_id=s)<>2 then raise exception 'FAIL auto inclusion';end if;
 for d in select unnest(array[a,b]) loop
  insert into public.formal_documents(game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
  values(g,10,'QA-'||d::text,'QA passport','state_program','ministry','QA ministry',m,'QA passport content','government_act',private.formal_workflow('government_act'),0,'draft','Draft','author',jsonb_build_object('state_program_id',d,'auto_synced',true,'document_kind','stage10_state_program'));
  perform private.sync_stage11_program_registry_status(d);
 end loop;
 perform set_config('qa.gp.a',a::text,true);perform set_config('qa.gp.b',b::text,true);perform set_config('qa.gp.s',s::text,true);
end;$programs$;
set local role authenticated;
do $test$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;pm uuid:=(ids->>'pm')::uuid;m uuid:=(ids->>'minister')::uuid;
 a uuid:=current_setting('qa.gp.a')::uuid;b uuid:=current_setting('qa.gp.b')::uuid;s uuid:=current_setting('qa.gp.s')::uuid;ia uuid;ib uuid;v uuid;oldv uuid;denied boolean;
begin
 perform set_config('request.jwt.claim.sub',pm::text,true);
 select id into ia from public.government_program_agenda where session_id=s and program_id=a;
 select id into ib from public.government_program_agenda where session_id=s and program_id=b;
 if (select count(*) from public.formal_documents where game_id=g and doc_type='state_program' and status_code='agenda')<>2 then raise exception 'FAIL registry agenda';end if;
 perform public.sign_institution_meeting_agenda((select agenda_document_id from public.government_sessions where id=s));
 perform public.open_government_session(s);
 perform public.start_government_program_report(ia);
 perform public.request_state_program_revision(a,'QA return before vote with reason');
 if (select status from public.government_program_agenda where id=ia)<>'pending' then raise exception 'FAIL stuck presentation';end if;
 perform public.start_government_program_report(ib);
 perform public.close_government_program_questions(ib);
 v:=public.open_program_vote_from_agenda(ib);
 perform public.register_institution_session_at_stage(g,'government',11);
 perform set_config('request.jwt.claim.sub',m::text,true);perform public.register_institution_session_at_stage(g,'government',11);perform public.cast_procedural_vote(v,'yes');
 perform set_config('request.jwt.claim.sub',pm::text,true);perform public.cast_procedural_vote(v,'yes');
 if (select status from public.state_programs where id=b)<>'adopted' then raise exception 'FAIL adoption';end if;
 if not exists(select 1 from public.formal_documents where game_id=g and doc_type='state_program' and metadata->>'state_program_id'=b::text and status_code='adopted') then raise exception 'FAIL adopted registry';end if;
 oldv:=v;
 perform public.request_state_program_revision(b,'QA return after passed vote for a new revision');
 if not exists(select 1 from public.state_programs where id=b and status='revision' and government_vote_id is null and signed_at is null) then raise exception 'FAIL return';end if;
 if not exists(select 1 from public.game_votes where id=oldv and status='closed' and result_code='passed') then raise exception 'FAIL history';end if;
 if not exists(select 1 from public.formal_documents where game_id=g and doc_type='government_resolution' and metadata->>'government_vote_id'=oldv::text and status_code='superseded') then raise exception 'FAIL superseded resolution';end if;
 denied:=false;begin perform public.sign_adopted_state_program(b);exception when others then if sqlerrm not like 'Подпись доступна%' then raise;end if;denied:=true;end;
 if not denied then raise exception 'FAIL signed returned programme';end if;
 perform set_config('request.jwt.claim.sub',m::text,true);
 perform public.save_state_program(g,b,'QA revised programme','Министерство по экономической политике',m,null,null,null,null,0,null);
end;$test$;
reset role;
-- A prepared, reapproved revision is represented by ready in the isolated fixture; the Stage 10 readiness validator itself is unchanged.
update public.state_programs set status='ready' where id=current_setting('qa.gp.b')::uuid;
set local role authenticated;
do $again$
declare g uuid:=current_setting('qa.budget.game')::uuid;ids jsonb:=current_setting('qa.budget.users')::jsonb;pm uuid:=(ids->>'pm')::uuid;m uuid:=(ids->>'minister')::uuid;b uuid:=current_setting('qa.gp.b')::uuid;s uuid:=current_setting('qa.gp.s')::uuid;ib uuid;v uuid;
begin
 perform set_config('request.jwt.claim.sub',pm::text,true);
 select id into ib from public.government_program_agenda where session_id=s and program_id=b;
 perform public.start_government_program_report(ib);
 perform public.close_government_program_questions(ib);v:=public.open_program_vote_from_agenda(ib);
 perform set_config('request.jwt.claim.sub',m::text,true);perform public.cast_procedural_vote(v,'yes');
 perform set_config('request.jwt.claim.sub',pm::text,true);perform public.cast_procedural_vote(v,'yes');
 perform public.sign_adopted_state_program(b);
 if not exists(select 1 from public.state_programs where id=b and signed_at is not null and status='adopted' and government_vote_id=v) then raise exception 'FAIL signed revision';end if;
 if not exists(select 1 from public.formal_documents where game_id=g and doc_type='state_program' and metadata->>'state_program_id'=b::text and status_code='published') then raise exception 'FAIL signed registry';end if;
 if (select count(*) from public.formal_documents where game_id=g and doc_type='government_resolution' and metadata->>'state_program_id'=b::text)<>2 then raise exception 'FAIL second resolution';end if;
end;$again$;
reset role;
rollback;
select 'PASS: auto agenda, registry, releasing revised active report, accepted vote, return after acceptance, old vote retained, edit, new vote, signature' result;
