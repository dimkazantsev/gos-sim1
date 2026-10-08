-- Standalone tie/runoff subset of scripts/presidential-author-rules-check.sql.
-- Run this script independently; it repeats the full fictional fixture
-- and ends in ROLLBACK. No earlier subset or existing game is required.
-- Author-rule integration checks against the real authenticated RPCs.
-- Prerequisite: 20261008150907_presidential_author_rules.sql is applied.
-- Run as a fixture-capable database role with stop-on-error enabled.
-- All identities, classrooms and candidate rows below are fictional. No
-- existing classroom records are read or changed. Everything rolls back.
begin;

create temporary table qa_presidential_users(
 name text primary key,
 user_id uuid not null unique
);
create temporary table qa_presidential_cases(
 name text primary key,
 game_id uuid not null unique,
 teacher_id uuid not null,
 candidate_count integer not null,
 candidates uuid[] not null default '{}',
 system_type text not null,
 threshold_pct numeric not null default 50,
 poll_enabled boolean not null default false,
 initial_status text
);
create temporary table qa_presidential_proof(
 check_name text primary key,
 passed boolean not null check(passed),
 detail jsonb not null default '{}'
);

-- Helpers are SECURITY INVOKER: RPC calls retain the authenticated role and
-- current fictional JWT subject, including deliberate denial attempts.
create function pg_temp.qa_presidential_as(p_user uuid) returns void
language plpgsql as $helper$
begin
 perform set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated')::text,true);
end;
$helper$;

create function pg_temp.qa_presidential_assert(p_name text,p_ok boolean,p_detail jsonb default '{}') returns void
language plpgsql as $helper$
begin
 if p_ok is distinct from true then raise exception 'FAIL %: %',p_name,p_detail;end if;
 insert into pg_temp.qa_presidential_proof(check_name,passed,detail) values(p_name,true,coalesce(p_detail,'{}'));
end;
$helper$;

create function pg_temp.qa_presidential_denied(p_name text,p_sql text,p_expected_message text) returns void
language plpgsql as $helper$
declare blocked boolean:=false;failure text;
begin
 begin
  execute p_sql;
 exception when sqlstate 'P0001' then
  get stacked diagnostics failure=message_text;
  blocked:=position(p_expected_message in failure)>0;
 end;
 -- Missing functions/tables, type errors and privilege setup mistakes must
 -- fail the suite instead of masquerading as application guard rejections.
 perform pg_temp.qa_presidential_assert(p_name,blocked,jsonb_build_object('expected',p_expected_message,'actual',failure,'sqlstate','P0001'));
end;
$helper$;

create function pg_temp.qa_presidential_row(p_calculation jsonb,p_candidate uuid) returns jsonb
language sql stable as $helper$
 select value from jsonb_array_elements(p_calculation->'rows') where value->>'candidate_id'=p_candidate::text
$helper$;

create function pg_temp.qa_presidential_votes(p_game uuid,p_program uuid[],p_campaign uuid[]) returns void
language plpgsql as $helper$
declare slot integer;
begin
 if cardinality(p_program) is distinct from cardinality(p_campaign) or cardinality(p_program)=0 then
  raise exception 'FAIL fixture: program and campaign arrays must contain the same nonzero number of slots';
 end if;
 perform public.set_presidential_jury_size(p_game,cardinality(p_program));
 for slot in 1..cardinality(p_program) loop
  perform public.set_presidential_teacher_ballot(p_game,1,'program',slot,p_program[slot]);
  perform public.set_presidential_teacher_ballot(p_game,1,'campaign',slot,p_campaign[slot]);
 end loop;
end;
$helper$;

do $fixture$
declare q record;who record;teacher uuid;other_teacher uuid;students uuid[];candidate uuid;candidate_ids uuid[];guard_game uuid;extra_candidate uuid;i integer;extra jsonb:='{}';temporary_schema text;
begin
 insert into pg_temp.qa_presidential_users(name,user_id)
 select name,gen_random_uuid() from unnest(array['teacher','cross_teacher','outsider','a','b','c','archived','unregistered','cross_student']) name;
 for who in select * from pg_temp.qa_presidential_users loop
  insert into auth.users(id,aud,role) values(who.user_id,'authenticated','authenticated');
 end loop;
 select user_id into teacher from pg_temp.qa_presidential_users where name='teacher';
 select user_id into other_teacher from pg_temp.qa_presidential_users where name='cross_teacher';
 select array_agg(user_id order by name) into students from pg_temp.qa_presidential_users where name in ('a','b','c');
 if exists(select 1 from public.platform_admins p join pg_temp.qa_presidential_users u on u.user_id=p.user_id) then
  raise exception 'FAIL fixture: temporary accounts must not inherit platform-admin rights';
 end if;

 insert into pg_temp.qa_presidential_cases(name,game_id,teacher_id,candidate_count,system_type,threshold_pct,poll_enabled,initial_status) values
 ('mean3',gen_random_uuid(),teacher,3,'relative',50,false,'setup'),
 ('mean4',gen_random_uuid(),teacher,3,'absolute',50,true,'setup'),
 ('absolute_equal_50',gen_random_uuid(),teacher,2,'absolute',50,false,'setup'),
 ('absolute_above_50',gen_random_uuid(),teacher,2,'absolute',50,false,'setup'),
 ('qualified_at_threshold',gen_random_uuid(),teacher,2,'qualified',60,false,'setup'),
 ('qualified_below_threshold',gen_random_uuid(),teacher,2,'qualified',60.0001,false,'setup'),
 ('relative_tie',gen_random_uuid(),teacher,2,'relative',50,false,'setup'),
 ('finalist_boundary_tie',gen_random_uuid(),teacher,3,'absolute',50,false,'setup'),
 ('runoff_untransformed',gen_random_uuid(),teacher,3,'absolute',50,false,'setup'),
 ('zero_points',gen_random_uuid(),teacher,3,'absolute',50,false,'setup'),
 ('guards',gen_random_uuid(),teacher,2,'absolute',50,false,'round1'),
 ('manual_guard',gen_random_uuid(),teacher,2,'preferential',50,false,'manual_required'),
 ('no_settings',gen_random_uuid(),teacher,2,'absolute',50,false,null),
 ('cross_game',gen_random_uuid(),other_teacher,1,'absolute',50,false,'setup');

 for q in select * from pg_temp.qa_presidential_cases order by name loop
  perform pg_temp.qa_presidential_as(q.teacher_id);
  insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
  values(q.game_id,'QA presidential author rules: '||q.name,'QA'||substr(replace(q.game_id::text,'-',''),1,12),q.teacher_id,'running',7,true);
  insert into public.game_members(game_id,user_id,full_name,kind,role_title)
  values(q.game_id,q.teacher_id,'QA fictional teacher','teacher','Преподаватель');
  insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
  values(q.game_id,7,'QA presidential election','Учебная процедура','QA isolated fixture','open');
  candidate_ids:='{}';
  for i in 1..q.candidate_count loop
   if q.name='cross_game' then select user_id into candidate from pg_temp.qa_presidential_users where name='cross_student';
   else candidate:=students[i];end if;
   insert into public.game_members(game_id,user_id,full_name,kind,role_title,score)
   values(q.game_id,candidate,'QA fictional student '||i,'student','Участник',i);
   insert into public.presidential_candidates(game_id,user_id,display_name,nomination_type,registration_status,created_by,created_at)
   values(q.game_id,candidate,'QA candidate '||i,'self','registered',q.teacher_id,now()+i*interval '1 millisecond') returning id into candidate;
   candidate_ids:=array_append(candidate_ids,candidate);
  end loop;
  update pg_temp.qa_presidential_cases set candidates=candidate_ids where name=q.name;
  if q.initial_status is not null then
   insert into public.presidential_election_settings(game_id,system_type,threshold_pct,poll_enabled,status,updated_by)
   values(q.game_id,q.system_type,q.threshold_pct,q.poll_enabled,q.initial_status,q.teacher_id);
  end if;
 end loop;

 select game_id into guard_game from pg_temp.qa_presidential_cases where name='guards';
 insert into public.presidential_candidates(game_id,display_name,nomination_type,registration_status,created_by)
 values(guard_game,'QA fictional non-student candidate','fictional','registered',teacher) returning id into extra_candidate;
 extra:=extra||jsonb_build_object('fictional',extra_candidate);
 for who in select * from pg_temp.qa_presidential_users where name in ('archived','unregistered') loop
  insert into public.game_members(game_id,user_id,full_name,kind,role_title,roster_archived_at)
  values(guard_game,who.user_id,'QA guard student '||who.name,'student','Участник',case when who.name='archived' then now() end);
  insert into public.presidential_candidates(game_id,user_id,display_name,nomination_type,registration_status,created_by)
  values(guard_game,who.user_id,'QA guard candidate '||who.name,'self',case when who.name='unregistered' then 'submitted' else 'registered' end,teacher)
  returning id into extra_candidate;
  extra:=extra||jsonb_build_object(who.name,extra_candidate);
 end loop;
 insert into public.presidential_candidates(game_id,user_id,display_name,nomination_type,registration_status,created_by,archived_at)
 values(guard_game,students[3],'QA archived candidate record','self','registered',teacher,now()) returning id into extra_candidate;
 extra:=extra||jsonb_build_object('archived_candidate',extra_candidate);
 perform set_config('qa.presidential_extra',extra::text,true);
 perform pg_temp.qa_presidential_as(teacher);

 grant select on pg_temp.qa_presidential_users,pg_temp.qa_presidential_cases to authenticated;
 grant select,insert on pg_temp.qa_presidential_proof to authenticated;
 select nspname into temporary_schema from pg_namespace where oid=pg_my_temp_schema();
 execute format('grant usage on schema %I to authenticated',temporary_schema);
 grant execute on function pg_temp.qa_presidential_as(uuid),pg_temp.qa_presidential_assert(text,boolean,jsonb),
  pg_temp.qa_presidential_denied(text,text,text),pg_temp.qa_presidential_row(jsonb,uuid),pg_temp.qa_presidential_votes(uuid,uuid[],uuid[]) to authenticated;
end;
$fixture$;

set local role authenticated;

do $calculations$
declare t uuid;g uuid;c uuid[];q record;calc jsonb;row_a jsonb;row_b jsonb;row_c jsonb;result jsonb;before_snapshot jsonb;first_snapshot jsonb;total numeric;i integer;
begin
 select user_id into t from pg_temp.qa_presidential_users where name='teacher';
 perform pg_temp.qa_presidential_as(t);
 perform pg_temp.qa_presidential_assert('rpc_role_authenticated',current_user='authenticated',jsonb_build_object('role',current_user,'subject',auth.uid()));

 -- At exactly 50%, absolute majority is not achieved. Equal finalists are
 -- allowed, but a second-round tie must retain both and appoint nobody.
 select game_id,candidates into g,c from pg_temp.qa_presidential_cases where name='absolute_equal_50';
 perform pg_temp.qa_presidential_votes(g,array[c[1],c[2]],array[c[1],c[2]]);
 perform public.set_presidential_rules_input(c[1],50,null);perform public.set_presidential_rules_input(c[2],50,null);
 result:=public.finalize_presidential_round(g,1);first_snapshot:=result->'calculation';
 perform pg_temp.qa_presidential_assert('absolute_exactly_50_runoff',result->>'status'='runoff' and not(result?'winner_id') and jsonb_array_length(result->'candidate_ids')=2
  and (pg_temp.qa_presidential_row(first_snapshot,c[1])->>'result_pct')::numeric=50 and (pg_temp.qa_presidential_row(first_snapshot,c[2])->>'result_pct')::numeric=50,result);
 perform public.set_presidential_teacher_ballot(g,2,'runoff',1,c[1]);perform public.set_presidential_teacher_ballot(g,2,'runoff',2,c[2]);
 result:=public.finalize_presidential_round(g,2);before_snapshot:=result;
 perform pg_temp.qa_presidential_assert('second_round_tie_no_lottery',result->>'status'='runoff' and (result->>'tie')::boolean and not(result?'winner_id') and jsonb_array_length(result->'candidate_ids')=2
  and result->'candidate_ids' ? c[1]::text and result->'candidate_ids' ? c[2]::text,result);
 result:=public.finalize_presidential_round(g,2);
 perform pg_temp.qa_presidential_assert('second_round_tie_repeated_no_guess',result=before_snapshot,result);

 select game_id,candidates into g,c from pg_temp.qa_presidential_cases where name='relative_tie';
 perform pg_temp.qa_presidential_votes(g,array[c[1],c[2]],array[c[1],c[2]]);
 perform public.set_presidential_rules_input(c[1],1,null);perform public.set_presidential_rules_input(c[2],1,null);
 result:=public.finalize_presidential_round(g,1);before_snapshot:=result;
 perform pg_temp.qa_presidential_assert('first_round_relative_tie_no_lottery',result->>'status'='round1' and (result->>'tie')::boolean and not(result?'winner_id'),result);
 result:=public.finalize_presidential_round(g,1);
 perform pg_temp.qa_presidential_assert('first_round_tie_repeated_no_guess',result->>'status'='round1' and (result->>'tie')::boolean and not(result?'winner_id')
  and (pg_temp.qa_presidential_row(result->'calculation',c[1])->>'result_pct')::numeric=50 and (pg_temp.qa_presidential_row(result->'calculation',c[2])->>'result_pct')::numeric=50,result);

 select game_id,candidates into g,c from pg_temp.qa_presidential_cases where name='finalist_boundary_tie';
 perform pg_temp.qa_presidential_votes(g,array[c[1],c[1],c[1],c[1],c[2],c[2],c[2],c[3],c[3],c[3]],array[c[1],c[1],c[1],c[1],c[2],c[2],c[2],c[3],c[3],c[3]]);
 perform public.set_presidential_rules_input(c[1],4,null);perform public.set_presidential_rules_input(c[2],3,null);perform public.set_presidential_rules_input(c[3],3,null);
 result:=public.finalize_presidential_round(g,1);
 perform pg_temp.qa_presidential_assert('three_way_finalist_boundary_no_guess',result->>'status'='round1' and (result->>'tie')::boolean and not(result?'winner_id') and not(result?'candidate_ids')
  and (pg_temp.qa_presidential_row(result->'calculation',c[1])->>'result_pct')::numeric=40 and (pg_temp.qa_presidential_row(result->'calculation',c[2])->>'result_pct')::numeric=30
  and (pg_temp.qa_presidential_row(result->'calculation',c[3])->>'result_pct')::numeric=30,result);

 -- First-round finalists total only 72.222...%; their shares must not be
 -- rescaled. Runoff uses the frozen, unrounded first result plus new PPS.
 select game_id,candidates into g,c from pg_temp.qa_presidential_cases where name='runoff_untransformed';
 perform pg_temp.qa_presidential_votes(g,array[c[1],c[1],c[1],c[2],c[2],c[3]],array[c[1],c[1],c[1],c[2],c[2],c[3]]);
 for i in 1..3 loop perform public.set_presidential_rules_input(c[i],i,null);end loop;
 result:=public.finalize_presidential_round(g,1);first_snapshot:=result->'calculation';
 perform pg_temp.qa_presidential_assert('runoff_two_actual_leaders',result->>'status'='runoff' and jsonb_array_length(result->'candidate_ids')=2 and result->'candidate_ids' ? c[1]::text
  and result->'candidate_ids' ? c[2]::text and not(result->'candidate_ids' ? c[3]::text),result);
 perform pg_temp.qa_presidential_denied('runoff_first_legacy_scorecard_locked',format('select public.set_presidential_scorecard(%L,1,50,50,50,null,null)',c[1]),'Итог этого тура уже зафиксирован');
 perform pg_temp.qa_presidential_denied('runoff_first_input_locked',format('select public.set_presidential_rules_input(%L,100,null)',c[1]),'Первый тур недоступен для изменений');
 perform pg_temp.qa_presidential_denied('runoff_jury_size_locked',format('select public.set_presidential_jury_size(%L,7)',g),'Состав ППС первого тура уже зафиксирован');
 perform pg_temp.qa_presidential_denied('runoff_first_ballot_locked',format('select public.set_presidential_teacher_ballot(%L,1,%L,1,%L)',g,'program',c[2]),'Голосование этого тура недоступно');
 perform pg_temp.qa_presidential_denied('runoff_non_finalist_ballot_denied',format('select public.set_presidential_teacher_ballot(%L,2,%L,1,%L)',g,'runoff',c[3]),'Кандидат не прошёл во второй тур');
 perform pg_temp.qa_presidential_denied('runoff_first_finalize_denied',format('select public.finalize_presidential_round(%L,1)',g),'Неверное состояние тура');
 for i in 1..6 loop perform public.set_presidential_teacher_ballot(g,2,'runoff',i,case when i<=4 then c[1] else c[2] end);end loop;
 calc:=public.get_presidential_rules_calculation(g,2);row_a:=pg_temp.qa_presidential_row(calc,c[1]);row_b:=pg_temp.qa_presidential_row(calc,c[2]);
 select sum((value->>'result_pct')::numeric) into total from jsonb_array_elements(calc->'rows');
 perform pg_temp.qa_presidential_assert('runoff_unrounded_untransformed_first',
  (calc->>'ready')::boolean and jsonb_array_length(calc->'rows')=2 and abs((row_a->>'first_pct')::numeric-350::numeric/9)<0.0000000001
  and abs((row_a->>'teacher_runoff_pct')::numeric-200::numeric/3)<0.0000000001 and abs((row_a->>'result_pct')::numeric-475::numeric/9)<0.0000000001
  and abs((row_b->>'result_pct')::numeric-100::numeric/3)<0.0000000001 and abs(total-775::numeric/9)<0.0000000001 and abs(total-100)>10,calc);
 perform pg_temp.qa_presidential_assert('runoff_first_snapshot_still_exact',
  (select abs(unrounded_pct-350::numeric/9)<0.0000000001 from public.presidential_scorecards where candidate_id=c[1] and round_no=1)
  and abs((pg_temp.qa_presidential_row(first_snapshot,c[1])->>'result_pct')::numeric-(row_a->>'first_pct')::numeric)<0.0000000001,first_snapshot);
 result:=public.finalize_presidential_round(g,2);before_snapshot:=result;
 perform pg_temp.qa_presidential_assert('runoff_relative_winner',result->>'status'='finished' and result->>'winner_id'=c[1]::text and abs((result->>'score')::numeric-475::numeric/9)<0.0000000001,result);
 perform pg_temp.qa_presidential_denied('finished_runoff_legacy_scorecard_locked',format('select public.set_presidential_scorecard(%L,2,null,null,null,null,100)',c[1]),'Итог этого тура уже зафиксирован');
 calc:=public.get_presidential_rules_calculation(g,2);result:=public.finalize_presidential_round(g,2);
 perform pg_temp.qa_presidential_assert('finished_runoff_snapshot_immutable',calc=before_snapshot->'calculation' and result=before_snapshot,result);

 select game_id,candidates into g,c from pg_temp.qa_presidential_cases where name='zero_points';
 perform pg_temp.qa_presidential_votes(g,array[c[1],c[2],c[3]],array[c[1],c[2],c[3]]);
 for i in 1..3 loop perform public.set_presidential_rules_input(c[i],0,null);end loop;
 calc:=public.get_presidential_rules_calculation(g,1);
 perform pg_temp.qa_presidential_assert('all_zero_points_not_ready',not (calc->>'ready')::boolean and (calc->>'total_points')::numeric=0
  and exists(select 1 from jsonb_array_elements_text(calc->'issues') issue where issue like '%баллов%больше нуля%'),calc);
 perform pg_temp.qa_presidential_denied('all_zero_points_cannot_finalize',format('select public.finalize_presidential_round(%L,1)',g),'Расчёт не завершён');
end;
$calculations$;

select jsonb_build_object(
 'suite','presidential_author_rules_runoff',
 'execution_role',current_user,
 'fixture_games',(select count(*) from pg_temp.qa_presidential_cases),
 'fixture_users',(select count(*) from pg_temp.qa_presidential_users),
 'checks_passed',count(*),
 'all_passed',bool_and(passed),
 'checks',jsonb_object_agg(check_name,jsonb_build_object('status','PASS','proof',detail) order by check_name),
 'rollback','All fixtures and temporary helpers are transaction scoped; ROLLBACK follows this proof.'
) as proof
from pg_temp.qa_presidential_proof;

rollback;
