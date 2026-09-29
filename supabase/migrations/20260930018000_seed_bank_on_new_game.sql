-- New games get the complete 500-case scenario bank immediately when
-- the creating teacher joins. This does not run for ordinary student joins.
create or replace function private.seed_bank_when_teacher_joins()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if new.kind='teacher' then
  perform private.seed_event_bank_extended(new.game_id);
 end if;
 return new;
end;
$$;
drop trigger if exists seed_event_bank_on_new_teacher on public.game_members;
create trigger seed_event_bank_on_new_teacher
 after insert on public.game_members for each row
 when (new.kind='teacher') execute function private.seed_bank_when_teacher_joins();

create or replace function private.test_new_game_bank()
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare actor uuid;g uuid;total integer;serious integer;light integer;whole integer;result jsonb;
begin
 select gm.user_id into actor from public.game_members gm where gm.kind='teacher' limit 1;
 if actor is null then return jsonb_build_object('status','SKIPPED','reason','No teacher account');end if;
 begin
  insert into public.games(title,game_code,owner_id,status)
   values('Isolated bank validation','BANK-TEST-'||substr(gen_random_uuid()::text,1,12),actor,'lobby')
   returning id into g;
  insert into public.game_members(game_id,user_id,full_name,kind,role_title)
   values(g,actor,'Bank test teacher','teacher','Преподаватель');
  select count(*),count(*) filter(where seriousness='serious'),
     count(*) filter(where seriousness='light'),count(*) filter(where audience='all')
  into total,serious,light,whole from public.event_cases where game_id=g and case_key like 'bank-%';
  if (total,serious,light,whole)<>(500,300,200,25) then
   raise exception 'Bank counts failed: total %, serious %, light %, all %',total,serious,light,whole;
  end if;
  perform private.seed_event_bank_extended(g);
  if (select count(*) from public.event_cases where game_id=g and case_key like 'bank-%')<>500
  then raise exception 'Repeated bank seed was not idempotent';end if;
  result:=jsonb_build_object('status','PASS','total',total,'serious',serious,'light',light,'all_audience',whole,'duplicates',0,'permanent_rows',0);
  raise exception 'GOS_SIM_BANK_TEST_ROLLBACK';
 exception when raise_exception then
  if sqlerrm<>'GOS_SIM_BANK_TEST_ROLLBACK' then raise;end if;
 end;
 return result;
end;
$$;
revoke all on function private.test_new_game_bank() from public,anon,authenticated;