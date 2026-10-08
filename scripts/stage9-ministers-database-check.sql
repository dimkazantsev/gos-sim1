-- Real RPC/RLS checks using explicitly fictional, transaction-scoped records.
begin;
do $fixture$
declare g uuid:=gen_random_uuid();t uuid;u uuid;p uuid;ids uuid[]:='{}';i integer;
begin
 select owner_id into t from public.games order by created_at limit 1;
 if t is null then raise exception 'QA requires an existing classroom owner';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA minister appointments','QA'||substr(replace(g::text,'-',''),1,12),t,'running',9,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title)
 values(g,t,'QA teacher','teacher','Преподаватель');
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 select g,n,'QA stage '||n,'Учебная процедура','QA','open' from generate_series(1,16) n;
 for i in 1..9 loop
  u:=gen_random_uuid();ids:=array_append(ids,u);
  insert into auth.users(id,aud,role) values(u,'authenticated','authenticated');
  if i<=8 then
   insert into public.game_members(game_id,user_id,full_name,kind,role_title,team)
   values(g,u,'QA participant '||i,'student',case when i=1 then 'Президент Российской Федерации' else 'Депутат Государственной Думы' end,'QA faction');
  end if;
 end loop;
 for i in 1..8 loop
  insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
  values(g,ids[i],'Депутат Государственной Думы','active',t,t,'QA parliamentary mandate',true) on conflict do nothing;
 end loop;
 insert into public.game_parties(game_id,name,mandates,leader_user_id,registration_status)
 values(g,'QA faction',450,ids[3],'registered') returning id into p;
 for i in 1..8 loop
  insert into public.party_member_mandates(game_id,party_id,user_id,base_mandates,effective_mandates)
  values(g,p,ids[i],case when i=8 then 58 else 56 end,case when i=8 then 58 else 56 end)
  on conflict(game_id,party_id,user_id) do update set base_mandates=excluded.base_mandates,effective_mandates=excluded.effective_mandates;
 end loop;
 perform set_config('qa.minister_game',g::text,true);
 perform set_config('qa.minister_teacher',t::text,true);
 perform set_config('qa.minister_users',array_to_json(ids)::text,true);
end;$fixture$;
set local role authenticated;
do $checks$
declare g uuid:=current_setting('qa.minister_game')::uuid;t uuid:=current_setting('qa.minister_teacher')::uuid;
 ids uuid[];n uuid;v uuid;d uuid;u uuid;i integer;j integer;weight numeric;blocked boolean;r jsonb;
 keys text[]:=array['social','economic','foreign','defence','internal'];nominees uuid[]:='{}';
begin
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(current_setting('qa.minister_users')::jsonb);
 blocked:=false;begin perform public.submit_government_nomination(g,'ministry_social','QA social','deputy_pm',ids[3],'QA social');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL minister nomination before Prime Minister';end if;
 n:=public.submit_government_nomination(g,'prime_minister','Председатель Правительства Российской Федерации','prime_minister',ids[2],'QA Prime Minister');
 if (select stage_no from public.government_nominations where id=n)<>8 or (select stage_no from public.formal_documents where id=(select formal_document_id from public.government_nominations where id=n))<>8 then raise exception 'FAIL Prime Minister belongs to stage 8';end if;
 v:=public.open_government_nomination_vote(n);
 if (select stage_no from public.game_votes where id=v)<>8 then raise exception 'FAIL Prime Minister vote stage';end if;
 for i in 1..8 loop
  perform set_config('request.jwt.claim.sub',ids[i]::text,true);
  perform public.register_institution_session_at_stage(g,'gd',8);
  select effective_mandates into weight from public.party_member_mandates where game_id=g and user_id=ids[i];
  perform public.cast_vote_allocation(v,weight,0,0);
 end loop;
 perform set_config('request.jwt.claim.sub',t::text,true);
 r:=public.close_procedural_vote(v);
 if r->>'result'<>'passed' then raise exception 'FAIL Prime Minister vote: %',r;end if;
 perform set_config('request.jwt.claim.sub',ids[9]::text,true);
 blocked:=false;begin perform public.appoint_government_nominee(n);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL outsider appointment';end if;
 perform set_config('request.jwt.claim.sub',ids[3]::text,true);
 blocked:=false;begin perform public.appoint_government_nominee(n);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL ordinary student appointment';end if;
 perform set_config('request.jwt.claim.sub',ids[1]::text,true);
 perform public.appoint_government_nominee(n);
 if (select stage_no from public.formal_documents where id=(select appointment_document_id from public.government_nominations where id=n))<>8 then raise exception 'FAIL Prime Minister decree stage';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);
 blocked:=false;begin perform public.submit_government_nomination(g,'ministry_defence','QA defence','security_minister',ids[6],'QA defence');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL ministry without approved structure';end if;
 n:=public.submit_government_nomination(g,'central_bank_chair','Председатель Центрального банка Российской Федерации','central_bank_chair',ids[8],'QA Bank Chair');
 v:=public.open_government_nomination_vote(n);
 for i in 1..8 loop
  perform set_config('request.jwt.claim.sub',ids[i]::text,true);
  select effective_mandates into weight from public.party_member_mandates where game_id=g and user_id=ids[i];
  perform public.cast_vote_allocation(v,weight,0,0);
 end loop;
 perform set_config('request.jwt.claim.sub',t::text,true);
 r:=public.close_procedural_vote(v);
 if (select status from public.government_nominations where id=n)<>'appointed' then raise exception 'FAIL Bank Chair appointment';end if;
 perform public.save_government_structure(g,'QA social','QA economic','QA defence','QA foreign','QA internal',true);
 perform public.review_government_structure(g,'approve',null);
 if (select stage_no from public.formal_documents where id=(select formal_document_id from public.government_structures where game_id=g))<>8 then raise exception 'FAIL structure decree stage';end if;
 r:=public.get_stage_readiness(g,8);
 if not (r->>'ready')::boolean or r->'metrics' ? 'ministers_appointed' then raise exception 'FAIL stage 8 requires ministers: %',r;end if;
 perform public.ensure_stage9_units(g);
 r:=public.get_stage_readiness(g,9);
 if (r->>'ready')::boolean or (r->'metrics'->>'ministers_appointed')::integer<>0 then raise exception 'FAIL stage 9 completes without ministers';end if;
 perform set_config('request.jwt.claim.sub',ids[3]::text,true);
 blocked:=false;begin perform public.submit_government_nomination(g,'ministry_social','QA social','deputy_pm',ids[3],'QA social');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL unauthorized minister nomination';end if;
 for j in 1..5 loop
  perform set_config('request.jwt.claim.sub',case when j<=3 then ids[2]::text else ids[1]::text end,true);
  n:=public.submit_government_nomination(g,'ministry_'||keys[j],'Министр QA '||keys[j],case when j=1 then 'deputy_pm' when j<=3 then 'duma_minister' else 'security_minister' end,ids[j+2],'QA minister '||keys[j]);
  nominees:=array_append(nominees,n);
  if (select stage_no from public.government_nominations where id=n)<>9 then raise exception 'FAIL minister nomination stage';end if;
  blocked:=false;begin perform public.appoint_government_nominee(n);exception when others then blocked:=true;end;
  if not blocked then raise exception 'FAIL appointment before approval/consultation';end if;
  perform set_config('request.jwt.claim.sub',t::text,true);
  if j<=3 then
   select formal_document_id into d from public.government_nominations where id=n;
   if (select stage_no from public.formal_documents where id=d)<>9 or (select metadata->>'stage_no' from public.formal_documents where id=d)<>'9' then raise exception 'FAIL minister draft stage';end if;
   v:=public.open_government_nomination_vote(n);
   if (select stage_no from public.game_votes where id=v)<>9 then raise exception 'FAIL minister vote stage';end if;
   for i in 1..8 loop
    perform set_config('request.jwt.claim.sub',ids[i]::text,true);
    perform public.register_institution_session_at_stage(g,'gd',9);
    select effective_mandates into weight from public.party_member_mandates where game_id=g and user_id=ids[i];
    perform public.cast_vote_allocation(v,weight,0,0);
   end loop;
   perform set_config('request.jwt.claim.sub',t::text,true);
   r:=public.close_procedural_vote(v);
   if r->>'result'<>'passed' or (select status from public.government_nominations where id=n)<>'approved' then raise exception 'FAIL minister approval: %',r;end if;
  else
   perform public.record_sf_consultation(n,'QA consultation completed');
  end if;
  perform set_config('request.jwt.claim.sub',ids[1]::text,true);
  perform public.appoint_government_nominee(n);
  select appointment_document_id into d from public.government_nominations where id=n;
  if (select stage_no from public.formal_documents where id=d)<>9 or (select metadata->>'stage_no' from public.formal_documents where id=d)<>'9' then raise exception 'FAIL minister decree stage';end if;
 end loop;
 perform set_config('request.jwt.claim.sub',t::text,true);
 perform public.ensure_stage9_units(g);
 if (select count(*) from public.institution_assignments where game_id=g and unit_kind='ministry' and assignment_role='head')<>5 then raise exception 'FAIL minister staff synchronization';end if;
 for i in 1..3 loop
  select id into u from public.institution_units where game_id=g and unit_kind='ministry' and unit_key=keys[i];
  perform public.assign_institution_member(u,case when i=3 then ids[8] else ids[i] end);
 end loop;
 r:=public.get_stage_readiness(g,9);
 if not (r->>'ready')::boolean or (r->'metrics'->>'ministers_appointed')::integer<>5 or (r->'metrics'->>'unassigned_students')::integer<>0 then raise exception 'FAIL completed minister stage: %',r;end if;
 if exists(select 1 from public.institution_units where game_id=g and unit_kind='committee') then raise exception 'FAIL ministry procedures create committees';end if;
 if exists(select 1 from public.game_events where game_id=g and title like 'Назначение · Министр QA%' and round_no<>9) then raise exception 'FAIL minister events stage';end if;
 perform set_config('request.jwt.claim.sub',ids[9]::text,true);
 if exists(select 1 from public.government_nominations where game_id=g) then raise exception 'FAIL outsider reads nominations';end if;
 blocked:=false;begin perform public.submit_government_nomination(g,'ministry_social','QA social','deputy_pm',ids[3],'QA social');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL outsider submits nomination';end if;
end;$checks$;
reset role;
select jsonb_build_object('prime_minister_and_bank_stage8','PASS','stage8_ready_before_ministers','PASS','ministry_prerequisites','PASS','five_nominations_stage9','PASS','three_duma_approvals','PASS','two_sf_consultations','PASS','premature_appointments_denied','PASS','nomination_and_appointment_documents_stage9','PASS','minister_votes_and_events_stage9','PASS','five_saved_heads_and_staff','PASS','stage9_readiness','PASS','no_committees_created','PASS','student_and_outsider_access_denied','PASS') checks;
rollback;
