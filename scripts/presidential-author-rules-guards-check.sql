-- Standalone guard/privacy subset of scripts/presidential-author-rules-check.sql.
-- Only guard, manual, missing-settings and cross-game fictional fixtures
-- are needed. Run independently; no earlier subset or existing game is used.
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
 select name,gen_random_uuid() from unnest(array['teacher','cross_teacher','outsider','a','b','c','archived','unregistered','cross_student','archived_teacher']) name;
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
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,roster_archived_at)
 select guard_game,user_id,'QA archived teacher','teacher','Преподаватель',now()
 from pg_temp.qa_presidential_users where name='archived_teacher';
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

do $guards$
declare t uuid;archived_teacher uuid;g uuid;c uuid[];foreign_game uuid;foreign_candidate uuid;extra jsonb:=current_setting('qa.presidential_extra')::jsonb;
 q record;calc jsonb;before_scores jsonb;after_scores jsonb;slot integer;size_input text;actor_error constant text:='Доступ действующего преподавателя этой игры обязателен';
begin
 select user_id into t from pg_temp.qa_presidential_users where name='teacher';
 select game_id,candidates into g,c from pg_temp.qa_presidential_cases where name='guards';
 select game_id,candidates[1] into foreign_game,foreign_candidate from pg_temp.qa_presidential_cases where name='cross_game';
 perform pg_temp.qa_presidential_as(t);
 perform pg_temp.qa_presidential_assert('rpc_role_authenticated',current_user='authenticated' and auth.uid()=t,jsonb_build_object('role',current_user,'subject',auth.uid()));
 perform public.set_presidential_jury_size(g,2);

 for size_input in select unnest(array['0','51','null']) loop
  perform pg_temp.qa_presidential_denied('jury_size_'||size_input||'_denied',format('select public.set_presidential_jury_size(%L,%s)',g,size_input),'Укажите от 1 до 50 преподавателей');
 end loop;
 for slot in 0..3 loop
  if slot in (0,3) then perform pg_temp.qa_presidential_denied('jury_slot_'||slot||'_denied',format('select public.set_presidential_teacher_ballot(%L,1,%L,%s,%L)',g,'program',slot,c[1]),'Неверный номер преподавателя');end if;
 end loop;
 perform pg_temp.qa_presidential_denied('null_slot_denied',format('select public.set_presidential_teacher_ballot(%L,1,%L,null,%L)',g,'program',c[1]),'Неверный номер преподавателя');
 perform pg_temp.qa_presidential_denied('wrong_first_round_criterion_denied',format('select public.set_presidential_teacher_ballot(%L,1,%L,1,%L)',g,'runoff',c[1]),'Голосование этого тура недоступно');
 perform pg_temp.qa_presidential_denied('null_ballot_round_denied',format('select public.set_presidential_teacher_ballot(%L,null,%L,1,%L)',g,'program',c[1]),'Голосование этого тура недоступно');
 perform pg_temp.qa_presidential_denied('null_ballot_criterion_denied',format('select public.set_presidential_teacher_ballot(%L,1,null,1,%L)',g,c[1]),'Голосование этого тура недоступно');
 perform pg_temp.qa_presidential_denied('runoff_before_first_round_denied',format('select public.set_presidential_teacher_ballot(%L,2,%L,1,%L)',g,'runoff',c[1]),'Голосование этого тура недоступно');
 perform pg_temp.qa_presidential_denied('finalize_second_round_early_denied',format('select public.finalize_presidential_round(%L,2)',g),'Неверное состояние тура');
 perform pg_temp.qa_presidential_denied('calculation_invalid_round_denied',format('select public.get_presidential_rules_calculation(%L,3)',g),'Неверный тур');
 perform pg_temp.qa_presidential_denied('calculation_null_round_denied',format('select public.get_presidential_rules_calculation(%L,null)',g),'Неверный тур');
 perform pg_temp.qa_presidential_denied('finalize_invalid_round_denied',format('select public.finalize_presidential_round(%L,3)',g),'Неверное состояние тура');
 perform pg_temp.qa_presidential_denied('finalize_null_round_denied',format('select public.finalize_presidential_round(%L,null)',g),'Неверное состояние тура');

 for q in select key,value from jsonb_each_text(extra) where key in ('fictional','archived','archived_candidate','unregistered') order by key loop
  perform pg_temp.qa_presidential_denied(q.key||'_cannot_receive_pps_ballot',format('select public.set_presidential_teacher_ballot(%L,1,%L,1,%L)',g,'program',q.value),'Выберите действующего зарегистрированного кандидата');
 end loop;
 perform pg_temp.qa_presidential_denied('cross_game_candidate_ballot_denied',format('select public.set_presidential_teacher_ballot(%L,1,%L,1,%L)',g,'program',foreign_candidate),'Выберите действующего зарегистрированного кандидата');
 perform pg_temp.qa_presidential_denied('unregistered_candidate_input_denied',format('select public.set_presidential_rules_input(%L,1,null)',extra->>'unregistered'),'Кандидат не зарегистрирован');
 perform pg_temp.qa_presidential_denied('archived_candidate_input_denied',format('select public.set_presidential_rules_input(%L,1,null)',extra->>'archived_candidate'),'Teacher access required');
 perform pg_temp.qa_presidential_denied('negative_game_points_denied',format('select public.set_presidential_rules_input(%L,-1,null)',c[1]),'Баллы должны быть конечным неотрицательным числом');
 perform pg_temp.qa_presidential_denied('nan_game_points_denied',format('select public.set_presidential_rules_input(%L,%L::numeric,null)',c[1],'NaN'),'Баллы должны быть конечным неотрицательным числом');
 perform pg_temp.qa_presidential_denied('infinite_game_points_denied',format('select public.set_presidential_rules_input(%L,%L::numeric,null)',c[1],'Infinity'),'Баллы должны быть конечным неотрицательным числом');
 perform pg_temp.qa_presidential_denied('out_of_range_poll_denied',format('select public.set_presidential_rules_input(%L,1,100.1)',c[1]),'Процент опроса должен быть от 0 до 100');
 perform pg_temp.qa_presidential_denied('nan_poll_denied',format('select public.set_presidential_rules_input(%L,1,%L::numeric)',c[1],'NaN'),'Процент опроса должен быть от 0 до 100');

 -- Resizing in round1 is permitted, but shrinking removes higher slots.
 perform pg_temp.qa_presidential_votes(g,array[c[1],c[1],c[1],c[2]],array[c[1],c[2],c[1],c[2]]);
 perform public.set_presidential_rules_input(c[1],1,null);perform public.set_presidential_rules_input(c[2],1,null);
 perform public.set_presidential_jury_size(g,2);
 perform pg_temp.qa_presidential_assert('jury_shrink_removes_higher_slots',
  (select count(*)=4 and max(slot_no)=2 from public.presidential_teacher_ballots where game_id=g),jsonb_build_object('jury_size',2));
 perform public.set_presidential_jury_size(g,4);calc:=public.get_presidential_rules_calculation(g,1);
 perform pg_temp.qa_presidential_assert('jury_expansion_requires_missing_ballots',not (calc->>'ready')::boolean and (calc->>'program_votes')::int=2 and (calc->>'campaign_votes')::int=2,calc);
 perform public.set_presidential_teacher_ballot(g,1,'program',1,null);
 perform pg_temp.qa_presidential_assert('null_candidate_clears_existing_ballot',not exists(select 1 from public.presidential_teacher_ballots where game_id=g and round_no=1 and criterion='program' and slot_no=1),'{}');

 select game_id,candidates into g,c from pg_temp.qa_presidential_cases where name='manual_guard';
 perform pg_temp.qa_presidential_denied('manual_phase_jury_size_denied',format('select public.set_presidential_jury_size(%L,2)',g),'Состав ППС первого тура уже зафиксирован');
 perform pg_temp.qa_presidential_denied('manual_phase_ballot_denied',format('select public.set_presidential_teacher_ballot(%L,1,%L,1,%L)',g,'program',c[1]),'Голосование этого тура недоступно');
 perform pg_temp.qa_presidential_denied('manual_phase_input_denied',format('select public.set_presidential_rules_input(%L,1,null)',c[1]),'Первый тур недоступен для изменений');
 select game_id,candidates into g,c from pg_temp.qa_presidential_cases where name='no_settings';
 calc:=public.get_presidential_rules_calculation(g,1);
 perform pg_temp.qa_presidential_assert('missing_settings_not_ready',not (calc->>'ready')::boolean and jsonb_array_length(calc->'rows')=0,calc);
 perform pg_temp.qa_presidential_denied('missing_settings_jury_denied',format('select public.set_presidential_jury_size(%L,2)',g),'Состав ППС первого тура уже зафиксирован');
 perform pg_temp.qa_presidential_denied('missing_settings_ballot_denied',format('select public.set_presidential_teacher_ballot(%L,1,%L,1,%L)',g,'program',c[1]),'Сначала утвердите систему выборов');
 perform pg_temp.qa_presidential_denied('missing_settings_finalize_denied',format('select public.finalize_presidential_round(%L,1)',g),'Система выборов не утверждена');

 -- An archived teacher still has a teacher-kind row. Exercise the actual
 -- legacy entry point in an editable first round, where it formerly could
 -- overwrite raw poll_pct despite the new RPCs rejecting that actor.
 select game_id,candidates into g,c from pg_temp.qa_presidential_cases where name='guards';
 select user_id into archived_teacher from pg_temp.qa_presidential_users where name='archived_teacher';
 perform public.set_presidential_rules_input(c[1],1,43);
 select jsonb_agg(to_jsonb(sc) order by sc.candidate_id,sc.round_no) into before_scores from public.presidential_scorecards sc where sc.game_id=g;
 perform pg_temp.qa_presidential_as(archived_teacher);
 perform pg_temp.qa_presidential_denied('archived_teacher_legacy_scorecard_denied',format('select public.set_presidential_scorecard(%L,1,50,50,50,77,null)',c[1]),actor_error);
 perform pg_temp.qa_presidential_denied('archived_teacher_jury_denied',format('select public.set_presidential_jury_size(%L,2)',g),actor_error);
 perform pg_temp.qa_presidential_denied('archived_teacher_ballot_denied',format('select public.set_presidential_teacher_ballot(%L,1,%L,1,%L)',g,'program',c[1]),actor_error);
 perform pg_temp.qa_presidential_denied('archived_teacher_input_denied',format('select public.set_presidential_rules_input(%L,2,77)',c[1]),actor_error);
 perform pg_temp.qa_presidential_denied('archived_teacher_calculation_denied',format('select public.get_presidential_rules_calculation(%L,1)',g),'Teacher access required');
 perform pg_temp.qa_presidential_denied('archived_teacher_finalize_denied',format('select public.finalize_presidential_round(%L,1)',g),actor_error);
 perform pg_temp.qa_presidential_as(t);
 select jsonb_agg(to_jsonb(sc) order by sc.candidate_id,sc.round_no) into after_scores from public.presidential_scorecards sc where sc.game_id=g;
 perform pg_temp.qa_presidential_assert('archived_teacher_raw_poll_and_snapshot_unchanged',before_scores=after_scores
  and (select poll_pct=43 and game_rating_points=1 from public.presidential_scorecards where candidate_id=c[1] and round_no=1),jsonb_build_object('before',before_scores,'after',after_scores));

 -- Test all six RPCs as an outsider, as a fixture student, and as a
 -- teacher targeting another fictional teacher's game. Mutators use the
 -- active-teacher guard's Russian error; the read RPC retains English.
 for q in select name,user_id from pg_temp.qa_presidential_users where name in ('outsider','a') order by name loop
  perform pg_temp.qa_presidential_as(q.user_id);
  perform pg_temp.qa_presidential_denied(q.name||'_jury_access_denied',format('select public.set_presidential_jury_size(%L,2)',g),actor_error);
  perform pg_temp.qa_presidential_denied(q.name||'_ballot_access_denied',format('select public.set_presidential_teacher_ballot(%L,1,%L,1,%L)',g,'program',c[1]),actor_error);
  perform pg_temp.qa_presidential_denied(q.name||'_input_access_denied',format('select public.set_presidential_rules_input(%L,1,null)',c[1]),actor_error);
  perform pg_temp.qa_presidential_denied(q.name||'_legacy_access_denied',format('select public.set_presidential_scorecard(%L,1,50,50,50,77,null)',c[1]),actor_error);
  perform pg_temp.qa_presidential_denied(q.name||'_calculation_access_denied',format('select public.get_presidential_rules_calculation(%L,1)',g),'Teacher access required');
  perform pg_temp.qa_presidential_denied(q.name||'_finalize_access_denied',format('select public.finalize_presidential_round(%L,1)',g),actor_error);
  perform pg_temp.qa_presidential_assert(q.name||'_pps_ballots_not_readable',(select count(*)=0 from public.presidential_teacher_ballots where game_id=g),'{}');
 end loop;
 perform pg_temp.qa_presidential_as(t);
 perform pg_temp.qa_presidential_denied('cross_game_teacher_jury_denied',format('select public.set_presidential_jury_size(%L,2)',foreign_game),actor_error);
 perform pg_temp.qa_presidential_denied('cross_game_teacher_ballot_denied',format('select public.set_presidential_teacher_ballot(%L,1,%L,1,%L)',foreign_game,'program',foreign_candidate),actor_error);
 perform pg_temp.qa_presidential_denied('cross_game_teacher_input_denied',format('select public.set_presidential_rules_input(%L,1,null)',foreign_candidate),actor_error);
 perform pg_temp.qa_presidential_denied('cross_game_teacher_legacy_denied',format('select public.set_presidential_scorecard(%L,1,50,50,50,77,null)',foreign_candidate),actor_error);
 perform pg_temp.qa_presidential_denied('cross_game_teacher_calculation_denied',format('select public.get_presidential_rules_calculation(%L,1)',foreign_game),'Teacher access required');
 perform pg_temp.qa_presidential_denied('cross_game_teacher_finalize_denied',format('select public.finalize_presidential_round(%L,1)',foreign_game),actor_error);
end;
$guards$;

select jsonb_build_object(
 'suite','presidential_author_rules_guards',
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
