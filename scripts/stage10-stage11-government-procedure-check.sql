begin;
set local statement_timeout='35s';
set local lock_timeout='4s';
do $seed$
declare g uuid:=gen_random_uuid();ids jsonb:='{}';k text;u uuid;addr uuid;prior uuid;payload jsonb;
begin
 foreach k in array array['teacher','pm','minister','deputy','observer'] loop
  u:=gen_random_uuid();insert into auth.users(id,aud,role) values(u,'authenticated','authenticated');ids:=ids||jsonb_build_object(k,u);
 end loop;
 perform set_config('request.jwt.claim.sub',ids->>'teacher',true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA stage10–11 procedure','QA'||substr(replace(g::text,'-',''),1,12),(ids->>'teacher')::uuid,'running',10,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name)
 select g,(ids->>v.k)::uuid,'QA '||v.k,v.kind::public.member_kind,v.title,'QA'
 from (values('teacher','teacher','Преподаватель'),('pm','student','Участник'),('minister','student','Министерство по экономической политике'),
 ('deputy','student','Заместитель Председателя Правительства РФ'),('observer','observer','Гость'))v(k,kind,title);
 insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 values(g,(ids->>'pm')::uuid,'Председатель Правительства Российской Федерации','active',(ids->>'teacher')::uuid,(ids->>'teacher')::uuid,'QA PM',true),
 (g,(ids->>'deputy')::uuid,'Заместитель Председателя Правительства РФ','active',(ids->>'teacher')::uuid,(ids->>'teacher')::uuid,'QA deputy',true),
 (g,(ids->>'minister')::uuid,'Министерство по экономической политике','active',(ids->>'teacher')::uuid,(ids->>'teacher')::uuid,'QA minister',true) on conflict do nothing;
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 select g,n,'QA stage '||n,'Учебная процедура','QA',case when n=10 then 'open' else 'locked' end from generate_series(1,16)n
 on conflict(game_id,stage_no) do update set status=excluded.status;
 insert into public.game_profiles(game_id,user_id,signature_path)
 values(g,(ids->>'pm')::uuid,g::text||'/profiles/'||(ids->>'pm')||'/signature-qa.png');
 insert into storage.objects(bucket_id,name) values('game-assets',g::text||'/profiles/'||(ids->>'pm')||'/signature-qa.png');
 insert into public.institution_units(game_id,unit_kind,unit_key,title,head_user_id)
 values(g,'ministry','qa_ministry','Министерство по экономической политике',(ids->>'minister')::uuid) on conflict do nothing;
 insert into public.presidential_addresses(game_id,title,body_text,status,created_by,published_at)
 values(g,'QA published address','QA policy for fictional classroom','published',(ids->>'teacher')::uuid,now()) returning id into addr;
 insert into public.presidential_priorities(game_id,address_id,priority_no,title,national_goal)
 values(g,addr,1,'QA priority','QA measurable national goal') returning id into prior;
 payload:=jsonb_build_object('title','QA programme','responsible_ministry','Министерство по экономической политике',
 'responsible_minister_id',ids->>'minister','national_goal','QA measurable national goal','presidential_priority_id',prior,
 'participants','QA ministry and implementing bodies','start_date','2027-01-01','end_date','2027-12-31',
 'expected_results','QA measurable results for this fictional classroom',
 'goals',jsonb_build_array(jsonb_build_object('goal_text','QA improve services','indicator_name','QA availability','unit','percent','baseline_value','10','target_value','90','target_year','2027')),
 'components','[{"direction_no":1,"direction_title":"QA access","component_kind":"project","title":"QA project","goal_text":"QA service access","start_date":"2027-01-01","end_date":"2027-12-31"},{"direction_no":2,"direction_title":"QA quality","component_kind":"target_program","title":"QA target programme","goal_text":"QA service quality","start_date":"2027-01-01","end_date":"2027-12-31"},{"direction_no":3,"direction_title":"QA staffing","component_kind":"measure","title":"QA measure","goal_text":"QA staff availability","start_date":"2027-01-01","end_date":"2027-12-31"}]'::jsonb,
 'expenses','[{"component_no":1,"indicator_name":"QA expense one","justification":"QA first allocation","budget_year":2027,"amount":"1000000"},{"component_no":2,"indicator_name":"QA expense two","justification":"QA second allocation","budget_year":2027,"amount":"1000000"},{"component_no":3,"indicator_name":"QA expense three","justification":"QA third allocation","budget_year":2027,"amount":"1000000"}]'::jsonb);
 perform set_config('qa.stage11.game',g::text,true);perform set_config('qa.stage11.users',ids::text,true);perform set_config('qa.stage11.payload',payload::text,true);
end;$seed$;
set local role authenticated;
do $prepare$
declare g uuid:=current_setting('qa.stage11.game')::uuid;ids jsonb:=current_setting('qa.stage11.users')::jsonb;payload jsonb:=current_setting('qa.stage11.payload')::jsonb;
 pm uuid:=(ids->>'pm')::uuid;minister uuid:=(ids->>'minister')::uuid;deputy uuid:=(ids->>'deputy')::uuid;p uuid;i int;ps uuid[]:='{}';s uuid;
begin
 for i in 1..4 loop
  perform set_config('request.jwt.claim.sub',minister::text,true);
  p:=public.save_state_program_draft(g,null,jsonb_set(payload,'{title}',to_jsonb('QA programme '||i)),true);
  perform public.advance_state_program(p,'minister_approve');
  perform set_config('request.jwt.claim.sub',deputy::text,true);
  perform public.advance_state_program(p,'pm_ready');
  ps:=array_append(ps,p);
 end loop;
 select id into s from public.government_sessions where game_id=g and status='draft' and stage_no=11;
 if s is null or (select count(*) from public.government_program_agenda where session_id=s)<>4 then raise exception 'FAIL stage 10 agenda';end if;
 if exists(select 1 from public.government_sessions where id=s and agenda_approved_at is not null) then raise exception 'FAIL premature approval';end if;
 perform set_config('qa.stage11.session',s::text,true);perform set_config('qa.stage11.programs',to_jsonb(ps)::text,true);
end;$prepare$;
reset role;
do $stage$ begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.stage11.users')::jsonb->>'teacher',true);
 update public.game_stages set status='open' where game_id=current_setting('qa.stage11.game')::uuid and stage_no=11;
 update public.games set current_round=11 where id=current_setting('qa.stage11.game')::uuid;
end;$stage$;
set local role authenticated;
do $workflow$
declare g uuid:=current_setting('qa.stage11.game')::uuid;ids jsonb:=current_setting('qa.stage11.users')::jsonb;
 s uuid:=current_setting('qa.stage11.session')::uuid;ps uuid[]:=array(select jsonb_array_elements_text(current_setting('qa.stage11.programs')::jsonb)::uuid);
 pm uuid:=(ids->>'pm')::uuid;minister uuid:=(ids->>'minister')::uuid;deputy uuid:=(ids->>'deputy')::uuid;d uuid;v uuid;v2 uuid;a uuid;b text;u uuid;j int;choice text;expected text;denied boolean;proposal uuid;payload jsonb:=current_setting('qa.stage11.payload')::jsonb;
begin
 perform set_config('request.jwt.claim.sub',pm::text,true);
 select agenda_document_id into d from public.government_sessions where id=s;
 perform public.sign_institution_meeting_agenda(d);
 if not exists(select 1 from public.government_sessions where id=s and status='open') then raise exception 'FAIL automatic registration after signature';end if;
 select id into a from public.government_program_agenda where session_id=s and program_id=ps[1];
 denied:=false;begin perform public.start_government_program_report(a);exception when others then if sqlerrm not like 'Сначала Правительство%' then raise;end if;denied:=true;end;
 if not denied then raise exception 'FAIL agenda gate';end if;
 foreach u in array array[pm,minister] loop
  perform set_config('request.jwt.claim.sub',u::text,true);perform public.register_institution_session_at_stage(g,'government',11);
 end loop;
 if exists(select 1 from public.government_sessions where id=s and agenda_vote_id is not null) then raise exception 'FAIL premature agenda ballot';end if;
 perform set_config('request.jwt.claim.sub',deputy::text,true);perform public.register_institution_session_at_stage(g,'government',11);
 select agenda_vote_id into v from public.government_sessions where id=s;
 if v is null then raise exception 'FAIL automatic agenda ballot';end if;
 foreach u in array array[pm,minister,deputy] loop
  perform set_config('request.jwt.claim.sub',u::text,true);perform public.cast_procedural_vote(v,'no');
 end loop;
 if not exists(select 1 from public.game_votes where id=v and status='closed' and result_code='rejected') then raise exception 'FAIL rejected agenda';end if;
 perform set_config('request.jwt.claim.sub',pm::text,true);
 select body_text into b from public.formal_documents where id=d;
 perform public.correct_government_agenda_text(s,b||E'\nQA correction without removing any programme.',b);
 perform public.sign_institution_meeting_agenda(d);
 select agenda_vote_id into v2 from public.government_sessions where id=s;
 if v2=v or v2 is null then raise exception 'FAIL agenda repeat';end if;
 foreach u in array array[pm,minister,deputy] loop
  perform set_config('request.jwt.claim.sub',u::text,true);perform public.cast_procedural_vote(v2,'yes');
 end loop;
 if not exists(select 1 from public.game_votes where id=v2 and status='closed' and result_code='passed') then raise exception 'FAIL adopted agenda';end if;
 for j in 1..4 loop
  perform set_config('request.jwt.claim.sub',pm::text,true);
  select id into a from public.government_program_agenda where session_id=s and program_id=ps[j];
  perform public.start_government_program_report(a);
  perform public.close_government_program_questions(a);
  if j=1 then
   perform set_config('request.jwt.claim.sub',minister::text,true);
   proposal:=public.submit_government_agenda_program_proposal(s,ps[j],'passport','QA measurable results for this fictional classroom','QA corrected measurable results for this fictional classroom','QA proposal');
   perform set_config('request.jwt.claim.sub',pm::text,true);
   denied:=false;begin perform public.open_program_vote_from_agenda(a);exception when others then if sqlerrm not like 'Сначала рассмотрите все поправки%' then raise;end if;denied:=true;end;
   if not denied then raise exception 'FAIL pending proposal gate';end if;
   perform public.review_state_program_proposal(proposal,'accepted','QA approved');
   denied:=false;begin perform public.confirm_government_program_amendments(s,ps[j]);exception when others then if sqlerrm not like 'Паспорт программы ещё не изменён%' then raise;end if;denied:=true;end;
   if not denied then raise exception 'FAIL unchanged passport gate';end if;
   perform public.request_state_program_revision(ps[j],'QA revise approved programme amendment');
   perform set_config('request.jwt.claim.sub',minister::text,true);
   payload:=jsonb_set(jsonb_set(payload,'{title}',to_jsonb('QA programme 1'::text)),'{expected_results}',to_jsonb('QA corrected measurable results for this fictional classroom'::text));
   perform public.save_state_program_draft(g,ps[j],payload,true);
   perform set_config('request.jwt.claim.sub',deputy::text,true);
   perform public.advance_state_program(ps[j],'pm_ready');
   perform set_config('request.jwt.claim.sub',pm::text,true);
   perform public.confirm_government_program_amendments(s,ps[j]);
   perform public.start_government_program_report(a);
   perform public.close_government_program_questions(a);
  end if;
  v:=public.open_program_vote_from_agenda(a);
  foreach u in array array[pm,deputy,minister] loop
   perform set_config('request.jwt.claim.sub',u::text,true);
   choice:=case j when 1 then 'yes' when 2 then 'no' when 3 then 'abstain' else case when u=pm then 'yes' when u=minister then 'no' else 'abstain' end end;
   perform public.cast_procedural_vote(v,choice);
  end loop;
  expected:=case j when 1 then 'adopted' when 2 then 'rejected' when 3 then 'revision' else 'ready' end;
  if not exists(select 1 from public.state_programs where id=ps[j] and status=expected) then raise exception 'FAIL programme status % expected %',j,expected;end if;
 end loop;
 if jsonb_array_length(public.get_signed_state_program_budget(g))<>1 or (public.get_signed_state_program_budget(g)->0->>'id')<>ps[1]::text then raise exception 'FAIL budget filtering';end if;
 if (public.get_signed_state_program_budget(g)->0->'years'->0->>'amount')::numeric<>3000000 then raise exception 'FAIL budget amount';end if;
end;$workflow$;
reset role;
select 'PASS fictional Stage 10 agenda, registration, rejected agenda and correction, renewed approval, amendment gates and revised passport, three outcomes and tie, budget' result;
rollback;