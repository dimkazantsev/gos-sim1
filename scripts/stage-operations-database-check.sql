-- Real RPC and RLS checks in an isolated classroom. All fixtures roll back.
begin;
do $fixture$
declare g uuid:=gen_random_uuid();t uuid;u uuid;ids uuid[]:='{}';i integer;
begin
 select owner_id into t from public.games order by created_at limit 1;
 if t is null then raise exception 'QA requires a classroom owner';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA stages 8–16','QA'||substr(replace(g::text,'-',''),1,12),t,'running',11,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name)
 values(g,t,'QA teacher','teacher','Преподаватель','QA');
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 select g,n,'QA stage '||n,'Учебная процедура','QA',case when n=11 then 'open' else 'locked' end from generate_series(1,16) n;
 for i in 1..13 loop
  u:=gen_random_uuid();ids:=array_append(ids,u);
  insert into auth.users(id,aud,role) values(u,'authenticated','authenticated');
  if i<=12 then
   insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name)
   values(g,u,'QA participant '||i,'student','Депутат Государственной Думы','QA');
  end if;
 end loop;
 perform set_config('qa.stage_game',g::text,true);
 perform set_config('qa.stage_teacher',t::text,true);
 perform set_config('qa.stage_users',array_to_json(ids)::text,true);
end;$fixture$;
set local role authenticated;
do $checks$
declare g uuid:=current_setting('qa.stage_game')::uuid;t uuid:=current_setting('qa.stage_teacher')::uuid;
 ids uuid[];i integer;before_rows text;after_rows text;v uuid;r jsonb;blocked boolean;
begin
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(current_setting('qa.stage_users')::jsonb);
 perform public.ensure_stage9_units(g);
 select string_agg(id::text||ctid::text,',' order by id) into before_rows from public.institution_units where game_id=g;
 perform public.ensure_stage9_units(g);perform public.ensure_stage9_units(g);
 select string_agg(id::text||ctid::text,',' order by id) into after_rows from public.institution_units where game_id=g;
 if before_rows is distinct from after_rows then raise exception 'FAIL unchanged stage 9 refresh updates rows';end if;
 if (select count(*) from public.institution_units where game_id=g)<>10 then raise exception 'FAIL five committees and five ministries';end if;
 for i in 1..5 loop
  perform public.appoint_game_office(g,ids[i],'Министр QA '||i,'QA active assignment',true);
 end loop;
 v:=public.create_civic_vote(g,'QA government no quorum',null,'member','government','registered_session','fraction',.5,'present_majority',.5,true,false,null,'none','none','QA');
 if (select (electorate_snapshot->>'eligible')::numeric from public.game_votes where id=v)<>5 then raise exception 'FAIL non-government students enter denominator';end if;
 perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 blocked:=false;begin perform public.cast_vote_allocation(v,1,0,0);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL attendance gate';end if;
 for i in 1..2 loop
  perform set_config('request.jwt.claim.sub',ids[i]::text,true);
  perform public.register_institution_session_at_stage(g,'government',11);
  perform public.cast_vote_allocation(v,1,0,0);
 end loop;
 perform set_config('request.jwt.claim.sub',t::text,true);
 r:=public.close_procedural_vote(v);
 if r->>'result'<>'no_quorum' or (r->>'needed')::numeric<>3 then raise exception 'FAIL two of five quorum: %',r;end if;
 v:=public.create_civic_vote(g,'QA active office ballots',null,'member','government','registered_session','fraction',.5,'present_majority',.5,true,false,null,'none','none','QA');
 for i in 1..3 loop
  perform set_config('request.jwt.claim.sub',ids[i]::text,true);
  perform public.register_institution_session_at_stage(g,'government',11);
  perform public.cast_vote_allocation(v,1,0,0);
 end loop;
 perform set_config('request.jwt.claim.sub',ids[6]::text,true);
 blocked:=false;begin perform public.register_institution_session_at_stage(g,'government',11);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL unappointed government member registers';end if;
 blocked:=false;begin perform public.cast_vote_allocation(v,1,0,0);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL unappointed government member votes';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);
 r:=public.close_procedural_vote(v);
 if r->>'result'<>'passed' or (r->>'eligible')::numeric<>5 or (r->>'present')::numeric<>3 or (r->>'yes')::numeric<>3 then raise exception 'FAIL three of five assigned ministers: %',r;end if;
 perform public.close_procedural_vote(v);
 if (select count(*) from public.game_ballots where vote_id=v)<>3 then raise exception 'FAIL repeated close changes ballots';end if;
 for i in 8..16 loop
  r:=public.get_stage_readiness(g,i);
  if r is null or r->>'stage_no'<>i::text or jsonb_typeof(r->'blockers')<>'array' then raise exception 'FAIL readiness stage %: %',i,r;end if;
 end loop;
 perform set_config('request.jwt.claim.sub',ids[13]::text,true);
 if exists(select 1 from public.games where id=g) or exists(select 1 from public.institution_units where game_id=g) then raise exception 'FAIL outsider reads classroom';end if;
 blocked:=false;begin perform public.get_stage_readiness(g,8);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL outsider reads readiness';end if;
end;$checks$;
reset role;
select jsonb_build_object('idempotent_stage9_refresh','PASS','five_committees_and_ministries','PASS','active_assignment_vote','PASS','five_member_denominator','PASS','attendance_required','PASS','two_of_five_blocked','PASS','three_of_five_passed','PASS','unappointed_member_blocked','PASS','readiness_8_to_16','PASS','outsider_rls','PASS','repeat_close','PASS') checks;
rollback;
