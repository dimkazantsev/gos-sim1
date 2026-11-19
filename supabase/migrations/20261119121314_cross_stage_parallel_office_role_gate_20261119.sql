-- Use validated, effective roles (main student role plus active secondary offices).
-- No broad privileges: caller identity, membership, suspensions and archival checked.
-- Preserves existing stage deadlines, legal office procedures and game isolation.
CREATE OR REPLACE FUNCTION private.has_effective_role_like(p_game uuid, p_user uuid, p_patterns text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 SELECT p_user=(select auth.uid())
   AND coalesce(array_length(p_patterns,1),0)>0
   AND private.role_is_available(p_game,p_user)
   AND EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=p_game
     AND m.user_id=p_user AND m.kind='student' AND m.roster_archived_at IS NULL)
   AND EXISTS(SELECT 1 FROM private.formal_user_roles(p_game,p_user) r
     WHERE r LIKE ANY(p_patterns));
$function$
;

CREATE OR REPLACE FUNCTION public.assign_institution_member(p_unit_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_target_party uuid;v_role text;v_id uuid;
begin
 select * into u from public.institution_units where id=p_unit_id for update;
 if u.id is null then raise exception 'Institution unit not found'; end if;
 if u.unit_kind='committee' then raise exception 'Для комитетов используйте распределение депутатских мандатов';end if;
 if v_uid is null or not private.is_game_member(u.game_id) or private.is_game_observer(u.game_id) then raise exception 'Game participant access required';end if;
 if not exists(select 1 from public.game_members where game_id=u.game_id and user_id=p_user_id and kind='student' and roster_archived_at is null) then raise exception 'Student not found in this game'; end if;

 if u.unit_kind='committee' then
   if u.head_user_id is null then raise exception 'Сначала изберите председателя комитета';end if;
   if not exists(select 1 from public.party_member_mandates where game_id=u.game_id and user_id=p_user_id and base_mandates>0) then raise exception 'Участник не получил депутатских мандатов';end if;
   v_party:=private.member_party_id(u.game_id,v_uid);
   v_target_party:=private.member_party_id(u.game_id,p_user_id);
   if not private.is_game_teacher(u.game_id) then
     if v_uid is distinct from u.head_user_id and (v_party is null or not exists(select 1 from public.game_parties where id=v_party and leader_user_id=v_uid)) then raise exception 'Полномочия председателя комитета или руководителя фракции отсутствуют';end if;
     if v_uid is distinct from u.head_user_id and v_target_party is distinct from v_party then raise exception 'Руководитель фракции назначает только участников своей фракции';end if;
   end if;
   if v_target_party is null then raise exception 'Committee member must belong to a parliamentary faction'; end if;
 else
   v_role:=private.game_role(u.game_id,v_uid);
   if not private.is_game_teacher(u.game_id)
      and v_uid is distinct from u.head_user_id
      and not private.has_effective_role_like(u.game_id,v_uid,ARRAY['%председател%правительств%'])
   then raise exception 'Minister / Prime Minister / teacher access required'; end if;
   v_target_party:=null;
 end if;

 insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,created_by)
 values(u.game_id,u.id,u.unit_kind,p_user_id,v_target_party,v_uid)
 on conflict(unit_id,user_id) do update
 set unit_id=excluded.unit_id,party_id=excluded.party_id,created_by=v_uid,created_at=now()
 returning id into v_id;
 return v_id;
end;$function$
;

CREATE OR REPLACE FUNCTION public.remove_institution_member(p_assignment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare a public.institution_assignments%rowtype;u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_role text;
begin
 select * into a from public.institution_assignments where id=p_assignment_id;
 if a.id is null then return; end if;
 if v_uid is null or not private.is_game_member(a.game_id) or private.is_game_observer(a.game_id) then raise exception 'Game participant access required';end if;
 select * into u from public.institution_units where id=a.unit_id;
 if u.unit_kind='committee' then raise exception 'Для комитетов используйте распределение депутатских мандатов';end if;
 if a.unit_kind='committee' then
   v_party:=private.member_party_id(a.game_id,v_uid);
   if not private.is_game_teacher(a.game_id)
      and not exists(select 1 from public.game_parties where id=v_party and leader_user_id=v_uid and id=a.party_id)
   then raise exception 'Faction leader access required'; end if;
 else
   v_role:=private.game_role(a.game_id,v_uid);
   if not private.is_game_teacher(a.game_id) and v_uid is distinct from u.head_user_id and not private.has_effective_role_like(a.game_id,v_uid,ARRAY['%председател%правительств%'])
   then raise exception 'Minister / Prime Minister / teacher access required'; end if;
 end if;
 delete from public.institution_assignments where id=a.id;
end;$function$
;

CREATE OR REPLACE FUNCTION public.set_institution_head(p_unit_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_role text;
begin
 select * into u from public.institution_units where id=p_unit_id for update;
 if u.id is null then raise exception 'Institution unit not found'; end if;
 if not exists(select 1 from public.game_members where game_id=u.game_id and user_id=p_user_id and kind='student') then raise exception 'Student not found'; end if;
 if v_uid is null or not private.is_game_member(u.game_id) then raise exception 'Game access required';end if;
 v_role:=coalesce(private.game_role(u.game_id,v_uid),'');
 if u.unit_kind='committee' then
   if not private.is_game_teacher(u.game_id) then raise exception 'Committee chair must be recorded after the Duma election by the teacher'; end if;
 else
   if not exists(select 1 from public.government_nominations n
     where n.game_id=u.game_id and n.stage_no=9 and n.office_key='ministry_'||u.unit_key
       and n.status='appointed' and n.candidate_user_id=p_user_id)
   then raise exception 'Minister must already be appointed through stage 9';end if;
   if not private.is_game_teacher(u.game_id) and not private.has_effective_role_like(u.game_id,v_uid,ARRAY['%председател%правительств%','%президент%'])
   then raise exception 'Prime Minister / President / teacher access required'; end if;
 end if;
 update public.institution_units set head_user_id=p_user_id where id=u.id;
 if u.unit_kind='ministry' then
   insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
   values(u.game_id,u.id,'ministry',p_user_id,null,'head',v_uid)
   on conflict(unit_id,user_id) do update set unit_id=excluded.unit_id,assignment_role='head',created_by=v_uid,created_at=now();
 else
   insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
   values(u.game_id,u.id,'committee',p_user_id,private.member_party_id(u.game_id,p_user_id),'head',v_uid)
   on conflict(unit_id,user_id) do update set unit_id=excluded.unit_id,party_id=excluded.party_id,assignment_role='head',created_by=v_uid,created_at=now();
 end if;
end;$function$
;

CREATE OR REPLACE FUNCTION public.create_budget_document_from_scenario(p_scenario_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.budget_scenarios%rowtype;v_uid uuid:=(select auth.uid());v_role text;v_doc uuid;v_body text;v_programs text;
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Budget scenario not found'; end if;
 if s.status<>'final' then raise exception 'Finalize the budget scenario first'; end if;
 if s.formal_document_id is not null then return s.formal_document_id; end if;
 v_role:=private.game_role(s.game_id,v_uid);
 if not private.is_game_teacher(s.game_id)
    and not private.has_effective_role_like(s.game_id,v_uid,ARRAY['%председател%правительств%','%министр%финанс%','%правительств%'])
 then raise exception 'Government / Finance Ministry access required'; end if;

 select string_agg('• '||p.title||': '||a.amount::text, E'\n' order by p.title)
 into v_programs
 from public.budget_program_allocations a
 join public.state_programs p on p.id=a.program_id
 where a.scenario_id=s.id;

 v_body:=
   'Проект федерального бюджета на '||s.budget_year||' год.'||E'\n\n'||
   'Макроэкономический сценарий: '||s.title||E'\n'||
   'ВВП: '||s.gdp||E'\n'||
   'Доходы: '||s.revenue||E'\n'||
   'Расходы: '||s.expenditure||E'\n'||
   'Баланс: '||s.balance||E'\n'||
   case when s.deficit_pct_gdp is not null then 'Дефицит к ВВП: '||round(s.deficit_pct_gdp,2)||'%'||E'\n' else '' end||
   'Государственный долг на конец периода: '||s.debt_end||
   case when s.debt_pct_gdp is not null then ' ('||round(s.debt_pct_gdp,2)||'% ВВП)' else '' end||E'\n\n'||
   'Финансирование принятых государственных программ:'||E'\n'||
   coalesce(v_programs,'Связанные государственные программы не указаны.')||E'\n\n'||
   'Источник и допущения сценария: '||coalesce(s.source_note,'не указаны');

 v_doc:=public.create_formal_document(
   s.game_id,13,'О федеральном бюджете на '||s.budget_year||' год','federal_budget',
   'government','Правительство Российской Федерации',v_body,null,null,null,'budget',
   jsonb_build_object('budget_scenario_id',s.id,'budget_year',s.budget_year)
 );

 update public.budget_scenarios set formal_document_id=v_doc,updated_at=now(),updated_by=v_uid where id=s.id;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,13,'Федеральный бюджет','notice','Проект федерального бюджета внесён в реестр НПА',
        'На основе зафиксированного сценария '||s.title,v_uid);
 return v_doc;
end;$function$
;

CREATE OR REPLACE FUNCTION public.delete_budget_program_allocation(p_allocation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare a public.budget_program_allocations%rowtype;s public.budget_scenarios%rowtype;v_uid uuid:=(select auth.uid());v_role text;
begin
 select * into a from public.budget_program_allocations where id=p_allocation_id;
 if a.id is null then return; end if;
 select * into s from public.budget_scenarios where id=a.scenario_id;
 if s.status='final' then raise exception 'Final budget scenario is locked'; end if;
 v_role:=private.game_role(a.game_id,v_uid);
 if not private.is_game_teacher(a.game_id)
    and not private.has_effective_role_like(a.game_id,v_uid,ARRAY['%председател%правительств%','%министр%финанс%'])
 then raise exception 'Prime Minister / Finance Minister access required'; end if;
 delete from public.budget_program_allocations where id=a.id;
end;$function$
;

CREATE OR REPLACE FUNCTION public.finalize_budget_scenario(p_scenario_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.budget_scenarios%rowtype;v_role text;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Scenario not found'; end if;
 v_role:=private.game_role(s.game_id,v_uid);
 if not private.is_game_teacher(s.game_id) and not private.has_effective_role_like(s.game_id,v_uid,ARRAY['%председател%правительств%','%министр%финанс%']) then
  raise exception 'Prime Minister / Finance Minister access required';
 end if;
 if (select count(*) from public.budget_workstreams where scenario_id=s.id)<5 then
  raise exception 'All five analytical workstreams must submit their conclusions';
 end if;
 update public.budget_scenarios set status='final',updated_by=v_uid,updated_at=now() where id=s.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,13,'Федеральный бюджет','notice','Макроэкономический сценарий бюджета зафиксирован',
  s.title||'. Доходы: '||s.revenue||'; расходы: '||s.expenditure||'; баланс: '||s.balance||
  case when s.deficit_pct_gdp is not null then '; дефицит к ВВП: '||round(s.deficit_pct_gdp,2)||'%' else '' end,
  v_uid);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_budget_scenario(p_game_id uuid, p_scenario_id uuid, p_title text, p_budget_year integer, p_source_note text, p_gdp numeric, p_oil_price numeric, p_cutoff_price numeric, p_key_rate numeric, p_fx_change_pct numeric, p_fx_intervention numeric, p_revenue numeric, p_expenditure numeric, p_debt_start numeric, p_financing numeric, p_deficit_limit_pct numeric, p_debt_limit_pct numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_role text;v_id uuid;v_balance numeric;v_deficit numeric;v_debt_end numeric;v_debt_pct numeric;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 v_role:=private.game_role(p_game_id,v_uid);
 if not private.is_game_teacher(p_game_id)
    and not private.has_effective_role_like(p_game_id,v_uid,ARRAY['%правительств%','%министр%','%банк%росс%'])
 then raise exception 'Budget-team role required'; end if;
 if p_budget_year<2020 or p_budget_year>2100 then raise exception 'Budget year is out of range'; end if;
 if p_gdp<0 or p_revenue<0 or p_expenditure<0 or p_debt_start<0 then raise exception 'Core budget values cannot be negative'; end if;

 v_balance:=p_revenue-p_expenditure;
 v_deficit:=case when p_gdp>0 then greatest(0,-v_balance)/p_gdp*100 else null end;
 v_debt_end:=greatest(0,p_debt_start+greatest(0,-v_balance)-coalesce(p_financing,0));
 v_debt_pct:=case when p_gdp>0 then v_debt_end/p_gdp*100 else null end;

 if p_scenario_id is null then
  insert into public.budget_scenarios(
   game_id,title,budget_year,source_note,gdp,oil_price,cutoff_price,key_rate,fx_change_pct,fx_intervention,
   revenue,expenditure,debt_start,financing,balance,deficit_pct_gdp,debt_end,debt_pct_gdp,deficit_limit_pct,debt_limit_pct,created_by,updated_by
  ) values(
   p_game_id,coalesce(nullif(trim(p_title),''),'Базовый сценарий федерального бюджета'),p_budget_year,nullif(trim(coalesce(p_source_note,'')),''),
   p_gdp,p_oil_price,p_cutoff_price,p_key_rate,p_fx_change_pct,p_fx_intervention,p_revenue,p_expenditure,p_debt_start,p_financing,
   v_balance,v_deficit,v_debt_end,v_debt_pct,p_deficit_limit_pct,p_debt_limit_pct,v_uid,v_uid
  ) returning id into v_id;
 else
  if not exists(select 1 from public.budget_scenarios where id=p_scenario_id and game_id=p_game_id) then raise exception 'Scenario not found'; end if;
  update public.budget_scenarios set title=coalesce(nullif(trim(p_title),''),title),budget_year=p_budget_year,source_note=nullif(trim(coalesce(p_source_note,'')),''),
   gdp=p_gdp,oil_price=p_oil_price,cutoff_price=p_cutoff_price,key_rate=p_key_rate,fx_change_pct=p_fx_change_pct,fx_intervention=p_fx_intervention,
   revenue=p_revenue,expenditure=p_expenditure,debt_start=p_debt_start,financing=p_financing,balance=v_balance,
   deficit_pct_gdp=v_deficit,debt_end=v_debt_end,debt_pct_gdp=v_debt_pct,deficit_limit_pct=p_deficit_limit_pct,debt_limit_pct=p_debt_limit_pct,
   updated_by=v_uid,updated_at=now()
  where id=p_scenario_id returning id into v_id;
 end if;
 return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_budget_program_allocation(p_scenario_id uuid, p_program_id uuid, p_amount numeric, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.budget_scenarios%rowtype;p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_role text;v_id uuid;v_total numeric;
begin
 select * into s from public.budget_scenarios where id=p_scenario_id for update;
 if s.id is null then raise exception 'Budget scenario not found'; end if;
 if s.status='final' then raise exception 'Final budget scenario is locked'; end if;
 if v_uid is null or not private.is_game_member(s.game_id) then raise exception 'Game access required'; end if;
 v_role:=private.game_role(s.game_id,v_uid);
 if not private.is_game_teacher(s.game_id)
    and not private.has_effective_role_like(s.game_id,v_uid,ARRAY['%председател%правительств%','%министр%финанс%'])
 then raise exception 'Prime Minister / Finance Minister access required'; end if;

 select * into p from public.state_programs where id=p_program_id;
 if p.id is null or p.game_id<>s.game_id or p.status<>'adopted'
 then raise exception 'Only adopted state programs in this game may be financed'; end if;
 if p_amount<0 then raise exception 'Allocation cannot be negative'; end if;

 select coalesce(sum(amount),0)-coalesce((select amount from public.budget_program_allocations where scenario_id=s.id and program_id=p.id),0)+p_amount
 into v_total
 from public.budget_program_allocations where scenario_id=s.id;

 if v_total>s.expenditure then raise exception 'Program allocations exceed total budget expenditure'; end if;

 insert into public.budget_program_allocations(scenario_id,game_id,program_id,amount,note,created_by)
 values(s.id,s.game_id,p.id,p_amount,nullif(trim(coalesce(p_note,'')),''),v_uid)
 on conflict(scenario_id,program_id) do update
 set amount=excluded.amount,note=excluded.note,updated_at=now()
 returning id into v_id;
 return v_id;
end;$function$
;

CREATE OR REPLACE FUNCTION public.save_state_program(p_game_id uuid, p_program_id uuid, p_title text, p_responsible_ministry text, p_responsible_minister_id uuid, p_curator_id uuid, p_national_goal text, p_start_date date, p_end_date date, p_total_budget numeric, p_expected_results text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_role text;
begin
 perform private.lock_active_program_actor(p_game_id);
 if v_uid is null or not private.is_game_member(p_game_id) or private.is_game_observer(p_game_id) or (not private.is_game_teacher(p_game_id) and not private.role_is_available(p_game_id,v_uid)) then raise exception 'Game access required'; end if;
 if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_responsible_ministry,'')))<3 then raise exception 'Program title and responsible ministry are required'; end if;
 if p_total_budget<0 or p_total_budget::text in ('NaN','Infinity','-Infinity') then raise exception 'Budget cannot be negative'; end if;
 if p_end_date is not null and p_start_date is not null and p_end_date<p_start_date then raise exception 'Program end date must follow start date'; end if;
 if p_responsible_minister_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_responsible_minister_id)
 then raise exception 'Responsible minister is not a game member'; end if;
 if p_curator_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_curator_id)
 then raise exception 'Curator is not a game member'; end if;

 if p_program_id is null then
  v_role:=private.game_role(p_game_id,v_uid);
  if not private.is_game_teacher(p_game_id)
     and not private.has_effective_role_like(p_game_id,v_uid,ARRAY['%министр%','%правительств%'])
  then raise exception 'Government member role required to create a state program'; end if;
  insert into public.state_programs(
   game_id,title,responsible_ministry,responsible_minister_id,curator_id,national_goal,start_date,end_date,total_budget,expected_results,created_by
  ) values(
   p_game_id,trim(p_title),trim(p_responsible_ministry),coalesce(p_responsible_minister_id,v_uid),p_curator_id,
   nullif(trim(coalesce(p_national_goal,'')),''),p_start_date,p_end_date,coalesce(p_total_budget,0),
   nullif(trim(coalesce(p_expected_results,'')),''),v_uid
  ) returning id into v_id;
 else
  perform 1 from public.state_programs where id=p_program_id and game_id=p_game_id for update;
  if not found then raise exception 'Программа не принадлежит этой игре';end if;
  if not private.can_edit_state_program(p_program_id,v_uid) then raise exception 'Program editing access required'; end if;
  update public.state_programs set title=trim(p_title),responsible_ministry=trim(p_responsible_ministry),
   responsible_minister_id=p_responsible_minister_id,curator_id=p_curator_id,national_goal=nullif(trim(coalesce(p_national_goal,'')),''),
   start_date=p_start_date,end_date=p_end_date,total_budget=coalesce(p_total_budget,0),
   expected_results=nullif(trim(coalesce(p_expected_results,'')),''),updated_at=now()
  where id=p_program_id and game_id=p_game_id returning id into v_id;
 end if;
 return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.propose_ghost_voting_policy(p_game_id uuid, p_policy_mode text, p_rationale text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_role text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if p_policy_mode not in ('prohibited','justified','allowed') then raise exception 'Unsupported Ghost Voting policy'; end if;
 v_role:=private.game_role(p_game_id,v_uid);
 if not private.is_game_teacher(p_game_id) and private.party_led_by(p_game_id,v_uid) is null and not private.has_effective_role_like(p_game_id,v_uid,ARRAY['%депутат%'])
 then raise exception 'Deputy / faction leader / teacher access required'; end if;
 insert into public.ghost_voting_policies(game_id,policy_mode,rationale,proposed_by)
 values(p_game_id,p_policy_mode,nullif(trim(coalesce(p_rationale,'')),''),v_uid) returning id into v_id;
 return v_id;
end;$function$
;

CREATE OR REPLACE FUNCTION public.create_presidential_election_appointment_resolution(p_game_id uuid, p_body text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_role text;v_doc uuid;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 v_role:=private.game_role(p_game_id,v_uid);
 if not private.is_game_teacher(p_game_id) and not private.has_effective_role_like(p_game_id,v_uid,ARRAY['%совет%федерац%','%сенатор%'])
 then raise exception 'Federation Council / teacher access required'; end if;
 if exists(select 1 from public.formal_documents where game_id=p_game_id and stage_no=7 and doc_type='sf_resolution'
           and metadata->>'purpose'='presidential_election_appointment')
 then raise exception 'Federation Council appointment resolution already exists'; end if;
 v_doc:=public.create_formal_document(
  p_game_id,7,'О назначении выборов Президента Российской Федерации','sf_resolution',
  'sf','Совет Федерации Федерального Собрания Российской Федерации',
  coalesce(nullif(trim(p_body),''),'Назначить внеочередные выборы Президента Российской Федерации в сроки, определённые игровой процедурой.'),
  null,null,null,'sf_resolution',
  jsonb_build_object('purpose','presidential_election_appointment')
 );
 return v_doc;
end;$function$
;

CREATE OR REPLACE FUNCTION public.review_government_structure(p_game_id uuid, p_action text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_uid uuid:=(select auth.uid());
 v_role text;
 s public.government_structures%rowtype;
 v_doc uuid;
 v_body text;
begin
 v_role:=private.game_role(p_game_id,v_uid);
 if not private.is_game_teacher(p_game_id) and not private.can_manage_presidential_policy(p_game_id,v_uid) then raise exception 'President / teacher access required'; end if;
 if p_action not in ('approve','revision') then raise exception 'Unsupported structure decision'; end if;
 select * into s from public.government_structures where game_id=p_game_id and status='submitted' for update;
 if s.game_id is null then raise exception 'Submitted structure not found'; end if;

 update public.government_structures
 set status=case when p_action='approve' then 'approved' else 'revision' end,
     note=nullif(trim(coalesce(p_note,'')),''),
     reviewed_by=v_uid,reviewed_at=now(),updated_at=now()
 where game_id=p_game_id;

 if p_action='approve' then
  update public.institution_units u
  set title=case u.unit_key
    when 'social' then s.social_title when 'economic' then s.economic_title when 'defence' then s.defence_title
    when 'foreign' then s.foreign_title when 'internal' then s.internal_title else u.title end
  where u.game_id=p_game_id and u.unit_kind='ministry';

  if s.formal_document_id is null then
   v_body:='УКАЗ ПРЕЗИДЕНТА РОССИЙСКОЙ ФЕДЕРАЦИИ'
    ||E'\n\nОб утверждении структуры Правительства Российской Федерации'
    ||E'\n\nУтвердить структуру Правительства Российской Федерации в составе пяти министерств:'
    ||E'\n1. '||s.social_title
    ||E'\n2. '||s.economic_title
    ||E'\n3. '||s.foreign_title
    ||E'\n4. '||s.defence_title
    ||E'\n5. '||s.internal_title||'.';
   v_doc:=private.stage8_create_formal_document(
    p_game_id,'Об утверждении структуры Правительства Российской Федерации',
    'president_decree','president','Президент Российской Федерации',
    v_body,'president_act',2,
    jsonb_build_object('purpose','government_structure','five_ministries',true)
   );
   update public.government_structures set formal_document_id=v_doc where game_id=p_game_id;
  end if;
 end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_government_nomination(p_game_id uuid, p_office_key text, p_office_title text, p_office_kind text, p_candidate_user_id uuid, p_candidate_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_uid uuid:=(select auth.uid());
 v_role text;
 v_route text;
 v_attempt integer;
 v_id uuid;
 v_structure_status text;
 v_doc uuid;
 v_body text;
 v_stage integer:=case when p_office_kind in ('deputy_pm','duma_minister','security_minister') then 9 else 8 end;
begin
 if v_uid is null or not private.is_game_member(p_game_id) or private.is_game_observer(p_game_id) then raise exception 'Game participant access required'; end if;
 -- Serialize nominations in this classroom, including the attempt number.
 perform 1 from public.games where id=p_game_id for update;
 if p_office_kind not in ('prime_minister','deputy_pm','duma_minister','security_minister','central_bank_chair') then raise exception 'Unsupported office kind'; end if;
 if length(trim(coalesce(p_office_key,'')))<2 or length(trim(coalesce(p_office_title,'')))<3 or length(trim(coalesce(p_candidate_name,'')))<3 then raise exception 'Office and candidate are required'; end if;
 if v_stage=9 and p_candidate_user_id is null then raise exception 'Minister must be a registered active student in this game';end if;
 if p_candidate_user_id is not null and not exists(
  select 1 from public.game_members where game_id=p_game_id and user_id=p_candidate_user_id and kind='student' and roster_archived_at is null
 ) then raise exception 'Candidate must be a game participant'; end if;

 if v_stage=9 and not exists (
  select 1 from public.game_members m
  where m.game_id=p_game_id and m.user_id=p_candidate_user_id
   and m.kind='student' and m.roster_archived_at is null
   and lower(regexp_replace(trim(m.full_name),'[[:space:]]+',' ','g'))
       =lower(regexp_replace(trim(p_candidate_name),'[[:space:]]+',' ','g'))
 ) then raise exception 'Candidate name must match the selected registered student';end if;

 if p_office_kind in ('prime_minister','central_bank_chair') and p_office_key<>p_office_kind then raise exception 'Office key must match office kind';end if;
 if v_stage=9 and not exists(select 1 from public.government_nominations where game_id=p_game_id and office_kind='prime_minister' and status='appointed') then raise exception 'Appoint the Prime Minister at stage 8 first';end if;
 v_role:=coalesce(private.game_role(p_game_id,v_uid),'');
 select status into v_structure_status from public.government_structures where game_id=p_game_id;

 if p_office_kind in ('prime_minister','central_bank_chair') then
  v_route:='president_to_duma';
  if not private.is_game_teacher(p_game_id) and not private.can_manage_presidential_policy(p_game_id,v_uid) then raise exception 'President role required'; end if;
 elsif p_office_kind in ('deputy_pm','duma_minister') then
  v_route:='pm_to_duma';
  if not private.is_appointed_pm(p_game_id,v_uid) then raise exception 'Appointed Prime Minister role required'; end if;
  if v_structure_status is distinct from 'approved' then raise exception 'Government structure must be approved first'; end if;
  if p_office_key not in ('ministry_social','ministry_economic','ministry_foreign') then raise exception 'This portfolio belongs to the Duma-approved group'; end if;
 else
  v_route:='president_after_sf';
  if not private.is_game_teacher(p_game_id) and not private.can_manage_presidential_policy(p_game_id,v_uid) then raise exception 'President role required'; end if;
  if v_structure_status is distinct from 'approved' then raise exception 'Government structure must be approved first'; end if;
  if p_office_key not in ('ministry_defence','ministry_internal') then raise exception 'Unsupported special portfolio'; end if;
 end if;

 if exists(select 1 from public.government_nominations where game_id=p_game_id and office_key=trim(p_office_key) and status not in ('rejected','withdrawn')) then
  raise exception 'This office already has an active nomination or appointed head';end if;
 -- Repeated appointments to different ministries are allowed; the existing
 -- unique active nomination for the same office is still enforced above.

 select coalesce(max(attempt_no),0)+1 into v_attempt
 from public.government_nominations where game_id=p_game_id and office_key=trim(p_office_key);
 if v_attempt>3 and p_office_kind in ('prime_minister','deputy_pm','duma_minister') then
  raise exception 'Three Duma rejections have already been recorded for this office';
 end if;

 insert into public.government_nominations(
  game_id,stage_no,office_key,office_title,office_kind,route,candidate_user_id,candidate_name,attempt_no,status,nominated_by
 ) values(
  p_game_id,v_stage,trim(p_office_key),trim(p_office_title),p_office_kind,v_route,p_candidate_user_id,trim(p_candidate_name),v_attempt,
  case when v_route='president_after_sf' then 'consultation_pending' else 'submitted' end,v_uid
 ) returning id into v_id;

 if v_route in ('president_to_duma','pm_to_duma') then
  v_body:='ГОСУДАРСТВЕННАЯ ДУМА ФЕДЕРАЛЬНОГО СОБРАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ'
   ||E'\n\nПРОЕКТ ПОСТАНОВЛЕНИЯ'
   ||E'\n\nО кандидатуре '||trim(p_candidate_name)||' на должность '||trim(p_office_title)
   ||E'\n\nГосударственная Дума постановляет:'
   ||E'\n1. '||case when p_office_kind='central_bank_chair' then 'Назначить ' else 'Утвердить ' end
   ||trim(p_candidate_name)||' на должность '||trim(p_office_title)||'.'
   ||case when p_office_kind='central_bank_chair' then '' else E'\n2. Направить настоящее постановление Президенту Российской Федерации.' end;

  v_doc:=private.stage8_create_formal_document(
   p_game_id,
   'О кандидатуре '||trim(p_candidate_name)||' на должность '||trim(p_office_title),
   'gd_resolution','gd','Государственная Дума Федерального Собрания Российской Федерации',
   v_body,'gd_resolution',1,
   jsonb_build_object(
    'purpose','government_nomination',
    'nomination_id',v_id,
    'office_key',trim(p_office_key),
    'candidate_name',trim(p_candidate_name),
    'attempt_no',v_attempt
   )
  );
  update public.government_nominations set formal_document_id=v_doc where id=v_id;
 end if;

 -- После внесения Думской кандидатуры в той же транзакции открывается голосование.
 if v_route in ('president_to_duma','pm_to_duma') then
  perform private.ensure_government_nomination_vote(v_id);
 end if;
 return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.appoint_government_nominee(p_nomination_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 n public.government_nominations%rowtype;
 v_uid uuid:=(select auth.uid());
 v_role text;
 v_unit_key text;
 v_doc uuid;
begin
 select * into n from public.government_nominations where id=p_nomination_id for update;
 if n.id is null then raise exception 'Nomination not found'; end if;
 if n.office_kind='central_bank_chair' then raise exception 'The Chair of the Bank of Russia is appointed by the State Duma vote itself'; end if;
 if v_uid is null or not private.is_game_member(n.game_id) then raise exception 'Game access required';end if;
 v_role:=coalesce(private.game_role(n.game_id,v_uid),'');
 if not private.is_game_teacher(n.game_id) and not private.can_manage_presidential_policy(n.game_id,v_uid) then raise exception 'President role required'; end if;
 if n.route in ('president_to_duma','pm_to_duma') and n.status<>'approved' then raise exception 'Duma approval is required before appointment'; end if;
 if n.route='president_after_sf' and n.status<>'consulted' then raise exception 'Federation Council consultation must be recorded first'; end if;

 if n.stage_no=9 and not exists (
  select 1 from public.game_members m
  where m.game_id=n.game_id and m.user_id=n.candidate_user_id
   and m.kind='student' and m.roster_archived_at is null
   and lower(regexp_replace(trim(m.full_name),'[[:space:]]+',' ','g'))
       =lower(regexp_replace(trim(n.candidate_name),'[[:space:]]+',' ','g'))
 ) then raise exception 'Minister must be a registered active student of this game';end if;

 v_doc:=private.stage8_create_appointment_decree(n.id);

 update public.government_nominations set status='appointed',appointed_at=now(),updated_at=now(),appointment_document_id=coalesce(appointment_document_id,v_doc) where id=n.id;
 if n.candidate_user_id is not null then
  update public.game_members m
  set role_title=case when exists(
    select 1 from public.game_office_assignments a
    where a.game_id=n.game_id and a.user_id=n.candidate_user_id
      and a.status='active'
      and lower(trim(a.role_title))='президент российской федерации'
  ) then 'Президент Российской Федерации'
    when private.is_appointed_pm(n.game_id,n.candidate_user_id)
      then 'Председатель Правительства Российской Федерации'
    else n.office_title end
  where m.game_id=n.game_id and m.user_id=n.candidate_user_id;
  if n.office_key like 'ministry_%' then
   v_unit_key:=substring(n.office_key from 10);
   update public.institution_units set head_user_id=n.candidate_user_id
   where game_id=n.game_id and unit_kind='ministry' and unit_key=v_unit_key;
  end if;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(n.game_id,n.stage_no,'Формирование Правительства','notice','Назначение · '||n.office_title,n.candidate_name,v_uid);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.appoint_government_nominee_after_three_rejections(p_nomination_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 n public.government_nominations%rowtype;
 v_uid uuid:=(select auth.uid());
 v_role text;
 v_rejections integer;
 v_unit_key text;
 v_doc uuid;
begin
 select * into n from public.government_nominations where id=p_nomination_id for update;
 if n.id is null then raise exception 'Nomination not found'; end if;
 if n.status<>'rejected' then raise exception 'Only a rejected nomination can be appointed under the three-rejection rule'; end if;
 if n.office_kind not in ('prime_minister','deputy_pm','duma_minister') then raise exception 'The three-rejection appointment rule does not apply to this office'; end if;
 if v_uid is null or not private.is_game_member(n.game_id) then raise exception 'Game access required';end if;
 v_role:=coalesce(private.game_role(n.game_id,v_uid),'');
 if not private.is_game_teacher(n.game_id) and not private.can_manage_presidential_policy(n.game_id,v_uid) then raise exception 'President role required'; end if;

 select count(*)::integer into v_rejections
 from public.government_nominations
 where game_id=n.game_id and office_key=n.office_key and status='rejected';
 if v_rejections<3 then raise exception 'Three Duma rejections are required'; end if;

 if n.stage_no=9 and not exists (
  select 1 from public.game_members m
  where m.game_id=n.game_id and m.user_id=n.candidate_user_id
   and m.kind='student' and m.roster_archived_at is null
   and lower(regexp_replace(trim(m.full_name),'[[:space:]]+',' ','g'))
       =lower(regexp_replace(trim(n.candidate_name),'[[:space:]]+',' ','g'))
 ) then raise exception 'Minister must be a registered active student of this game';end if;

 v_doc:=private.stage8_create_appointment_decree(n.id);

 update public.government_nominations
 set status='appointed',appointed_at=now(),decided_at=coalesce(decided_at,now()),updated_at=now(),
     appointment_document_id=coalesce(appointment_document_id,v_doc),
     note=trim(both from concat_ws(E'\n',nullif(note,''),'Назначено Президентом после трёх отклонений Государственной Думой.'))
 where id=n.id;

 if n.candidate_user_id is not null then
  update public.game_members m
  set role_title=case when exists(
    select 1 from public.game_office_assignments a
    where a.game_id=n.game_id and a.user_id=n.candidate_user_id
      and a.status='active'
      and lower(trim(a.role_title))='президент российской федерации'
  ) then 'Президент Российской Федерации'
    when private.is_appointed_pm(n.game_id,n.candidate_user_id)
      then 'Председатель Правительства Российской Федерации'
    else n.office_title end
  where m.game_id=n.game_id and m.user_id=n.candidate_user_id;
  if n.office_key like 'ministry_%' then
   v_unit_key:=substring(n.office_key from 10);
   update public.institution_units set head_user_id=n.candidate_user_id
   where game_id=n.game_id and unit_kind='ministry' and unit_key=v_unit_key;
  end if;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(n.game_id,n.stage_no,'Формирование Правительства','notice','Назначение после трёх отклонений · '||n.office_title,n.candidate_name,v_uid);
end;
$function$
;
