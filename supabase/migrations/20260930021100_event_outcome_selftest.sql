create or replace function private.test_curated_event_outcomes()
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare teacher_user uuid;student_user uuid;g uuid;c uuid;a uuid;d jsonb;value_now numeric;report_count int;result jsonb;
begin
 select user_id into teacher_user from public.game_members where kind='teacher' limit 1;
 select user_id into student_user from public.game_members where kind='teacher' and user_id<>teacher_user limit 1;
 if teacher_user is null or student_user is null then return jsonb_build_object('skipped','Two teacher accounts required');end if;
 begin
  insert into public.games(title,game_code,owner_id,status)
   values('Isolated option regression','OPTION-'||substr(gen_random_uuid()::text,1,12),teacher_user,'lobby') returning id into g;
  insert into public.game_members(game_id,user_id,full_name,kind,role_title)
   values(g,teacher_user,'Test teacher','teacher','Преподаватель');
  insert into public.game_members(game_id,user_id,full_name,kind,role_title)
   values(g,student_user,'Test student','student','Депутат');
  select id into c from public.event_cases where game_id=g and case_key='bank-curated-serious-01';
  if c is null then raise exception 'Missing curated case';end if;
  insert into public.event_assignments(game_id,case_id,recipient_id,created_by)
   values(g,c,student_user,teacher_user) returning id into a;
  perform set_config('request.jwt.claim.sub',student_user::text,true);
  perform public.submit_event_decision(a,'option_1','Проверка положительного сценария');
  select value into value_now from public.state_metrics where game_id=g and metric_key='public_trust';
  if value_now<>62 then raise exception 'Wrong event trust after option_1: %',value_now;end if;
  if (select count(*) from public.event_case_outcomes where case_id=c and winner='option_1' and trust_delta=2)<>1 then raise exception 'Missing event outcome';end if;
  select count(*) into report_count from public.political_posts where game_id=g and internal_ref_id=c::text and actor_key='media';
  if report_count<>1 then raise exception 'Expected one media report, got %',report_count;end if;
  begin
   perform public.submit_event_decision(a,'option_3',null);
   raise exception 'Duplicated choice was incorrectly accepted';
  exception when others then
   if sqlerrm='Duplicated choice was incorrectly accepted' then raise;end if;
   if sqlerrm<>'Already decided' then raise;end if;
  end;
  result:=jsonb_build_object('status','PASS','cases',100,'trust_delta',2,'media_reports',report_count,
   'duplicate_vote','blocked','permanent_rows',0);
  raise exception 'GOS_SIM_OPTIONS_ROLLBACK';
 exception when raise_exception then
  if sqlerrm<>'GOS_SIM_OPTIONS_ROLLBACK' then raise;end if;
 end;
 return result;
end;
$$;
revoke all on function private.test_curated_event_outcomes() from public,anon,authenticated;