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

do $review_and_signature$
declare
 g uuid:=current_setting('qa.sp.game')::uuid;v_program_id uuid:=current_setting('qa.sp.program')::uuid;
 users jsonb:=current_setting('qa.sp.users')::jsonb;payload jsonb:=current_setting('qa.sp.payload')::jsonb;
 actor text;before_row jsonb;signed_row jsonb;budget jsonb;entry jsonb;goal_id uuid;component_id uuid;year_id uuid;statement text;
begin
 perform pg_temp.sp_as_user((users->>'creator')::uuid);
 perform pg_temp.sp_assert(public.save_state_program_draft(g,v_program_id,payload,true)=v_program_id,'confirmation retains the same program');
 perform pg_temp.sp_assert((select status from public.state_programs where id=v_program_id)='minister_review'
  and public.get_signed_state_program_budget(g)='[]'::jsonb,'author confirmation submits to minister without publication');
 before_row:=pg_temp.sp_snapshot(v_program_id);
 perform pg_temp.sp_expect_rejection(format('select public.advance_state_program(%L::uuid,%L)',v_program_id,'minister_approve'),'creator is not the assigned reviewing minister');
 perform pg_temp.sp_assert(pg_temp.sp_snapshot(v_program_id)=before_row,'unauthorized minister approval is atomic');
 perform pg_temp.sp_as_user((users->>'minister')::uuid);
 perform public.advance_state_program(v_program_id,'minister_approve');
 perform pg_temp.sp_assert((select status from public.state_programs where id=v_program_id)='pm_review','responsible minister passes the form to PM');
 before_row:=pg_temp.sp_snapshot(v_program_id);
 foreach actor in array array['creator','minister','viewer','deputy','outsider','observer','archived','removed'] loop
  perform pg_temp.sp_as_user((users->>actor)::uuid);
  perform pg_temp.sp_expect_rejection(format('select public.advance_state_program(%L::uuid,%L)',v_program_id,'pm_ready'),actor||' cannot sign a ready reviewed program');
 end loop;
 perform pg_temp.sp_as_user((users->>'teacher')::uuid);
 perform pg_temp.sp_assert(pg_temp.sp_snapshot(v_program_id)=before_row,'failed signatures leave no publication, commitment or state change');
 perform pg_temp.sp_as_user((users->>'pm')::uuid);
 perform public.advance_state_program(v_program_id,'pm_ready');
 perform pg_temp.sp_assert(exists(select 1 from public.state_programs p where p.id=v_program_id and p.status='ready'
  and p.signed_by=(users->>'pm')::uuid and p.signed_at is not null and p.publication_post_id is not null and p.government_vote_id is null),'PM signs; government consideration remains a separate procedure');
 perform pg_temp.sp_assert((select count(*) from public.political_posts p where p.game_id=g and p.source_key='state_program_signed:'||v_program_id)=1,'one signature produces one political-process post');
 perform pg_temp.sp_assert(exists(select 1 from public.political_posts pp join public.state_programs p on p.publication_post_id=pp.id
  where p.id=v_program_id and pp.author_id=p.signed_by and pp.status='published' and pp.actor_key='government'
   and pp.context->>'state_program_id'=v_program_id::text and pp.body like '%QA service availability%'
   and pp.body like '%QA access project%' and pp.body like '%QA large cent allocation%'
   and pp.body like '%QA exact cents beyond integer-safe JavaScript kopecks%' and pp.body like '%900719925474100.22 ₽%'),
  'published program includes goals, structure, itemized justification and total rubles');
 perform pg_temp.sp_assert((select count(*) from public.state_program_budget_commitments c where c.program_id=v_program_id)=3
  and not exists(select 1 from public.state_program_budget_commitments c where c.program_id=v_program_id
   and (c.status<>'planned' or c.signed_by<>(users->>'pm')::uuid or c.signed_at<>(select signed_at from public.state_programs where id=v_program_id)
    or c.amount<>(select y.amount from public.state_program_budget_years y where y.program_id=v_program_id and y.budget_year=c.budget_year))),
  'signature creates exactly one planned commitment per year, including zero');
 budget:=public.get_signed_state_program_budget(g);
 perform pg_temp.sp_assert(jsonb_array_length(budget)=1,'budget RPC returns one signed program');
 entry:=budget->0;
 perform pg_temp.sp_assert(entry->>'id'=v_program_id::text and entry->>'signed_by'=users->>'pm'
  and entry->'total_budget'=to_jsonb('900719925474100.22'::text) and entry->>'program_status'='ready'
  and entry->>'publication_post_id'=(select publication_post_id::text from public.state_programs where id=v_program_id)
  and entry->'years'='[{"year":2026,"amount":"0.30","status":"planned"},{"year":2027,"amount":"900719925474099.92","status":"planned"},{"year":2028,"amount":"0.00","status":"planned"}]'::jsonb,
  'budget RPC matches persisted signature and exact planned annual amounts');
 perform pg_temp.sp_assert(not exists(select 1 from public.game_votes where game_id=g),'signature does not create or complete a government vote');
 signed_row:=pg_temp.sp_snapshot(v_program_id);
 perform public.advance_state_program(v_program_id,'pm_ready');
 perform pg_temp.sp_assert(pg_temp.sp_snapshot(v_program_id)=signed_row and public.get_signed_state_program_budget(g)=budget,'repeating PM signature is completely idempotent');
 perform pg_temp.sp_as_user((users->>'creator')::uuid);
 select id into goal_id from public.state_program_goals where state_program_goals.program_id=v_program_id order by id limit 1;
 select id into component_id from public.state_program_components where state_program_components.program_id=v_program_id order by id limit 1;
 select id into year_id from public.state_program_budget_years where state_program_budget_years.program_id=v_program_id order by budget_year limit 1;
 foreach statement in array array[
  format('select public.save_state_program_draft(%L::uuid,%L::uuid,%L::jsonb,false)',g,v_program_id,payload),
  format('select pg_temp.sp_legacy_save(%L::uuid,%L::uuid,%L::uuid)',g,v_program_id,(users->>'minister')::uuid),
  format('select public.add_state_program_goal(%L::uuid,%L,%L,%L,0,1,2028)',v_program_id,'QA forbidden signed goal','QA indicator','units'),
  format('select public.add_state_program_component(%L::uuid,1,%L,%L,%L,%L,%L::date,%L::date,0)',v_program_id,'QA direction','measure','QA forbidden signed measure','QA measurable purpose','2026-01-01','2028-12-31'),
  format('select public.delete_state_program_item(%L,%L::uuid)','goal',goal_id),
  format('select public.delete_state_program_item(%L,%L::uuid)','component',component_id),
  format('select public.set_state_program_budget_year(%L::uuid,2026,0.30)',v_program_id),
  format('select public.delete_state_program_budget_year(%L::uuid)',year_id),
  format('select public.set_state_program_participants(%L::uuid,%L)',v_program_id,'QA forbidden signed participants'),
  format('select public.link_state_program_priority(%L::uuid,null)',v_program_id)
 ] loop
  perform pg_temp.sp_expect_rejection(statement,'signed content lock through legacy or complete-form API');
  perform pg_temp.sp_assert(pg_temp.sp_snapshot(v_program_id)=signed_row,'denied signed edit leaves complete published protocol unchanged');
 end loop;
 perform pg_temp.sp_as_user((users->>'viewer')::uuid);
 perform pg_temp.sp_assert(public.get_signed_state_program_budget(g)=budget,'ordinary game participant can read the signed budget');
 perform pg_temp.sp_assert((select count(*) from public.state_program_expenses e where e.program_id=v_program_id)=4,'ordinary participant can read itemized expenses');
 perform pg_temp.sp_expect_rejection(format('update public.state_program_expenses set amount=0 where program_id=%L::uuid',v_program_id),'authenticated direct expense update');
 perform pg_temp.sp_expect_rejection(format('delete from public.state_program_budget_commitments where program_id=%L::uuid',v_program_id),'authenticated direct commitment deletion');
 perform pg_temp.sp_as_user((users->>'outsider')::uuid);
 perform pg_temp.sp_assert(not exists(select 1 from public.state_program_expenses e where e.game_id=g)
  and not exists(select 1 from public.state_program_budget_commitments c where c.game_id=g),'foreign participant cannot read expenses or commitments through RLS');
 perform pg_temp.sp_expect_rejection(format('select public.get_signed_state_program_budget(%L::uuid)',g),'foreign participant cannot read budget RPC');
 perform pg_temp.sp_as_user((users->>'teacher')::uuid);
 perform pg_temp.sp_assert(pg_temp.sp_snapshot(v_program_id)=signed_row,'all permission probes leave signed program untouched');
 perform set_config('qa.sp.signed_snapshot',signed_row::text,true);
 perform set_config('qa.sp.checks',(current_setting('qa.sp.checks')::jsonb||jsonb_build_object('author_minister_pm_review_route','PASS','signer_authorization_and_roster_gate','PASS','deputy_pm_cannot_sign','PASS','one_post_and_planned_annual_commitments','PASS','budget_rpc_matches_signature','PASS','repeat_signature_idempotency','PASS','all_legacy_signed_edit_paths_locked','PASS','expense_and_commitment_access_boundaries','PASS'))::text,true);
end;
$review_and_signature$;

do $formal_office_pm_signature$
declare
 g uuid:=current_setting('qa.sp.game')::uuid;users jsonb:=current_setting('qa.sp.users')::jsonb;
 payload jsonb:=current_setting('qa.sp.payload')::jsonb;v_program_id uuid;before_game jsonb;signed_row jsonb;
begin
 perform pg_temp.sp_as_user((users->>'teacher')::uuid);before_game:=pg_temp.sp_game_snapshot(g);
 begin
  perform pg_temp.sp_as_user((users->>'creator')::uuid);
  v_program_id:=public.save_state_program_draft(g,null,jsonb_set(payload,'{title}','"QA formal-office PM signature"'),true);
  perform pg_temp.sp_as_user((users->>'minister')::uuid);perform public.advance_state_program(v_program_id,'minister_approve');
  perform pg_temp.sp_as_user((users->>'office_pm')::uuid);
  perform pg_temp.sp_assert((select role_title from public.game_members where game_id=g and user_id=(users->>'office_pm')::uuid)='Участник','formal-office signer has no PM member title');
  perform public.advance_state_program(v_program_id,'pm_ready');
  perform pg_temp.sp_assert(exists(select 1 from public.state_programs where id=v_program_id and signed_by=(users->>'office_pm')::uuid and signed_at is not null),'active exact PM office grants signature access');
  perform pg_temp.sp_assert((select count(*) from public.state_program_budget_commitments where program_id=v_program_id)=3
   and (select count(*) from public.political_posts where game_id=g and source_key='state_program_signed:'||v_program_id)=1,'formal-office signature creates one post and annual commitments');
  signed_row:=pg_temp.sp_snapshot(v_program_id);perform public.advance_state_program(v_program_id,'pm_ready');
  perform pg_temp.sp_assert(pg_temp.sp_snapshot(v_program_id)=signed_row,'formal-office repeat signature is idempotent');
  -- Roll back this positive probe so the main budget still contains one program.
  raise exception using errcode='ZX002',message='QA discard successful formal-office signature probe';
 exception when sqlstate 'ZX002' then null;
 end;
 perform pg_temp.sp_as_user((users->>'teacher')::uuid);
 perform pg_temp.sp_assert(pg_temp.sp_game_snapshot(g)=before_game,'formal-office positive probe leaves no extra program or publication');
 perform set_config('qa.sp.checks',(current_setting('qa.sp.checks')::jsonb||jsonb_build_object('exact_pm_formal_office_can_sign_and_repeat','PASS'))::text,true);
end;
$formal_office_pm_signature$;

reset role;
select current_setting('qa.sp.checks')::jsonb as checks,
 'Fictional fixtures only; government-status test covers the sync trigger, not government voting or budget adoption; all data rolled back' as scope;
rollback;
