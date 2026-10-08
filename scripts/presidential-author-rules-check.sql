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

do $calculations$
declare t uuid;g uuid;c uuid[];q record;calc jsonb;row_a jsonb;row_b jsonb;row_c jsonb;result jsonb;before_snapshot jsonb;first_snapshot jsonb;total numeric;i integer;
begin
 select user_id into t from pg_temp.qa_presidential_users where name='teacher';
 perform pg_temp.qa_presidential_as(t);
 perform pg_temp.qa_presidential_assert('rpc_role_authenticated',current_user='authenticated',jsonb_build_object('role',current_user,'subject',auth.uid()));

 -- Each PPS slot casts one vote per criterion. Points 1/2/3 become the
 -- unrounded shares 100/6, 200/6, 300/6; the two PPS distributions differ.
 for q in select * from pg_temp.qa_presidential_cases where name in ('mean3','mean4') order by name loop
  g:=q.game_id;c:=q.candidates;
  perform pg_temp.qa_presidential_votes(g,array[c[1],c[1],c[1],c[2],c[2],c[3]],array[c[1],c[2],c[2],c[3],c[3],c[3]]);
  perform public.set_presidential_rules_input(c[1],1,case when q.poll_enabled then 40 end);
  perform public.set_presidential_rules_input(c[2],2,case when q.poll_enabled then 35 end);
  perform public.set_presidential_rules_input(c[3],3,case when q.poll_enabled then 25 end);
  calc:=public.get_presidential_rules_calculation(g,1);
  row_a:=pg_temp.qa_presidential_row(calc,c[1]);row_b:=pg_temp.qa_presidential_row(calc,c[2]);row_c:=pg_temp.qa_presidential_row(calc,c[3]);
  perform pg_temp.qa_presidential_assert(q.name||'_ready',(calc->>'ready')::boolean and (calc->>'program_votes')::int=6 and (calc->>'campaign_votes')::int=6,calc);
  perform pg_temp.qa_presidential_assert(q.name||'_pps_vote_shares',
   (row_a->>'program_pct')::numeric=50 and abs((row_b->>'program_pct')::numeric-100::numeric/3)<0.0000000001 and abs((row_c->>'program_pct')::numeric-50::numeric/3)<0.0000000001
   and abs((row_a->>'campaign_pct')::numeric-50::numeric/3)<0.0000000001 and abs((row_b->>'campaign_pct')::numeric-100::numeric/3)<0.0000000001 and (row_c->>'campaign_pct')::numeric=50,
   jsonb_build_object('program',jsonb_build_array(row_a->'program_pct',row_b->'program_pct',row_c->'program_pct'),'campaign',jsonb_build_array(row_a->'campaign_pct',row_b->'campaign_pct',row_c->'campaign_pct')));
  perform pg_temp.qa_presidential_assert(q.name||'_points_1_2_3',
   (calc->>'total_points')::numeric=6 and abs((row_a->>'game_pct')::numeric-100::numeric/6)<0.0000000001 and abs((row_b->>'game_pct')::numeric-200::numeric/6)<0.0000000001 and (row_c->>'game_pct')::numeric=50,
   jsonb_build_object('points',jsonb_build_array(row_a->'points',row_b->'points',row_c->'points'),'shares',jsonb_build_array(row_a->'game_pct',row_b->'game_pct',row_c->'game_pct')));
  select sum((value->>'result_pct')::numeric) into total from jsonb_array_elements(calc->'rows');
  perform pg_temp.qa_presidential_assert(q.name||'_sum_100',abs(total-100)<0.0000000001,jsonb_build_object('sum',total));
  if q.name='mean3' then
   perform pg_temp.qa_presidential_assert('mean_three_components',
    abs((row_a->>'result_pct')::numeric-250::numeric/9)<0.0000000001 and abs((row_b->>'result_pct')::numeric-100::numeric/3)<0.0000000001 and abs((row_c->>'result_pct')::numeric-350::numeric/9)<0.0000000001,calc->'rows');
   result:=public.finalize_presidential_round(g,1);
   perform pg_temp.qa_presidential_assert('relative_plurality_below_50_wins',result->>'status'='finished' and result->>'winner_id'=c[3]::text and (result->>'score')::numeric<50,result);
  else
   perform pg_temp.qa_presidential_assert('mean_four_components_with_poll',
    abs((row_a->>'result_pct')::numeric-185::numeric/6)<0.0000000001 and (row_b->>'result_pct')::numeric=33.75 and abs((row_c->>'result_pct')::numeric-425::numeric/12)<0.0000000001,calc->'rows');
   perform public.set_presidential_rules_input(c[3],3,24);
   calc:=public.get_presidential_rules_calculation(g,1);
   perform pg_temp.qa_presidential_assert('poll_sum_99_not_ready',not (calc->>'ready')::boolean and (calc->'issues')::text like '%100%',calc);
   perform pg_temp.qa_presidential_denied('poll_sum_99_cannot_finalize',format('select public.finalize_presidential_round(%L,1)',g),'Расчёт не завершён');
   perform public.set_presidential_rules_input(c[3],3,25);
   calc:=public.get_presidential_rules_calculation(g,1);
   perform pg_temp.qa_presidential_assert('poll_sum_100_restores_readiness',(calc->>'ready')::boolean,calc);
  end if;
 end loop;

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

 -- Display rounds to 50.00, but the exact 50.0001 still wins. This detects
 -- comparisons against rounded computed_pct instead of unrounded_pct.
 select game_id,candidates into g,c from pg_temp.qa_presidential_cases where name='absolute_above_50';
 perform pg_temp.qa_presidential_votes(g,array[c[1],c[2]],array[c[1],c[2]]);
 perform public.set_presidential_rules_input(c[1],50.0003,null);perform public.set_presidential_rules_input(c[2],49.9997,null);
 result:=public.finalize_presidential_round(g,1);before_snapshot:=result;
 perform pg_temp.qa_presidential_assert('absolute_50_0001_unrounded_wins',result->>'status'='finished' and result->>'winner_id'=c[1]::text and (result->>'score')::numeric=50.0001,result);
 perform pg_temp.qa_presidential_assert('display_50_does_not_change_decision',
  (select computed_pct=50 and unrounded_pct=50.0001 from public.presidential_scorecards where candidate_id=c[1] and round_no=1),result->'calculation');
 perform pg_temp.qa_presidential_denied('finished_legacy_scorecard_locked',format('select public.set_presidential_scorecard(%L,1,50,50,50,null,null)',c[1]),'Итог этого тура уже зафиксирован');
 perform pg_temp.qa_presidential_denied('finished_rules_input_locked',format('select public.set_presidential_rules_input(%L,1,null)',c[1]),'Первый тур недоступен для изменений');
 perform pg_temp.qa_presidential_denied('finished_jury_size_locked',format('select public.set_presidential_jury_size(%L,3)',g),'Состав ППС первого тура уже зафиксирован');
 perform pg_temp.qa_presidential_denied('finished_first_ballot_locked',format('select public.set_presidential_teacher_ballot(%L,1,%L,1,%L)',g,'program',c[2]),'Голосование этого тура недоступно');
 perform pg_temp.qa_presidential_denied('finished_settings_cannot_reopen',format('select public.configure_presidential_election(%L,%L,50,false)',g,'absolute'),'Завершённый протокол выборов защищён');
 calc:=public.get_presidential_rules_calculation(g,1);result:=public.finalize_presidential_round(g,1);
 perform pg_temp.qa_presidential_assert('finished_snapshot_and_repeat_immutable',calc=before_snapshot->'calculation' and result=before_snapshot,result);

 -- Qualified majority uses its configured threshold, including equality.
 for q in select * from pg_temp.qa_presidential_cases where name in ('qualified_at_threshold','qualified_below_threshold') order by name loop
  g:=q.game_id;c:=q.candidates;
  perform pg_temp.qa_presidential_votes(g,array[c[1],c[1],c[1],c[2]],array[c[1],c[1],c[1],c[2]]);
  perform public.set_presidential_rules_input(c[1],30,null);perform public.set_presidential_rules_input(c[2],70,null);
  result:=public.finalize_presidential_round(g,1);
  perform pg_temp.qa_presidential_assert(q.name,
   case when q.name='qualified_at_threshold' then result->>'status'='finished' and result->>'winner_id'=c[1]::text and (result->>'score')::numeric=60
   else result->>'status'='runoff' and not(result?'winner_id') and jsonb_array_length(result->'candidate_ids')=2 end,result);
 end loop;

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

do $guards$
declare t uuid;archived_teacher uuid;g uuid;c uuid[];foreign_game uuid;foreign_candidate uuid;extra jsonb:=current_setting('qa.presidential_extra')::jsonb;
 q record;calc jsonb;before_scores jsonb;after_scores jsonb;slot integer;size_input text;actor_error constant text:='Доступ действующего преподавателя этой игры обязателен';
begin
 select user_id into t from pg_temp.qa_presidential_users where name='teacher';
 select game_id,candidates into g,c from pg_temp.qa_presidential_cases where name='guards';
 select game_id,candidates[1] into foreign_game,foreign_candidate from pg_temp.qa_presidential_cases where name='cross_game';
 perform pg_temp.qa_presidential_as(t);
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
 'suite','presidential_author_rules',
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
