-- Integration regression on fictional records. No Storage blobs are uploaded.
-- Every record and attempted change is transaction scoped and rolled back.
begin;
do $fixture$
declare g uuid:=gen_random_uuid();t uuid;u uuid;ids uuid[]:='{}';i integer;p1 uuid;p2 uuid;c uuid;unit uuid;program uuid;assessment uuid;
begin
 select owner_id into t from public.games order by created_at limit 1;
 if t is null then raise exception 'QA requires an existing classroom owner';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA project security','QA'||substr(replace(g::text,'-',''),1,12),t,'running',9,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title)
 values(g,t,'QA teacher','teacher','Преподаватель');
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 select g,n,'QA stage '||n,'Учебная процедура','QA','open' from generate_series(1,16)n;
 for i in 1..8 loop
  u:=gen_random_uuid();ids:=array_append(ids,u);
  insert into auth.users(id,aud,role) values(u,'authenticated','authenticated');
  if i<=7 then insert into public.game_members(game_id,user_id,full_name,kind,role_title,roster_archived_at)
   values(g,u,'QA member '||i,(case when i=7 then 'observer' else 'student' end)::public.member_kind,'Участник',case when i=6 then now() end);end if;
 end loop;
 insert into public.game_parties(game_id,name,mandates,support,registration_status)values(g,'QA A',450,100,'registered')returning id into p1;
 insert into public.game_parties(game_id,name,mandates,support,registration_status)values(g,'QA B',0,0,'registered')returning id into p2;
 insert into public.chat_channels(game_id,name,kind,created_by)values(g,'QA public','public',t)returning id into c;
 insert into public.government_structures(game_id,status,proposed_by,reviewed_by)values(g,'approved',t,t);
 insert into public.government_nominations(game_id,stage_no,office_key,office_title,office_kind,route,candidate_user_id,candidate_name,nominated_by,status)
 values(g,8,'prime_minister','QA PM','prime_minister','president_to_duma',ids[1],'QA PM',t,'appointed');
 insert into public.institution_units(game_id,unit_kind,unit_key,title,head_user_id)values(g,'ministry','social','QA social',ids[2])returning id into unit;
 insert into public.state_programs(game_id,responsible_ministry,title,created_by,responsible_minister_id,status)
 values(g,'QA social','QA program',t,ids[2],'pm_review')returning id into program;
 insert into public.presidential_candidates(game_id,display_name,nomination_type,registration_status,created_by)
 values(g,'QA active candidate','fictional','registered',t);
 insert into public.game_reflections(game_id,user_id,phase_key,status)
 select g,who,phase,'submitted' from unnest(array[t,ids[1],ids[2],ids[3],ids[4],ids[6]])who
 cross join unnest(array['foundation','parliament','executive','policy','territory','debrief'])phase;
 insert into public.stage_deadline_incidents(game_id,stage_no,user_id,consequence_type,note,created_by,penalty_points)
 values(g,11,ids[3],'other','QA half-point deadline penalty',t,0.5);
 insert into public.stage_assessments(game_id,stage_no,user_id,auto_score)values(g,11,ids[3],3)
 on conflict(game_id,stage_no,user_id)do update set auto_score=3 returning id into assessment;
 perform set_config('qa.audit_half_point',((select auto_score from public.stage_assessments where id=assessment)=2.5)::text,true);
 perform set_config('request.jwt.claim.sub',ids[3]::text,true);
 insert into public.chat_messages(game_id,channel_id,author_id,kind,text)values(g,c,ids[3],'text','QA message');
 assessment:=private.compute_vsn_assessment(g,ids[3],11,'manual');
 perform set_config('qa.audit_journal',((select auto_score from public.stage_assessments where id=assessment)=0.5 and
  (select auto_score from public.stage_assessment_runs where assessment_id=assessment order by id desc limit 1)=0.5)::text,true);
 perform set_config('request.jwt.claim.sub',t::text,true);
 perform set_config('qa.audit_game',g::text,true);perform set_config('qa.audit_teacher',t::text,true);
 perform set_config('qa.audit_users',array_to_json(ids)::text,true);perform set_config('qa.audit_parties',array_to_json(array[p1,p2])::text,true);
 perform set_config('qa.audit_channel',c::text,true);perform set_config('qa.audit_unit',unit::text,true);perform set_config('qa.audit_program',program::text,true);
end;$fixture$;
set local role authenticated;
do $checks$
declare g uuid:=current_setting('qa.audit_game')::uuid;t uuid:=current_setting('qa.audit_teacher')::uuid;ids uuid[];parties uuid[];
 c uuid:=current_setting('qa.audit_channel')::uuid;unit uuid:=current_setting('qa.audit_unit')::uuid;program uuid:=current_setting('qa.audit_program')::uuid;
 denied boolean;checks jsonb:='{}';one jsonb;all_stages jsonb;support jsonb;districts jsonb;result jsonb;first_nominee uuid;u uuid;event_id uuid;assignment_id uuid;options jsonb;
begin
 select array_agg(value::uuid)into ids from jsonb_array_elements_text(current_setting('qa.audit_users')::jsonb);
 select array_agg(value::uuid)into parties from jsonb_array_elements_text(current_setting('qa.audit_parties')::jsonb);
 support:=jsonb_build_object(parties[1]::text,100,parties[2]::text,0);
 districts:=jsonb_build_object(parties[1]::text,0,parties[2]::text,0);
 result:=jsonb_build_object(parties[1]::text,450,parties[2]::text,0);
 perform set_config('request.jwt.claim.sub',ids[8]::text,true);
 denied:=false;begin perform public.assign_institution_member(unit,ids[3]);raise exception using errcode='ZX001';exception when sqlstate 'ZX001' then denied:=false;when others then denied:=true;end;
 checks:=checks||jsonb_build_object('outsider_ministry_assignment',case when denied then 'PASS'else 'FAIL'end);
 denied:=false;begin perform public.advance_state_program(program,'pm_ready');raise exception using errcode='ZX001';exception when sqlstate 'ZX001' then denied:=false;when others then denied:=true;end;
 checks:=checks||jsonb_build_object('outsider_program_approval',case when denied then 'PASS'else 'FAIL'end);
 perform set_config('request.jwt.claim.sub',ids[7]::text,true);
 denied:=false;begin
  insert into storage.objects(bucket_id,name,owner)values('game-media',gen_random_uuid()::text||'/'||c::text||'/'||ids[7]::text||'/qa.txt',ids[7]);
  raise exception using errcode='ZX001';exception when sqlstate 'ZX001' then denied:=false;when others then denied:=true;end;
 checks:=checks||jsonb_build_object('observer_media_scope',case when denied then 'PASS'else 'FAIL'end);
 perform set_config('request.jwt.claim.sub',ids[3]::text,true);
 denied:=false;begin
  insert into public.chat_messages(game_id,channel_id,author_id,kind,text,storage_path)
  values(g,c,ids[3],'file','QA file',g::text||'/'||c::text||'/'||ids[2]::text||'/qa.txt');
  raise exception using errcode='ZX001';exception when sqlstate 'ZX001' then denied:=false;when others then denied:=true;end;
 checks:=checks||jsonb_build_object('chat_media_author_scope',case when denied then 'PASS'else 'FAIL'end);
 perform set_config('request.jwt.claim.sub',t::text,true);
 denied:=false;begin perform public.publish_electoral_calculator_result(g,'proportional','droop',null,support,districts,'{}');exception when others then denied:=true;end;
 checks:=checks||jsonb_build_object('empty_electoral_result',case when denied then 'PASS'else 'FAIL'end);
 denied:=false;begin perform public.publish_regional_calculator_result(g,'agreement','{}',jsonb_build_object(parties[1]::text,-1,parties[2]::text,90));exception when others then denied:=true;end;
 checks:=checks||jsonb_build_object('negative_regional_result',case when denied then 'PASS'else 'FAIL'end);
 one:=public.get_stage_readiness(g,6);all_stages:=public.get_game_readiness(g);
 checks:=checks||jsonb_build_object('readiness_rpc_consistency',case when one=(select x from jsonb_array_elements(all_stages)x where(x->>'stage_no')::int=6)then 'PASS'else 'FAIL'end);
 one:=public.get_stage_readiness(g,9);
 checks:=checks||jsonb_build_object('archived_student_excluded',case when(one->'metrics'->>'unassigned_students')::int=5 then 'PASS'else 'FAIL'end);
 one:=public.get_stage_readiness(g,16);
 checks:=checks||jsonb_build_object('active_student_reflections',case when not(one->>'ready')::boolean and(one->'metrics'->>'students')::int=5 and(one->'metrics'->>'students_completed_reflection')::int=4 then 'PASS'else 'FAIL'end);
 first_nominee:=public.submit_government_nomination(g,'ministry_social','QA social','deputy_pm',ids[2],'QA social minister');
 denied:=false;begin perform public.submit_government_nomination(g,'ministry_economic','QA economy','duma_minister',ids[2],'QA same minister');exception when others then denied:=true;end;
 checks:=checks||jsonb_build_object('one_ministry_per_candidate',case when denied then 'PASS'else 'FAIL'end);
 perform public.publish_electoral_calculator_result(g,'proportional','droop',null,support,districts,result);
 checks:=checks||jsonb_build_object('valid_electoral_publication','PASS');
 result:=jsonb_build_object(parties[1]::text,89,parties[2]::text,0);
 perform public.publish_regional_calculator_result(g,'proportional',jsonb_build_object('mandates',jsonb_build_object(parties[1]::text,450,parties[2]::text,0)),result);
 checks:=checks||jsonb_build_object('valid_regional_proportional_publication','PASS');
 perform public.publish_regional_calculator_result(g,'agreement',jsonb_build_object('agreement',result),result);
 checks:=checks||jsonb_build_object('valid_regional_agreement_publication','PASS');
 checks:=checks||jsonb_build_object('half_point_penalty',case when current_setting('qa.audit_half_point')::boolean then 'PASS'else 'FAIL'end,
  'journal_uses_stored_score',case when current_setting('qa.audit_journal')::boolean then 'PASS'else 'FAIL'end);

 options:='[{"label":"Законное решение","trust":2,"description":"Проверяемое положительное последствие","authorized_roles":["Участник"],"lawful":true,"legal_basis":"Учебная компетенция назначенного участника","protects_role_interest":false},{"label":"Незаконное решение","trust":2,"description":"Последствие вне установленной процедуры","authorized_roles":["Участник"],"lawful":false,"legal_basis":"Нарушение установленного учебного порядка","protects_role_interest":false}]';
 event_id:=public.create_assigned_event(g,'QA legal manual event','QA isolated event with explicit teacher classification.','Тест','serious','single',options,array[ids[4]]);
 checks:=checks||jsonb_build_object('manual_event_metadata_preserved',case when
  (select effect_plan->'options'->0->'authorized_roles' from public.event_cases where id=event_id)='["Участник"]'::jsonb and
  (select (effect_plan->'options'->0->>'lawful')::boolean from public.event_cases where id=event_id) and
  (select (effect_plan->'options'->1->>'lawful')::boolean from public.event_cases where id=event_id)=false
  then 'PASS'else 'FAIL'end);
 update public.state_metrics set value=50 where game_id=g and metric_key='public_trust';
 select id into assignment_id from public.event_assignments where case_id=event_id;
 perform set_config('request.jwt.claim.sub',ids[4]::text,true);
 perform public.submit_event_decision(assignment_id,'option_1','QA lawful action');
 checks:=checks||jsonb_build_object('lawful_manual_event_authority',case when exists(select 1 from public.event_authority_evidence where case_id=event_id and authority_ok and lawful)then 'PASS'else 'FAIL'end);
 checks:=checks||jsonb_build_object('lawful_manual_event_trust',case when(select value from public.state_metrics where game_id=g and metric_key='public_trust')=53 and(select trust_delta from public.event_case_outcomes where case_id=event_id)=3 then 'PASS'else 'FAIL'end);
 perform set_config('request.jwt.claim.sub',t::text,true);
 event_id:=public.create_assigned_event(g,'QA unlawful manual event','QA isolated event retaining explicit unlawful classification.','Тест','serious','single',options,array[ids[4]]);
 select id into assignment_id from public.event_assignments where case_id=event_id;
 perform set_config('request.jwt.claim.sub',ids[4]::text,true);
 perform public.submit_event_decision(assignment_id,'option_2','QA unlawful action');
 checks:=checks||jsonb_build_object('unlawful_manual_event_penalty',case when exists(select 1 from public.event_authority_evidence where case_id=event_id and authority_ok and not lawful)and(select trust_delta from public.event_case_outcomes where case_id=event_id)=-2 then 'PASS'else 'FAIL'end);
 perform set_config('request.jwt.claim.sub',t::text,true);
 denied:=false;begin
  perform public.create_assigned_event(g,'QA malformed manual event','QA isolated event with malformed legal classification.','Тест','serious','single',jsonb_set(options,'{0,lawful}','"true"'),array[ids[4]]);
  raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001'then denied:=false;when others then denied:=true;end;
 checks:=checks||jsonb_build_object('malformed_manual_metadata_denied',case when denied then 'PASS'else 'FAIL'end);

 if exists(select 1 from jsonb_each_text(checks)where value<>'PASS')then raise exception 'Security regression failed: %',checks;end if;
 perform set_config('qa.audit_checks',checks::text,true);
end;$checks$;
select current_setting('qa.audit_checks')::jsonb checks;
rollback;
