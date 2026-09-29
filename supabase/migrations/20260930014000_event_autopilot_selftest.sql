-- Transactionally isolated regression test for automatic event dispatch and trust.
-- Calling this function creates temporary scenario rows and rolls them back before return.
-- Never run it on a live student's game: it constructs an isolated game and reuses
-- only a synthetic membership of a pre-existing owner account.
create or replace function private.event_autopilot_selftest()
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
 owner_user uuid;
 new_game uuid;
 case_id uuid;
 assignment_id uuid;
 seeded integer;
 sent integer;
 count_today integer;
 count_decisions integer;
 count_ledger integer;
 trust numeric;
 result jsonb;
 control jsonb;
begin
 select gm.user_id into owner_user from public.game_members gm
 where gm.kind='teacher' limit 1;
 if owner_user is null then return jsonb_build_object('skipped','No existing testable teacher account');end if;
 begin
  insert into public.games(title,game_code,owner_id,status)
  values('EVENT REGRESSION ISOLATED','TEST-'||upper(substr(gen_random_uuid()::text,1,12)),owner_user,'running')
  returning id into new_game;
  insert into public.game_members(game_id,user_id,full_name,kind,role_title)
  values(new_game,owner_user,'Regression Student','student','Министр образования');
  insert into public.state_metrics(game_id,metric_key,label,value,unit,is_public)
  values(new_game,'public_trust','Доверие граждан',60,'%',true)
  on conflict(game_id,metric_key) do update set value=60;
  seeded:=private.seed_event_bank(new_game);
  if seeded<>12 then raise exception 'Expected 12 cases, received %',seeded;end if;
  insert into public.event_auto_settings(game_id,enabled,interval_hours,activity_weight,max_daily,trust_per_20,backlog_penalty)
  values(new_game,true,4,1,2,2,1);
  control:=private.run_game_autopilot(new_game);
  sent:=(control->>'sent')::int;
  if sent<>1 then raise exception 'First automatic assignment should send one event, sent %',sent;end if;
  control:=private.run_game_autopilot(new_game);
  if control->>'reason'<>'already_checked' then raise exception 'Immediate repeat not rate-limited: %',control;end if;
  update public.event_assignments set created_at=now()-interval '6 hours' where game_id=new_game;
  update public.event_auto_settings set last_run_at=now()-interval '2 hours' where game_id=new_game;
  control:=private.run_game_autopilot(new_game);
  if (control->>'sent')::int<>1 then raise exception 'Second assignment after interval failed: %',control;end if;
  select count(*) into count_today from public.event_assignments where game_id=new_game;
  if count_today<>2 then raise exception 'Unexpected 24-hour assignments: %',count_today;end if;
  update public.event_assignments set created_at=now()-interval '6 hours' where game_id=new_game;
  update public.event_auto_settings set last_run_at=now()-interval '2 hours' where game_id=new_game;
  control:=private.run_game_autopilot(new_game);
  if (control->>'sent')::int<>0 then raise exception 'Daily limit failed: %',control;end if;

  perform set_config('request.jwt.claim.sub',owner_user::text,true);
  select ea.id into assignment_id from public.event_assignments ea where ea.game_id=new_game order by ea.created_at limit 1;
  perform public.submit_event_decision(assignment_id,'accept',null);
  begin
   perform public.submit_event_decision(assignment_id,'reject',null);
   raise exception 'Duplicate decision was accepted';
  exception when others then
   if sqlerrm='Duplicate decision was accepted' then raise;end if;
   if sqlerrm<>'Already decided' then raise;end if;
  end;
  select ec.id into case_id from public.event_cases ec where ec.game_id=new_game
    and not exists(select 1 from public.event_assignments ea where ea.case_id=ec.id) limit 1;
  insert into public.event_assignments(case_id,game_id,recipient_id,created_by)
  values(case_id,new_game,owner_user,null) returning id into assignment_id;
  perform public.submit_event_decision(assignment_id,'reject',null);
  -- Need 18 additional fresh cases for 20 decisions; each unique per actor.
  insert into public.event_cases(game_id,case_key,title,situation,category,seriousness,audience,status)
  select new_game,'regression-extra-'||n,'Regression case '||n,
   'Isolated simulated case for validating exactly-once trust awards.',
   'Государственное управление','serious','single','ready'
  from generate_series(1,18) n;
  insert into public.event_assignments(case_id,game_id,recipient_id,created_by)
  select ec.id,new_game,owner_user,null from public.event_cases ec
  where ec.game_id=new_game and ec.case_key like 'regression-extra-%';
  for assignment_id in select ea.id from public.event_assignments ea
    join public.event_cases ec on ec.id=ea.case_id
    where ea.game_id=new_game and ec.case_key like 'regression-extra-%'
  loop
    perform public.submit_event_decision(assignment_id,'accept',null);
  end loop;
  select count(*) into count_decisions from public.event_decisions where game_id=new_game;
  if count_decisions<>20 then raise exception 'Expected 20 decisions, got %',count_decisions;end if;
  select sm.value into trust from public.state_metrics sm where game_id=new_game and sm.metric_key='public_trust';
  if trust<>62 then raise exception 'First trust reward failed: %',trust;end if;
  perform private.apply_event_trust(new_game);
  select count(*) into count_ledger from public.event_trust_ledger
  where game_id=new_game and action_key='resolved-20';
  if count_ledger<>1 then raise exception 'Duplicate reward audit entry: %',count_ledger;end if;

  insert into public.event_cases(game_id,case_key,title,situation,category,seriousness,audience,status)
  select new_game,'regression-pending-'||n,'Regression backlog '||n,
   'Isolated simulated backlog test for trust penalties.',
   'Государственное управление','serious','single','ready'
  from generate_series(1,6) n;
  insert into public.event_assignments(case_id,game_id,recipient_id,created_by,created_at)
  select ec.id,new_game,owner_user,null,now()-interval '50 hours'
  from public.event_cases ec where ec.game_id=new_game and ec.case_key like 'regression-pending-%';
  perform private.apply_event_trust(new_game);
  select value into trust from public.state_metrics
  where game_id=new_game and metric_key='public_trust';
  if trust<>60 then raise exception 'Backlog penalty expected 2pp, got %',trust;end if;
  perform private.apply_event_trust(new_game);
  select count(*) into count_ledger from public.event_trust_ledger
  where game_id=new_game and action_key like 'backlog-%';
  if count_ledger<>1 then raise exception 'Backlog charged more than once/day: %',count_ledger;end if;
  update public.event_auto_settings set enabled=false,last_run_at=null where game_id=new_game;
  control:=private.run_game_autopilot(new_game);
  if control->>'reason'<>'paused' then raise exception 'Paused autopilot still runs: %',control;end if;
  result:=jsonb_build_object('status','PASS','bank_cases',seeded,'initial_dispatch',1,
     'repeat_dispatch','blocked','24h_limit',2,'duplicate_decision','blocked',
     'processed',count_decisions,'trust_reward',2,'backlog_penalty',-2,
     'reward_idempotent',true,'backlog_idempotent',true,'paused',true,
     'permanent_test_rows',0);
  -- Force a rollback of every test insert/update inside this nested block,
  -- while retaining the local result variable for the caller.
  raise exception 'GOS_SIM_TEST_ROLLBACK_SENTINEL';
 exception when raise_exception then
  if sqlerrm<>'GOS_SIM_TEST_ROLLBACK_SENTINEL' then raise;end if;
 end;
 return result;
end;
$$;
revoke all on function private.event_autopilot_selftest() from public,anon,authenticated;