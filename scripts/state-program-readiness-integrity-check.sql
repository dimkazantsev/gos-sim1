-- Standalone subset of state-program-signature-check.sql; regenerated from its canonical fixture.
-- Run only after 20261008150918_structured_program_expenses_signature.sql.
-- Self-contained fictional users/classrooms; no existing owner or classroom is used.
-- All fixtures, temporary helpers and attempted writes are rolled back.
-- Government-status checks near the end exercise only the synchronization trigger;
-- they do not claim to run a government vote or approve budget appropriations.
begin;

create function pg_temp.sp_assert(ok boolean,label text) returns void
language plpgsql security invoker as $helper$
begin
 if ok is distinct from true then raise exception 'FAIL: %',label;end if;
end;
$helper$;

create function pg_temp.sp_as_user(v_user_id uuid) returns void
language plpgsql security invoker as $helper$
begin
 perform set_config('request.jwt.claim.sub',v_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user_id,'role','authenticated')::text,true);
end;
$helper$;

create function pg_temp.sp_expect_rejection(statement text,label text) returns void
language plpgsql security invoker as $helper$
declare rejected boolean:=false;error_state text;
begin
 begin
  execute statement;
  -- Undo an unexpectedly successful write before raising the assertion failure.
  raise exception using errcode='ZX001',message='QA unexpected success';
 exception
  when sqlstate 'ZX001' then rejected:=false;
  when others then
   get stacked diagnostics error_state=returned_sqlstate;
   -- Only data validation, deliberate rule errors and permission denials count.
   -- Missing APIs, ambiguous identifiers and SQL bugs are assertion failures.
   if error_state not in ('P0001','42501') and left(error_state,2) not in ('22','23') then raise;end if;
   rejected:=true;
 end;
 perform pg_temp.sp_assert(rejected,label||' must be rejected');
end;
$helper$;

create function pg_temp.sp_snapshot(v_program_id uuid) returns jsonb
language sql security invoker as $helper$
 select jsonb_build_object(
  'passport',(select to_jsonb(p) from public.state_programs p where p.id=v_program_id),
  'goals',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]'::jsonb) from public.state_program_goals g where g.program_id=v_program_id),
  'components',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from public.state_program_components c where c.program_id=v_program_id),
  'expenses',(select coalesce(jsonb_agg(to_jsonb(e) order by e.position,e.id),'[]'::jsonb) from public.state_program_expenses e where e.program_id=v_program_id),
  'years',(select coalesce(jsonb_agg(to_jsonb(y) order by y.budget_year,y.id),'[]'::jsonb) from public.state_program_budget_years y where y.program_id=v_program_id),
  'commitments',(select coalesce(jsonb_agg(to_jsonb(c) order by c.budget_year),'[]'::jsonb) from public.state_program_budget_commitments c where c.program_id=v_program_id),
  'posts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from public.political_posts p where p.source_key='state_program_signed:'||v_program_id)
 );
$helper$;

create function pg_temp.sp_game_snapshot(p_game_id uuid) returns jsonb
language sql security invoker as $helper$
 select coalesce(jsonb_agg(pg_temp.sp_snapshot(p.id) order by p.id),'[]'::jsonb)
 from public.state_programs p where p.game_id=p_game_id;
$helper$;

create function pg_temp.sp_legacy_save(game_id uuid,v_program_id uuid,minister_id uuid,title text default 'QA forbidden passport change') returns uuid
language sql security invoker as $helper$
 select public.save_state_program(game_id,v_program_id,title,'QA ministry',minister_id,null,
  'QA measurable national goal','2026-01-01','2028-12-31',900719925474100.22,
  'QA measurable results for this fictional classroom');
$helper$;

do $fixture$
declare
 g uuid:=gen_random_uuid();other_game uuid:=gen_random_uuid();teacher_id uuid:=gen_random_uuid();
 creator_id uuid:=gen_random_uuid();minister_id uuid:=gen_random_uuid();pm_id uuid:=gen_random_uuid();viewer_id uuid:=gen_random_uuid();
 deputy_id uuid:=gen_random_uuid();office_pm_id uuid:=gen_random_uuid();
 observer_id uuid:=gen_random_uuid();archived_id uuid:=gen_random_uuid();removed_id uuid:=gen_random_uuid();outsider_id uuid:=gen_random_uuid();
 v_user_id uuid;v_program_id uuid;goal_id uuid;component_id uuid;year_id uuid;address_id uuid;priority_id uuid;
 owners jsonb:='[]'::jsonb;payload jsonb;
begin
 foreach v_user_id in array array[teacher_id,creator_id,minister_id,pm_id,viewer_id,deputy_id,office_pm_id,observer_id,archived_id,removed_id,outsider_id] loop
  insert into auth.users(id,aud,role) values(v_user_id,'authenticated','authenticated');
 end loop;
 perform pg_temp.sp_as_user(teacher_id);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA structured state programs','QA'||substr(replace(g::text,'-',''),1,12),teacher_id,'running',11,true),
       (other_game,'QA other program classroom','QA'||substr(replace(other_game::text,'-',''),1,12),teacher_id,'running',11,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title)
 values(g,teacher_id,'QA fictional teacher','teacher','Преподаватель'),
       (g,creator_id,'QA program author','student','Министр развития'),
       (g,minister_id,'QA responsible minister','student','Министр социальной политики'),
       (g,pm_id,'QA Prime Minister','student','Председатель Правительства Российской Федерации'),
       (g,deputy_id,'QA deputy Prime Minister','student','Заместитель Председателя Правительства РФ — Министр экономики'),
       (g,office_pm_id,'QA PM through formal office','student','Участник'),
       (g,viewer_id,'QA ordinary participant','student','Участник'),
       (g,observer_id,'QA observer with misleading title','observer','Председатель Правительства Российской Федерации'),
       (g,archived_id,'QA archived Prime Minister','student','Председатель Правительства Российской Федерации'),
       (g,removed_id,'QA removed Prime Minister','student','Председатель Правительства Российской Федерации'),
       (other_game,teacher_id,'QA fictional teacher','teacher','Преподаватель'),
       (other_game,creator_id,'QA program author','student','Министр развития'),
       (other_game,outsider_id,'QA other classroom Prime Minister','student','Председатель Правительства Российской Федерации');
 insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 values(g,office_pm_id,'Председатель Правительства Российской Федерации','active',teacher_id,teacher_id,'QA fictional formal-office fixture',true);
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 select f.game_id,n,'QA stage '||n,'Учебная процедура','QA',case when n in (10,11) then 'open' else 'locked' end
 from (values(g),(other_game)) f(game_id),generate_series(1,16)n;

 -- A real foreign priority proves game scoping, rather than a nonexistent UUID.
 insert into public.presidential_addresses(game_id,title,body_text,status,created_by,published_at)
 values(other_game,'QA foreign presidential address','QA published policy','published',teacher_id,now()) returning id into address_id;
 insert into public.presidential_priorities(game_id,address_id,priority_no,title)
 values(other_game,address_id,1,'QA foreign priority') returning id into priority_id;

 -- Former ownership must not let an inactive account use the old child RPCs.
 -- Insert while the fictional teacher is active; later requests use each owner.
 foreach v_user_id in array array[observer_id,archived_id,removed_id,outsider_id] loop
  insert into public.state_programs(game_id,title,responsible_ministry,responsible_minister_id,created_by,start_date,end_date,total_budget,participants,national_goal,expected_results)
  values(g,'QA inactive owner '||v_user_id,'QA ministry',v_user_id,v_user_id,'2026-01-01','2028-12-31',100,'QA participants','QA national goal','QA measurable results')
  returning id into v_program_id;
  insert into public.state_program_goals(program_id,game_id,goal_text,indicator_name,unit,baseline_value,target_value,target_year)
  values(v_program_id,g,'QA preexisting goal','QA indicator','units',0,10,2028) returning id into goal_id;
  insert into public.state_program_components(program_id,game_id,direction_no,direction_title,component_kind,title,goal_text,start_date,end_date,budget)
  values(v_program_id,g,1,'QA direction','measure','QA existing measure','QA measurable purpose','2026-01-01','2028-12-31',100) returning id into component_id;
  insert into public.state_program_budget_years(program_id,game_id,budget_year,amount,created_by)
  values(v_program_id,g,2026,100,teacher_id) returning id into year_id;
  owners:=owners||jsonb_build_array(jsonb_build_object('user_id',v_user_id,'program_id',v_program_id,'goal_id',goal_id,'component_id',component_id,'year_id',year_id));
 end loop;
 update public.game_members set roster_archived_at=now() where game_id=g and game_members.user_id=archived_id;
 delete from public.game_members where game_id=g and game_members.user_id=removed_id;

 payload:=jsonb_build_object(
  'title','QA exact-cent state program','responsible_ministry','QA ministry',
  'responsible_minister_id',minister_id,'curator_id',viewer_id,'national_goal','QA measurable national goal',
  'participants','QA ministry and fictional implementing organizations','start_date','2026-01-01','end_date','2028-12-31',
  'expected_results','QA measurable results for this fictional classroom',
  'goals',jsonb_build_array(jsonb_build_object('goal_text','QA improve public service','indicator_name','QA service availability','unit','percent','baseline_value','10','target_value','90','target_year','2028')),
  'components','[
   {"direction_no":1,"direction_title":"QA access","component_kind":"project","title":"QA access project","goal_text":"QA improve service access","start_date":"2026-01-01","end_date":"2028-12-31"},
   {"direction_no":2,"direction_title":"QA quality","component_kind":"target_program","title":"QA quality program","goal_text":"QA improve service quality","start_date":"2026-01-01","end_date":"2028-12-31"},
   {"direction_no":3,"direction_title":"QA staffing","component_kind":"measure","title":"QA staffing measure","goal_text":"QA improve staff availability","start_date":"2026-01-01","end_date":"2028-12-31"}
  ]'::jsonb,
  'expenses','[
   {"component_no":1,"indicator_name":"QA tenth-ruble expense","justification":"QA first exact decimal allocation","budget_year":2026,"amount":"0.1"},
   {"component_no":1,"indicator_name":"QA fifth-ruble expense","justification":"QA second exact decimal allocation","budget_year":2026,"amount":"0.2"},
   {"component_no":2,"indicator_name":"QA large cent allocation","justification":"QA exact cents beyond integer-safe JavaScript kopecks","budget_year":2027,"amount":"900719925474099.91"},
   {"component_no":3,"indicator_name":"QA single-kopeck expense","justification":"QA third direction exact decimal allocation","budget_year":2027,"amount":"0.01"}
  ]'::jsonb
 );
 perform set_config('qa.sp.game',g::text,true);perform set_config('qa.sp.other_game',other_game::text,true);
 perform set_config('qa.sp.users',jsonb_build_object('teacher',teacher_id,'creator',creator_id,'minister',minister_id,'pm',pm_id,'deputy',deputy_id,'office_pm',office_pm_id,'viewer',viewer_id,'observer',observer_id,'archived',archived_id,'removed',removed_id,'outsider',outsider_id)::text,true);
 perform set_config('qa.sp.owners',owners::text,true);perform set_config('qa.sp.payload',payload::text,true);
 perform set_config('qa.sp.foreign_priority',priority_id::text,true);perform set_config('qa.sp.checks','{}',true);
end;
$fixture$;

set local role authenticated;
do $focused_program_setup$
declare g uuid:=current_setting('qa.sp.game')::uuid;users jsonb:=current_setting('qa.sp.users')::jsonb;v_program_id uuid;
begin
 perform pg_temp.sp_as_user((users->>'creator')::uuid);
 v_program_id:=public.save_state_program_draft(g,null,current_setting('qa.sp.payload')::jsonb,false);
 perform set_config('qa.sp.program',v_program_id::text,true);
 perform pg_temp.sp_assert((public.get_state_program_readiness(v_program_id)->>'ready')::boolean,'focused complete draft is ready');
end;
$focused_program_setup$;

do $focused_signature_setup$
declare users jsonb:=current_setting('qa.sp.users')::jsonb;v_program_id uuid:=current_setting('qa.sp.program')::uuid;
begin
 perform pg_temp.sp_as_user((users->>'creator')::uuid);perform public.advance_state_program(v_program_id,'submit_minister');
 perform pg_temp.sp_as_user((users->>'minister')::uuid);perform public.advance_state_program(v_program_id,'minister_approve');
 perform pg_temp.sp_as_user((users->>'pm')::uuid);perform public.advance_state_program(v_program_id,'pm_ready');
 perform pg_temp.sp_assert(exists(select 1 from public.state_programs where id=v_program_id and signed_by=(users->>'pm')::uuid and signed_at is not null),'focused PM signature exists');
 perform set_config('qa.sp.signed_snapshot',pg_temp.sp_snapshot(v_program_id)::text,true);
end;
$focused_signature_setup$;

do $annual_redistribution$
declare
 g uuid:=current_setting('qa.sp.game')::uuid;users jsonb:=current_setting('qa.sp.users')::jsonb;
 payload jsonb:=current_setting('qa.sp.payload')::jsonb;v_program_id uuid;before_row jsonb;variant record;programs jsonb:='[]'::jsonb;
begin
 perform pg_temp.sp_as_user((users->>'creator')::uuid);
 for variant in select * from (values ('ten kopecks',0.10::numeric),('one kopeck',0.01::numeric)) v(label,shift) loop
 v_program_id:=public.save_state_program_draft(g,null,jsonb_set(payload,'{title}',to_jsonb('QA annual redistribution '||variant.label)),false);
 perform public.set_state_program_budget_year(v_program_id,2027,900719925474099.92-variant.shift);
 perform public.set_state_program_budget_year(v_program_id,2026,0.30+variant.shift);
 perform pg_temp.sp_assert((select sum(amount) from public.state_program_budget_years y where y.program_id=v_program_id)=900719925474100.22,
  'legacy annual redistribution preserves the overall sum');
 perform pg_temp.sp_assert((public.get_state_program_readiness(v_program_id)->>'ready')::boolean=false,
  'equal total cannot hide annual/expense disagreement: '||variant.label);
 before_row:=pg_temp.sp_snapshot(v_program_id);
 perform pg_temp.sp_expect_rejection(format('select public.advance_state_program(%L::uuid,%L)',v_program_id,'submit_minister'),'redistributed annual amounts cannot be confirmed');
 perform pg_temp.sp_assert(pg_temp.sp_snapshot(v_program_id)=before_row,'failed redistribution confirmation preserves the draft');
 programs:=programs||jsonb_build_array(jsonb_build_object('id',v_program_id,'label',variant.label));
 end loop;
 perform set_config('qa.sp.annual_programs',programs::text,true);
end;
$annual_redistribution$;

reset role;
do $historical_bad_data_fixture$
declare
 g uuid:=current_setting('qa.sp.game')::uuid;users jsonb:=current_setting('qa.sp.users')::jsonb;
 payload jsonb:=current_setting('qa.sp.payload')::jsonb;v_program_id uuid;kind text;bad_programs jsonb:='[]'::jsonb;annual_program jsonb;
begin
 perform pg_temp.sp_as_user((users->>'teacher')::uuid);
 -- Fixture-only state represents a previously reviewed program. Actual signing
 -- must independently re-check readiness; this is not a minister approval test.
 for annual_program in select value from jsonb_array_elements(current_setting('qa.sp.annual_programs')::jsonb) loop
  update public.state_programs set status='pm_review' where id=(annual_program->>'id')::uuid;
 end loop;
 foreach kind in array array['NaN','year9999'] loop
  v_program_id:=public.save_state_program_draft(g,null,jsonb_set(payload,'{title}',to_jsonb('QA legacy poisoned goal '||kind)),false);
  update public.state_programs set form_version=1 where id=v_program_id;
  -- Persisted legacy goal fields had no finite-number/year constraints.
  insert into public.state_program_goals(program_id,game_id,goal_text,indicator_name,unit,baseline_value,target_value,target_year)
  values(v_program_id,g,'QA historical invalid goal','QA historical indicator','units',
   case when kind='NaN' then 'NaN'::numeric else 0 end,10,case when kind='year9999' then 9999 else 2028 end);
  perform pg_temp.sp_assert((public.get_state_program_readiness(v_program_id)->>'ready')::boolean=false,'legacy invalid goal blocks readiness: '||kind);
  update public.state_programs set status='pm_review' where id=v_program_id;
  bad_programs:=bad_programs||jsonb_build_array(jsonb_build_object('id',v_program_id,'label',kind));
 end loop;
 perform set_config('qa.sp.bad_legacy_programs',bad_programs::text,true);
end;
$historical_bad_data_fixture$;

set local role authenticated;
do $signature_readiness_checks$
declare users jsonb:=current_setting('qa.sp.users')::jsonb;v_program_id uuid;bad_program jsonb;before_row jsonb;
begin
 perform pg_temp.sp_as_user((users->>'pm')::uuid);
 for bad_program in select value from jsonb_array_elements(current_setting('qa.sp.annual_programs')::jsonb) loop
  v_program_id:=(bad_program->>'id')::uuid;before_row:=pg_temp.sp_snapshot(v_program_id);
  perform pg_temp.sp_expect_rejection(format('select public.advance_state_program(%L::uuid,%L)',v_program_id,'pm_ready'),'PM rechecks annual row agreement: '||(bad_program->>'label'));
  perform pg_temp.sp_assert(pg_temp.sp_snapshot(v_program_id)=before_row,'failed annual-integrity signature has no partial publication');
 end loop;
 for bad_program in select value from jsonb_array_elements(current_setting('qa.sp.bad_legacy_programs')::jsonb) loop
  v_program_id:=(bad_program->>'id')::uuid;before_row:=pg_temp.sp_snapshot(v_program_id);
  perform pg_temp.sp_assert((public.get_state_program_readiness(v_program_id)->>'ready')::boolean=false,'legacy readiness remains false at PM review: '||(bad_program->>'label'));
  perform pg_temp.sp_expect_rejection(format('select public.advance_state_program(%L::uuid,%L)',v_program_id,'pm_ready'),'PM signature blocks historical goal '||(bad_program->>'label'));
  perform pg_temp.sp_assert(pg_temp.sp_snapshot(v_program_id)=before_row,'invalid historical goal cannot cause a partial signature');
 end loop;
 perform set_config('qa.sp.checks',(current_setting('qa.sp.checks')::jsonb||jsonb_build_object('legacy_annual_redistribution_rechecked_before_signature','PASS','one_kopeck_annual_redistribution_blocks_submission_and_signature','PASS','legacy_NaN_and_out_of_range_goal_year_block_signature','PASS'))::text,true);
end;
$signature_readiness_checks$;

reset role;
do $independent_procedure_status_trigger$
declare
 g uuid:=current_setting('qa.sp.game')::uuid;v_program_id uuid:=current_setting('qa.sp.program')::uuid;
 users jsonb:=current_setting('qa.sp.users')::jsonb;status_pair record;before_posts jsonb;
begin
 perform pg_temp.sp_as_user((users->>'teacher')::uuid);
 before_posts:=pg_temp.sp_snapshot(v_program_id)->'posts';
 -- These direct status changes are isolated postgres fixture controls. They
 -- simulate independent government outcomes only to test commitment syncing.
 -- They do not execute a government vote, create an NPA or adopt a budget.
 for status_pair in select * from (values
  ('government_vote','planned'),('adopted','approved'),('rejected','rejected'),('ready','planned')
 ) v(program_status,commitment_status) loop
  update public.state_programs set status=status_pair.program_status where id=v_program_id;
  perform pg_temp.sp_assert((select count(*) from public.state_program_budget_commitments c where c.program_id=v_program_id and c.status=status_pair.commitment_status)=3,
   'independent government status synchronizes commitments: '||status_pair.program_status);
  perform pg_temp.sp_assert((public.get_signed_state_program_budget(g)->0->>'program_status')=status_pair.program_status,
   'budget RPC reflects independent government status');
  perform pg_temp.sp_assert(pg_temp.sp_snapshot(v_program_id)->'posts'=before_posts,'government outcome does not duplicate or rewrite the signed publication');
 end loop;
 perform pg_temp.sp_assert(pg_temp.sp_snapshot(v_program_id)=current_setting('qa.sp.signed_snapshot')::jsonb,'restoring fixture status preserves signature, content and planned commitments exactly');
 if to_regclass('public.budget_simulator_ledger') is not null then
  perform pg_temp.sp_assert(not exists(select 1 from public.budget_simulator_ledger where game_id=g),'signature and status sync do not execute budget spending');
 end if;
 perform pg_temp.sp_assert(not has_table_privilege('authenticated','public.state_program_expenses','INSERT')
  and not has_table_privilege('authenticated','public.state_program_budget_commitments','UPDATE')
  and not has_function_privilege('anon','public.save_state_program_draft(uuid,uuid,jsonb,boolean)','EXECUTE')
  and not has_function_privilege('authenticated','private.publish_signed_state_program(uuid,uuid)','EXECUTE'),
  'public roles cannot write expense/commitment tables or invoke the signature helper directly');
 perform set_config('qa.sp.checks',(current_setting('qa.sp.checks')::jsonb||jsonb_build_object('independent_government_status_sync_trigger_only','PASS','signature_has_no_budget_execution','PASS','privileged_helpers_and_table_writes_revoked','PASS'))::text,true);
end;
$independent_procedure_status_trigger$;

select current_setting('qa.sp.checks')::jsonb as checks,
 'Fictional fixtures only; government-status test covers the sync trigger, not government voting or budget adoption; all data rolled back' as scope;
rollback;
