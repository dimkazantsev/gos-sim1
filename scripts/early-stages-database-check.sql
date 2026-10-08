-- Real RPC/RLS integration checks. All fictional records roll back.
begin;
do $fixture$
declare g uuid:=gen_random_uuid();t uuid;u uuid;ids uuid[]:='{}';i integer;p uuid;
begin
 select owner_id into t from public.games order by created_at limit 1;
 if t is null then raise exception 'QA requires an existing classroom owner';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA early stages','QA'||substr(replace(g::text,'-',''),1,12),t,'running',4,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title)
 values(g,t,'QA teacher','teacher','Преподаватель');
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 select g,n,'QA stage '||n,'Учебная процедура','QA','open' from generate_series(1,16) n;
 for i in 1..12 loop
  u:=gen_random_uuid();ids:=array_append(ids,u);
  insert into auth.users(id,aud,role) values(u,'authenticated','authenticated');
  if i<=11 then
   insert into public.game_members(game_id,user_id,full_name,kind,role_title,team)
   values(g,u,'QA participant '||i,(case when i=11 then 'observer' else 'student' end)::public.member_kind,'Участник',case when i<=10 then 'QA faction' end);
  end if;
 end loop;
 insert into public.game_parties(game_id,name,mandates,leader_user_id,registration_status)
 values(g,'QA faction',450,ids[1],'registered') returning id into p;
 insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 values(g,ids[10],'Председатель Государственной Думы','active',t,t,'QA',true);
 perform set_config('qa.early_game',g::text,true);
 perform set_config('qa.early_teacher',t::text,true);
 perform set_config('qa.early_users',array_to_json(ids)::text,true);
end;$fixture$;
set local role authenticated;
do $checks$
declare g uuid:=current_setting('qa.early_game')::uuid;t uuid:=current_setting('qa.early_teacher')::uuid;
 ids uuid[];unit uuid;other_unit uuid;e uuid;c uuid;result jsonb;before_rows text;after_rows text;blocked boolean;
begin
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(current_setting('qa.early_users')::jsonb);
 perform public.ensure_stage9_units(g);
 if exists(select 1 from public.institution_units where game_id=g) then raise exception 'FAIL stage 9 creates committees or unapproved ministries';end if;
 foreach c in array ids[1:1]||ids[11:12] loop
  perform set_config('request.jwt.claim.sub',c::text,true);
  blocked:=false;begin perform public.ensure_duma_committees(g);exception when others then blocked:=true;end;
  if not blocked then raise exception 'FAIL unauthorized committee creation';end if;
 end loop;
 perform set_config('request.jwt.claim.sub',ids[10]::text,true);
 perform public.ensure_duma_committees(g);
 if (select count(*) from public.institution_units where game_id=g and unit_kind='committee')<>5 then raise exception 'FAIL active Duma chair cannot create five committees';end if;
 if exists(select 1 from public.institution_units where game_id=g and unit_kind='ministry') then raise exception 'FAIL Duma creates ministries';end if;
 select string_agg(id::text||ctid::text,',' order by id) into before_rows from public.institution_units where game_id=g;
 perform public.ensure_duma_committees(g);
 select string_agg(id::text||ctid::text,',' order by id) into after_rows from public.institution_units where game_id=g;
 if before_rows is distinct from after_rows then raise exception 'FAIL repeated formation changes committee records';end if;
 if exists(select 1 from jsonb_to_recordset(public.get_committee_matrix(g)) as x(unit_id uuid,quota integer) group by unit_id having sum(quota)<>90) then raise exception 'FAIL committee quotas';end if;
 select id into unit from public.institution_units where game_id=g and unit_kind='committee' and unit_key='social';
 select id into other_unit from public.institution_units where game_id=g and unit_kind='committee' and unit_key='economic';
 perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 perform public.assign_institution_member(unit,ids[1]);
 e:=null;
 perform set_config('request.jwt.claim.sub',ids[10]::text,true);
 e:=public.create_committee_chair_election(unit,'open');
 if (select stage_no from public.office_elections where id=e)<>4 then raise exception 'FAIL chair election remains on stage 9';end if;
 blocked:=false;begin perform public.create_committee_chair_election(unit,'open');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL duplicate active chair election';end if;
 perform set_config('request.jwt.claim.sub',ids[12]::text,true);
 blocked:=false;begin perform public.create_committee_chair_election(other_unit,'open');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL outsider starts chair election';end if;
 perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 blocked:=false;begin perform public.nominate_office_candidate(e,ids[2]);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL candidate is not a committee member';end if;
 c:=public.nominate_office_candidate(e,ids[1]);
 perform set_config('request.jwt.claim.sub',t::text,true);perform public.open_office_election(e);
 perform set_config('request.jwt.claim.sub',ids[1]::text,true);perform public.set_office_ballot(e,c,226);
 perform set_config('request.jwt.claim.sub',t::text,true);result:=public.close_office_election(e);
 if result->>'status'<>'finished' or (select head_user_id from public.institution_units where id=unit)<>ids[1] then raise exception 'FAIL 226 votes do not elect committee chair';end if;
 if (select count(*) from public.office_ballots where election_id=e)<>1 then raise exception 'FAIL ballot persistence';end if;
 result:=public.get_stage_readiness(g,4);
 if (result->'metrics'->>'committees')::integer<>5 or (result->'metrics'->>'committee_heads')::integer<>1 then raise exception 'FAIL stage 4 committee readiness';end if;
 result:=public.get_stage_readiness(g,9);
 if result->'metrics' ? 'committees' or (result->'blockers')::text like '%комитет%' then raise exception 'FAIL stage 9 still checks committees';end if;
end;$checks$;
reset role;
do $ministries$
declare g uuid:=current_setting('qa.early_game')::uuid;t uuid:=current_setting('qa.early_teacher')::uuid;ids uuid[];i integer;keys text[]:=array['social','economic','defence','foreign','internal'];
begin
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(current_setting('qa.early_users')::jsonb);
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into public.government_structures(game_id,status,proposed_by,reviewed_by) values(g,'approved',t,t);
 for i in 1..5 loop
  insert into public.government_nominations(game_id,stage_no,office_key,office_title,office_kind,route,candidate_user_id,candidate_name,nominated_by,status)
  values(g,8,'ministry_'||keys[i],'Министр QA '||i,'duma_minister','pm_to_duma',ids[i],'QA minister '||i,t,'appointed');
 end loop;
end;$ministries$;
set local role authenticated;
do $staffing$
declare g uuid:=current_setting('qa.early_game')::uuid;t uuid:=current_setting('qa.early_teacher')::uuid;ids uuid[];i integer;u uuid;keys text[]:=array['social','economic','defence','foreign','internal'];r jsonb;blocked boolean;before_rows text;after_rows text;
begin
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(current_setting('qa.early_users')::jsonb);
 perform public.ensure_stage9_units(g);
 if (select count(*) from public.institution_units where game_id=g and unit_kind='ministry')<>5 then raise exception 'FAIL approved ministry structure';end if;
 if (select count(*) from public.institution_assignments where game_id=g and unit_kind='ministry' and assignment_role='head')<>5 then raise exception 'FAIL ministers not included in staff';end if;
 select string_agg(id::text||ctid::text,',' order by id) into before_rows from public.institution_assignments where game_id=g and unit_kind='ministry';
 perform public.ensure_stage9_units(g);perform public.ensure_stage9_units(g);
 select string_agg(id::text||ctid::text,',' order by id) into after_rows from public.institution_assignments where game_id=g and unit_kind='ministry';
 if before_rows is distinct from after_rows then raise exception 'FAIL ministry refresh changes unchanged assignments';end if;
 select id into u from public.institution_units where game_id=g and unit_kind='ministry' and unit_key='social';
 blocked:=false;begin perform public.set_institution_head(u,ids[6]);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL ministry head bypasses stage 8 appointment';end if;
 for i in 1..5 loop
  select id into u from public.institution_units where game_id=g and unit_kind='ministry' and unit_key=keys[i];
  perform public.assign_institution_member(u,ids[i+5]);
 end loop;
 r:=public.get_stage_readiness(g,9);
 if not (r->>'ready')::boolean or (r->'metrics'->>'unassigned_students')::integer<>0 then raise exception 'FAIL staffed ministries blocked: %',r;end if;
 perform set_config('request.jwt.claim.sub',ids[12]::text,true);
 if exists(select 1 from public.institution_units where game_id=g) then raise exception 'FAIL outsider reads committee/ministry records';end if;
 blocked:=false;begin perform public.ensure_stage9_units(g);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL outsider syncs ministries';end if;
end;$staffing$;
reset role;
select jsonb_build_object('stage9_no_automatic_creation','PASS','student_observer_outsider_creation_denied','PASS','active_duma_chair_creation','PASS','five_committees_only','PASS','idempotent_committee_creation','PASS','quota_90','PASS','chair_election_stage4','PASS','duplicate_election_denied','PASS','outsider_election_denied','PASS','candidate_membership','PASS','226_votes_and_saved_ballot','PASS','stage4_readiness','PASS','stage9_staffing_only_readiness','PASS','approved_ministries_and_saved_heads','PASS','idempotent_ministry_refresh','PASS','minister_appointment_bypass_denied','PASS','staffing_readiness','PASS','outsider_rls','PASS') checks;
rollback;
