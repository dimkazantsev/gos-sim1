-- Fictional standalone government-program procedure check; run after the structured-program migration.
-- PM has only an active formal PM office; its primary member title remains Участник.
-- Every fixture and temporary helper is enclosed in BEGIN/ROLLBACK.
begin;

create function pg_temp.sp_assert(ok boolean,label text) returns void
language plpgsql security invoker as $helper$
begin
 if ok is distinct from true then raise exception 'FAIL: %',label;end if;
end;
$helper$;

create function pg_temp.sp_as_user(v_user_id uuid) returns void
language plpgsql security invoker as $helper$
begin
 perform set_config('request.jwt.claim.sub',v_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user_id,'role','authenticated')::text,true);
end;
$helper$;

create function pg_temp.sp_expect_rejection(statement text,label text) returns void
language plpgsql security invoker as $helper$
declare rejected boolean:=false;error_state text;
begin
 begin
  execute statement;
  -- Undo an unexpectedly successful write before raising the assertion failure.
  raise exception using errcode='ZX001',message='QA unexpected success';
 exception
  when sqlstate 'ZX001' then rejected:=false;
  when others then
   get stacked diagnostics error_state=returned_sqlstate;
   -- Only data validation, deliberate rule errors and permission denials count.
   -- Missing APIs, ambiguous identifiers and SQL bugs are assertion failures.
   if error_state not in ('P0001','42501') and left(error_state,2) not in ('22','23') then raise;end if;
   rejected:=true;
 end;
 perform pg_temp.sp_assert(rejected,label||' must be rejected');
end;
$helper$;

create function pg_temp.sp_snapshot(v_program_id uuid) returns jsonb
language sql security invoker as $helper$
 select jsonb_build_object(
  'passport',(select to_jsonb(p) from public.state_programs p where p.id=v_program_id),
  'goals',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]'::jsonb) from public.state_program_goals g where g.program_id=v_program_id),
  'components',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from public.state_program_components c where c.program_id=v_program_id),
  'expenses',(select coalesce(jsonb_agg(to_jsonb(e) order by e.position,e.id),'[]'::jsonb) from public.state_program_expenses e where e.program_id=v_program_id),
  'years',(select coalesce(jsonb_agg(to_jsonb(y) order by y.budget_year,y.id),'[]'::jsonb) from public.state_program_budget_years y where y.program_id=v_program_id),
  'commitments',(select coalesce(jsonb_agg(to_jsonb(c) order by c.budget_year),'[]'::jsonb) from public.state_program_budget_commitments c where c.program_id=v_program_id),
  'posts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from public.political_posts p where p.source_key='state_program_signed:'||v_program_id)
 );
$helper$;

do $government_fixture$
declare
 g uuid:=gen_random_uuid();t uuid:=gen_random_uuid();a uuid:=gen_random_uuid();m uuid:=gen_random_uuid();p uuid:=gen_random_uuid();u uuid;payload jsonb;
begin
 foreach u in array array[t,a,m,p] loop insert into auth.users(id,aud,role) values(u,'authenticated','authenticated');end loop;
 perform pg_temp.sp_as_user(t);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA real government program procedure','QA'||substr(replace(g::text,'-',''),1,12),t,'running',11,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title)
 values(g,t,'QA fictional teacher','teacher','Преподаватель'),
       (g,a,'QA author minister','student','Министр развития'),
       (g,m,'QA reviewing minister','student','Министр социальной политики'),
       (g,p,'QA formally appointed PM','student','Участник');
 insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 values(g,p,'Председатель Правительства Российской Федерации','active',t,t,'QA fictional formal appointment for government procedure',true);
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 select g,n,'QA stage '||n,'Учебная процедура','QA',case when n in (10,11) then 'open' else 'locked' end from generate_series(1,16)n;
 payload:=jsonb_build_object(
  'title','QA government procedure program','responsible_ministry','QA ministry','responsible_minister_id',m,
  'national_goal','QA measurable national goal','participants','QA fictional implementing organizations',
  'start_date','2026-01-01','end_date','2028-12-31','expected_results','QA measurable service availability results',
  'goals','[{"goal_text":"QA improve public service","indicator_name":"QA service availability","unit":"percent","baseline_value":"10","target_value":"90","target_year":"2028"}]'::jsonb,
  'components','[
   {"direction_no":1,"direction_title":"QA access","component_kind":"project","title":"QA access project","goal_text":"QA improve access","start_date":"2026-01-01","end_date":"2028-12-31"},
   {"direction_no":2,"direction_title":"QA quality","component_kind":"target_program","title":"QA quality program","goal_text":"QA improve quality","start_date":"2026-01-01","end_date":"2028-12-31"},
   {"direction_no":3,"direction_title":"QA staffing","component_kind":"measure","title":"QA staffing measure","goal_text":"QA improve staffing","start_date":"2026-01-01","end_date":"2028-12-31"}
  ]'::jsonb,
  'expenses','[
   {"component_no":1,"indicator_name":"QA first decimal allocation","justification":"QA first justified expense","budget_year":2026,"amount":"0.1"},
   {"component_no":1,"indicator_name":"QA second decimal allocation","justification":"QA second justified expense","budget_year":2026,"amount":"0.2"},
   {"component_no":2,"indicator_name":"QA quality expense","justification":"QA justified quality allocation","budget_year":2027,"amount":"100.00"},
   {"component_no":3,"indicator_name":"QA staffing expense","justification":"QA justified staffing allocation","budget_year":2027,"amount":"0.01"}
  ]'::jsonb);
 perform set_config('qa.gov.game',g::text,true);
 perform set_config('qa.gov.users',jsonb_build_object('teacher',t,'creator',a,'minister',m,'pm',p)::text,true);
 perform set_config('qa.gov.payload',payload::text,true);perform set_config('qa.gov.checks','{}',true);
 perform set_config('qa.gov.resolution_trigger',(exists(select 1 from pg_trigger tr
  where tr.tgrelid='public.game_votes'::regclass and not tr.tgisinternal and tr.tgenabled<>'D'
   and tr.tgfoid='private.state_program_vote_trigger()'::regprocedure))::text,true);
end;
$government_fixture$;

-- Controlled end-to-end procedure with synthetic users; all rows rolled back.
do $seed$ declare g uuid:=current_setting('qa.gov.game')::uuid;u jsonb:=current_setting('qa.gov.users')::jsonb;a uuid;pr uuid;begin
insert into presidential_addresses(game_id,title,body_text,status,created_by,published_at) values(g,'QA goals','QA goals','published',(u->>'teacher')::uuid,now()) returning id into a;
insert into presidential_priorities(address_id,game_id,priority_no,title,national_goal) values(a,g,1,'QA national goal','QA measurable national goal') returning id into pr;
perform set_config('qa.gov.priority',pr::text,true);end $seed$;
set local role authenticated;
do $verify$ declare g uuid:=current_setting('qa.gov.game')::uuid;u jsonb:=current_setting('qa.gov.users')::jsonb;
 pl jsonb:=current_setting('qa.gov.payload')::jsonb||jsonb_build_object('presidential_priority_id',current_setting('qa.gov.priority'));
 p uuid;s uuid;i uuid;v uuid;d uuid;q uuid;actor text;signed timestamptz;
begin
 perform pg_temp.sp_as_user((u->>'creator')::uuid);
 p:=public.save_state_program_draft(g,null,pl,false);
 perform public.save_state_program_draft(g,p,pl,true);
 perform pg_temp.sp_as_user((u->>'minister')::uuid); perform public.advance_state_program(p,'minister_approve');
 perform pg_temp.sp_as_user((u->>'pm')::uuid); perform public.advance_state_program(p,'pm_ready');
 perform pg_temp.sp_assert((select signed_at is null and status='ready' from state_programs where id=p),'Unsigned after preliminary PM review');
 perform pg_temp.sp_expect_rejection(format('select public.open_state_program_government_vote(%L::uuid)',p),'Vote requires presentation');
 s:=public.create_government_session_from_programmes(g,60);
 select id into i from government_program_agenda where session_id=s and program_id=p;
 perform pg_temp.sp_assert((select count(*)=1 from government_program_agenda where session_id=s),'Automatic programme agenda');
 perform pg_temp.sp_assert((select status_code='draft' from formal_documents d join government_sessions gs on gs.agenda_document_id=d.id where gs.id=s),'Agenda starts as draft');
 perform public.approve_government_session_agenda(s);
 perform pg_temp.sp_assert((select agenda_approved_at is not null from government_sessions where id=s),'PM approved agenda');
 perform pg_temp.sp_assert((select status_code='published' from formal_documents d join government_sessions gs on gs.agenda_document_id=d.id where gs.id=s),'One official approved agenda');
 perform public.open_government_session(s);
 perform pg_temp.sp_assert(exists(select 1 from institution_meeting_records r join formal_documents fd on fd.id=r.agenda_document_id where r.game_id=g and r.stage_no=11 and r.institution_key='government' and r.agenda_approved_at is not null and fd.status_code='published'),'Agenda and meeting registration ready');
 -- All three register before voting, so quorum cannot prematurely close the meeting.
 foreach actor in array array['creator','minister','pm'] loop
  perform pg_temp.sp_as_user((u->>actor)::uuid);
  perform public.register_institution_session_at_stage(g,'government',11);
 end loop;
 perform pg_temp.sp_as_user((u->>'pm')::uuid);
 perform public.start_government_program_report(i);
 perform pg_temp.sp_as_user((u->>'creator')::uuid);
 q:=public.ask_government_program_speaker(i,'Какие измеримые показатели результата должны быть достигнуты?');
 perform pg_temp.sp_expect_rejection(format('select public.open_program_vote_from_agenda(%L::uuid)',i),'Cannot vote before Q&A');
 perform pg_temp.sp_as_user((u->>'minister')::uuid);
 perform public.answer_government_program_speaker(q,'Целевые показатели установлены в паспорте программы.');
 perform pg_temp.sp_as_user((u->>'pm')::uuid);
 perform public.close_government_program_questions(i);
 v:=public.open_program_vote_from_agenda(i);
 perform pg_temp.sp_assert((select qa_closed_at is not null from government_program_agenda where id=i),'Speaker Q&A is completed before decision');
 perform pg_temp.sp_expect_rejection(format('select public.sign_adopted_state_program(%L::uuid)',p),'Cannot sign before passed vote');
 foreach actor in array array['creator','minister','pm'] loop
  perform pg_temp.sp_as_user((u->>actor)::uuid);
  perform public.cast_procedural_vote(v,'yes');
 end loop;
 perform pg_temp.sp_as_user((u->>'teacher')::uuid);
 if exists(select 1 from game_votes where id=v and status='open') then perform public.close_procedural_vote(v,'QA decision'); end if;
 perform pg_temp.sp_assert(exists(select 1 from game_votes where id=v and result_code='passed' and result_quorum_met),'Passed Government vote with quorum');
 perform pg_temp.sp_assert((select status='adopted' and signed_at is null from state_programs where id=p),'Adopted but unsigned before PM');
 select id into d from formal_documents where game_id=g and doc_type='government_resolution' and metadata->>'state_program_id'=p::text;
 perform pg_temp.sp_assert((select status_code='draft' from formal_documents where id=d),'Only draft resolution after vote');
 perform pg_temp.sp_as_user((u->>'creator')::uuid);
 perform pg_temp.sp_expect_rejection(format('select public.sign_adopted_state_program(%L::uuid)',p),'Non-PM cannot sign');
 perform pg_temp.sp_as_user((u->>'pm')::uuid);
 perform public.sign_adopted_state_program(p);
 select signed_at into signed from state_programs where id=p;
 perform pg_temp.sp_assert(signed is not null and (select status_code='published' from formal_documents where id=d),'PM signature publishes resolution');
 perform pg_temp.sp_assert((select count(*) from political_posts where game_id=g and source_key='state_program_signed:'||p)=1,'One publication');
 perform pg_temp.sp_assert((select count(*) from state_program_budget_commitments where program_id=p and status='approved')=3,'Budget commitments recorded once after approval');
 perform public.sign_adopted_state_program(p);
 perform pg_temp.sp_assert((select signed_at from state_programs where id=p)=signed,'Signing idempotent');
end $verify$;
reset role;
rollback;
select 'PASS: 3 pre-registered voters, Government adoption then PM signature (rolled back)' as result;
