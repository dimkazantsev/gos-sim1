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

set local role authenticated;
do $real_government_procedure$
declare
 g uuid:=current_setting('qa.gov.game')::uuid;users jsonb:=current_setting('qa.gov.users')::jsonb;
 payload jsonb:=current_setting('qa.gov.payload')::jsonb;v_program_id uuid;v_vote_id uuid;actor text;outcome text;v_choice text;
 signed_row jsonb;after_row jsonb;budget_entry jsonb;result jsonb;closed_snapshot jsonb;repeated_snapshot jsonb;
 resolution_route boolean:=current_setting('qa.gov.resolution_trigger')::boolean;protocols jsonb:='[]'::jsonb;resolution_id uuid;
begin
 foreach outcome in array array['passed','rejected'] loop
  resolution_id:=null;
  perform pg_temp.sp_as_user((users->>'creator')::uuid);
  v_program_id:=public.save_state_program_draft(g,null,jsonb_set(payload,'{title}',to_jsonb('QA actual government outcome '||outcome)),false);
  perform pg_temp.sp_assert(exists(select 1 from public.state_programs where id=v_program_id and status='draft' and signed_at is null),'creation is an unsigned draft');
  perform pg_temp.sp_assert(public.save_state_program_draft(g,v_program_id,jsonb_set(payload,'{title}',to_jsonb('QA actual government outcome '||outcome)),true)=v_program_id,'author confirmation preserves the program');
  perform pg_temp.sp_assert((select status from public.state_programs where id=v_program_id)='minister_review','confirmed program awaits its assigned minister');
  perform pg_temp.sp_as_user((users->>'minister')::uuid);perform public.advance_state_program(v_program_id,'minister_approve');
  perform pg_temp.sp_assert((select status from public.state_programs where id=v_program_id)='pm_review','minister approval precedes signature');
  perform pg_temp.sp_as_user((users->>'pm')::uuid);
  perform pg_temp.sp_assert((select role_title from public.game_members where game_id=g and user_id=(users->>'pm')::uuid)='Участник','PM authority comes from the active formal office');
  perform public.advance_state_program(v_program_id,'pm_ready');signed_row:=pg_temp.sp_snapshot(v_program_id);
  perform pg_temp.sp_assert(exists(select 1 from public.state_programs where id=v_program_id and status='ready' and signed_by=(users->>'pm')::uuid and signed_at is not null and government_vote_id is null),'PM signature precedes independent government consideration');
  perform pg_temp.sp_assert((select count(*) from public.state_program_budget_commitments c where c.program_id=v_program_id and c.status='planned')=3
   and not exists(select 1 from public.formal_documents d where d.game_id=g and d.metadata->>'state_program_id'=v_program_id::text),'signature creates planned commitments and no government resolution');

  v_vote_id:=public.open_state_program_government_vote(v_program_id);
  perform pg_temp.sp_assert(exists(select 1 from public.state_programs where id=v_program_id and status='government_vote' and government_vote_id=v_vote_id),'real opening RPC links an independent government vote');
  perform pg_temp.sp_assert(exists(select 1 from public.game_votes v where v.id=v_vote_id and v.status='open' and v.stage_no=11
   and v.institution_key='government' and v.procedure_key='state_program' and v.voting_mode='member'
   and v.quorum_kind='fraction' and v.quorum_value=0.5 and v.majority_kind='present_majority' and v.majority_value=0.5
   and (v.electorate_snapshot->>'eligible')::numeric=3 and (v.electorate_snapshot->>'attendance_required')::boolean),'opening preserves the three-member government electorate, half quorum and present majority');
  after_row:=pg_temp.sp_snapshot(v_program_id);
  perform pg_temp.sp_assert(after_row->'posts'=signed_row->'posts' and after_row->'commitments'=signed_row->'commitments','opening the vote leaves signed publication and planned commitments unchanged');
  if outcome='passed' then
   perform pg_temp.sp_expect_rejection(format('select public.cast_procedural_vote(%L::uuid,%L)',v_vote_id,'yes'),'office-only PM cannot vote before registration');
   perform pg_temp.sp_assert(not exists(select 1 from public.game_ballots where vote_id=v_vote_id),'attendance denial produces no ballot');
  end if;
  v_choice:=case when outcome='passed' then 'yes' else 'no' end;
  foreach actor in array array['creator','minister','pm'] loop
   perform pg_temp.sp_as_user((users->>actor)::uuid);
   perform public.register_institution_session_at_stage(g,'government',11);
   perform public.cast_procedural_vote(v_vote_id,v_choice);
  end loop;
  perform pg_temp.sp_assert((select count(*) from public.institution_session_registrations r where r.game_id=g and r.stage_no=11 and r.institution_key='government')=3
   and (select count(*) from public.game_ballots b where b.vote_id=v_vote_id and b.choice=v_choice and b.weight=1)=3,'all three government members register and cast their own unit votes');
  -- The existing procedure explicitly permits the teacher to preside. This
  -- isolates vote/NPA preservation from primary-role-only legacy chair checks.
  perform pg_temp.sp_as_user((users->>'teacher')::uuid);
  result:=public.close_procedural_vote(v_vote_id,'QA actual government procedure: '||outcome);
  perform pg_temp.sp_assert(result->>'result'=outcome and (result->>'quorum')::boolean
   and (result->>'eligible')::numeric=3 and (result->>'present')::numeric=3 and (result->>'needed')::numeric=2
   and (result->>'cast')::numeric=3 and (result->>'yes')::numeric=case when outcome='passed' then 3 else 0 end
   and (result->>'no')::numeric=case when outcome='rejected' then 3 else 0 end,'real close computes the registered quorum and ballot outcome: '||outcome);
  perform pg_temp.sp_assert(exists(select 1 from public.game_votes where id=v_vote_id and status='closed' and result_code=outcome and result_quorum_met),'government vote stores the computed result');
  perform pg_temp.sp_assert(exists(select 1 from public.state_programs where id=v_program_id and status=case when outcome='passed' then 'adopted' else 'rejected' end
   and signed_by=(users->>'pm')::uuid and signed_at=(signed_row->'passport'->>'signed_at')::timestamptz),'vote trigger updates the program while preserving its PM signature');
  perform pg_temp.sp_assert((select count(*) from public.state_program_budget_commitments c where c.program_id=v_program_id
   and c.status=case when outcome='passed' then 'approved' else 'rejected' end)=3,'actual government result synchronizes every annual commitment');
  after_row:=pg_temp.sp_snapshot(v_program_id);
  perform pg_temp.sp_assert(after_row->'goals'=signed_row->'goals' and after_row->'components'=signed_row->'components'
   and after_row->'expenses'=signed_row->'expenses' and after_row->'years'=signed_row->'years' and after_row->'posts'=signed_row->'posts','government consideration never rewrites signed content or its publication');
  perform pg_temp.sp_assert((select count(*) from public.political_posts pp where pp.game_id=g and pp.source_key='state_program_signed:'||v_program_id)=1,'each signed program retains exactly one publication');
  select entry into budget_entry from jsonb_array_elements(public.get_signed_state_program_budget(g)) entry where entry->>'id'=v_program_id::text;
  perform pg_temp.sp_assert(budget_entry->>'program_status'=case when outcome='passed' then 'adopted' else 'rejected' end
   and budget_entry->'total_budget'=to_jsonb('100.31'::text)
   and budget_entry->'years'=jsonb_build_array(
    jsonb_build_object('year',2026,'amount','0.30','status',case when outcome='passed' then 'approved' else 'rejected' end),
    jsonb_build_object('year',2027,'amount','100.01','status',case when outcome='passed' then 'approved' else 'rejected' end),
    jsonb_build_object('year',2028,'amount','0.00','status',case when outcome='passed' then 'approved' else 'rejected' end)),'budget RPC reflects exact annual amounts and the actual decision');

  if outcome='passed' and resolution_route then
   select id into resolution_id from public.formal_documents d where d.game_id=g and d.doc_type='government_resolution' and d.metadata->>'state_program_id'=v_program_id::text;
   perform pg_temp.sp_assert(resolution_id is not null and (select count(*) from public.formal_documents d where d.game_id=g and d.doc_type='government_resolution' and d.metadata->>'state_program_id'=v_program_id::text)=1,'enabled resolution route creates one government NPA');
   perform pg_temp.sp_assert(exists(select 1 from public.formal_documents d where d.id=resolution_id and d.status_code='published'
    and d.metadata->>'government_vote_id'=v_vote_id::text),'adopted program resolution is linked to its actual vote and published');
   perform pg_temp.sp_assert(exists(select 1 from public.formal_document_history h where h.document_id=resolution_id),'government resolution keeps formal document history');
  elsif outcome='rejected' then
   perform pg_temp.sp_assert(not exists(select 1 from public.formal_documents d where d.game_id=g and d.doc_type='government_resolution' and d.metadata->>'state_program_id'=v_program_id::text),'rejected program has no adopting government resolution');
  end if;
  closed_snapshot:=jsonb_build_object('program',pg_temp.sp_snapshot(v_program_id),
   'vote',(select to_jsonb(v) from public.game_votes v where v.id=v_vote_id),
   'documents',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from public.formal_documents d where d.game_id=g),
   'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) from public.formal_document_history h where h.game_id=g),
   'posts',(select coalesce(jsonb_agg(to_jsonb(pp) order by pp.id),'[]'::jsonb) from public.political_posts pp where pp.game_id=g));
  result:=public.close_procedural_vote(v_vote_id,'QA repeat close');
  repeated_snapshot:=jsonb_build_object('program',pg_temp.sp_snapshot(v_program_id),
   'vote',(select to_jsonb(v) from public.game_votes v where v.id=v_vote_id),
   'documents',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from public.formal_documents d where d.game_id=g),
   'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) from public.formal_document_history h where h.game_id=g),
   'posts',(select coalesce(jsonb_agg(to_jsonb(pp) order by pp.id),'[]'::jsonb) from public.political_posts pp where pp.game_id=g));
  perform pg_temp.sp_assert(result->>'result'=outcome and repeated_snapshot=closed_snapshot,'repeat government closure is idempotent across results, commitments, NPA history and publications');
  protocols:=protocols||jsonb_build_array(jsonb_build_object('program_id',v_program_id,'vote_id',v_vote_id,'result',outcome,'resolution_id',resolution_id));
 end loop;
 perform set_config('qa.gov.protocols',protocols::text,true);
 perform set_config('qa.gov.checks',jsonb_build_object('author_minister_office_pm_signature','PASS','office_pm_opens_real_government_vote','PASS',
  'three_government_members_register_and_vote','PASS','real_adopted_and_rejected_outcomes','PASS','commitments_follow_real_government_results','PASS',
  'exact_budget_rpc_amounts_and_decisions','PASS','one_signed_publication_preserved_per_program','PASS','repeat_close_preserves_protocol','PASS',
  'government_resolution_route',case when resolution_route then 'PASS' else 'NOT INSTALLED' end)::text,true);
end;
$real_government_procedure$;

reset role;
do $no_budget_execution$
declare g uuid:=current_setting('qa.gov.game')::uuid;
begin
 perform pg_temp.sp_as_user((current_setting('qa.gov.users')::jsonb->>'teacher')::uuid);
 perform pg_temp.sp_assert((select count(*) from public.state_programs where game_id=g)=2
  and (select count(*) from public.game_votes where game_id=g and procedure_key='state_program' and status='closed')=2,'both outcomes came from actual government votes');
 if to_regclass('public.budget_simulator_ledger') is not null then
  perform pg_temp.sp_assert(not exists(select 1 from public.budget_simulator_ledger where game_id=g),'government adoption and rejection do not execute budget spending');
 end if;
 perform set_config('qa.gov.checks',(current_setting('qa.gov.checks')::jsonb||jsonb_build_object('no_budget_execution_from_government_program_vote','PASS'))::text,true);
end;
$no_budget_execution$;

select current_setting('qa.gov.checks')::jsonb as checks,current_setting('qa.gov.protocols')::jsonb as fictional_protocols,
 'Real government RPC, registration, ballots, closure and enabled resolution trigger; teacher presides; all fictional records and helper DDL rolled back; no budget adoption procedure is executed' as scope;
rollback;
