-- Stage 4 completion guard: work must finish before any official completion.
-- Retains all other stages' former lifecycle. No RLS, player data or votes changed.
-- Readiness uses the canonical 450-seat allocation even before formal party distribution.
CREATE OR REPLACE FUNCTION private.stage_readiness_json(p_game uuid, p_stage integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 b jsonb:='[]'::jsonb;
 w jsonb:='[]'::jsonb;
 m jsonb:='{}'::jsonb;
 c integer:=0;
 c2 integer:=0;
 c3 integer:=0;
 n numeric:=0;
 s text;
begin
 if p_stage=1 then
  select count(*) into c from public.game_parties where game_id=p_game;
  select count(*) into c2 from public.game_parties where game_id=p_game and registration_status='registered';
  m:=jsonb_build_object('parties',c,'registered',c2);
  if c=0 then b:=b||jsonb_build_array('Не создано ни одной политической партии'); end if;
  if c>0 and c2<c then b:=b||jsonb_build_array('Не все партии получили итоговый статус «зарегистрирована»'); end if;
 elsif p_stage=2 then
  select count(*) into c from public.parliamentary_election_rules where game_id=p_game and status='adopted';
  m:=jsonb_build_object('adopted_rules',c);
  if c=0 then b:=b||jsonb_build_array('КСРФ не принял тип избирательной системы и электоральную формулу'); end if;
 elsif p_stage=3 then
  select count(*) into c from public.regional_election_rules where game_id=p_game and status='allocated';
  select coalesce(sum(regions),0) into n from public.game_parties where game_id=p_game;
  m:=jsonb_build_object('allocated_rules',c,'regions',n);
  if c=0 then b:=b||jsonb_build_array('Не зафиксирован итог распределения 89 субъектов РФ'); end if;
  if c>0 and n<>89 then b:=b||jsonb_build_array('Сумма контролируемых субъектов не равна 89'); end if;
 elsif p_stage=4 then
  -- Stored base mandates take precedence. Until assigned, use the verified
  -- equal-seat GD capacity (450 seats across active participants).
  select case when (select coalesce(sum(pm.base_mandates),0) from public.party_member_mandates pm where pm.game_id=p_game)>0
   then (select coalesce(sum(pm.base_mandates),0) from public.party_member_mandates pm where pm.game_id=p_game)
   else (select coalesce(sum(private.gd_member_capacity(gm.game_id,gm.user_id)),0)
     from public.game_members gm where gm.game_id=p_game and gm.kind='student' and gm.roster_archived_at is null)
   end into n;
  select count(*) into c from public.office_elections where game_id=p_game and stage_no=4 and office_key='gd_chair' and status='finished';
  select count(*) into c2 from public.office_elections where game_id=p_game and stage_no=4 and office_key in ('gd_deputy_1','gd_deputy_2') and status='finished';
  m:=jsonb_build_object('mandates',n,'chair_finished',c,'deputies_finished',c2);
  if n<>450 then b:=b||jsonb_build_array('Распределено не 450 мандатов Государственной Думы'); end if;
  if c=0 then b:=b||jsonb_build_array('Не завершены выборы Председателя Государственной Думы'); end if;
  if c2<2 then b:=b||jsonb_build_array('Не завершены выборы двух заместителей Председателя ГД'); end if;

  select count(*) into c from public.institution_units where game_id=p_game and unit_kind='committee';
  select count(*) into c2 from public.institution_units where game_id=p_game and unit_kind='committee' and head_user_id is not null;
  m:=m||jsonb_build_object('committees',c,'committee_heads',c2);
  if c<5 then b:=b||jsonb_build_array('На первом заседании ГД не созданы все пять комитетов');end if;
  if c>=5 and c2<5 then b:=b||jsonb_build_array('Не избраны председатели всех пяти комитетов ГД');end if;
  if exists(select 1 from public.institution_units u where u.game_id=p_game and u.unit_kind='committee'
    and not exists(select 1 from public.institution_assignments a where a.unit_id=u.id))
  then b:=b||jsonb_build_array('Есть комитеты ГД без участников');end if;
 elsif p_stage=5 then
  select count(*) into c from public.ghost_voting_policies where game_id=p_game and status='adopted';
  m:=jsonb_build_object('policy_adopted',c);
  if c=0 then b:=b||jsonb_build_array('ГД не приняла постановление о режиме Goust Voting'); end if;
  if exists(select 1 from public.game_parties where game_id=p_game and ghost_active) then w:=w||jsonb_build_array('Сейчас действует временная потеря мандатов Goust Voting; снимите её после завершения соответствующего заседания'); end if;
 elsif p_stage=6 then
  select count(*) into c from public.presidential_candidates where game_id=p_game and archived_at is null and registration_status='registered';
  select count(*) into c2 from public.presidential_candidates where game_id=p_game and archived_at is null and registration_status in ('submitted','revision');
  select count(*) into c3 from public.presidential_system_proposals where game_id=p_game and status='adopted';
  m:=jsonb_build_object('registered_candidates',c,'pending_candidates',c2,'duma_system_decision',c3);
  if c3=0 then b:=b||jsonb_build_array('Государственная Дума ещё не утвердила тип избирательной системы выборов Президента');end if;
  if c=0 then b:=b||jsonb_build_array('Нет ни одного зарегистрированного кандидата в Президенты'); end if;
  if c2>0 then w:=w||jsonb_build_array('Есть кандидатуры, которые ещё находятся на проверке или доработке'); end if;
 elsif p_stage=7 then
  select status into s from public.presidential_election_settings where game_id=p_game;
  select count(*) into c from public.presidential_system_proposals where game_id=p_game and status='adopted';
  select count(*) into c2 from public.formal_documents where game_id=p_game and stage_no=7 and doc_type='sf_resolution' and metadata->>'purpose'='presidential_election_appointment';
  m:=jsonb_build_object('election_status',coalesce(s,'not_configured'),'duma_system_decision',c,'sf_appointment_resolution',c2);
  if c=0 then b:=b||jsonb_build_array('Государственная Дума не приняла тип мажоритарной системы выборов Президента'); end if;
  if c2=0 then b:=b||jsonb_build_array('Не создано постановление Совета Федерации о назначении выборов Президента'); end if;
  if s is null then b:=b||jsonb_build_array('Модель президентских выборов не настроена');
  elsif s='manual_required' then b:=b||jsonb_build_array('Президентские выборы требуют ручного разрешения преподавателем');
  elsif s<>'finished' then b:=b||jsonb_build_array('Президентские выборы ещё не завершены'); end if;
 elsif p_stage=8 then
  select count(*) into c from public.government_nominations where game_id=p_game and stage_no=8 and office_kind='prime_minister' and status='appointed';
  select count(*) into c2 from public.government_structures where game_id=p_game and status='approved';
  select count(*) into c3 from public.government_nominations where game_id=p_game and stage_no=8 and office_kind='central_bank_chair' and status='appointed';
  m:=jsonb_build_object('prime_minister_appointed',c,'structure_approved',c2,'central_bank_chair_appointed',c3);
  if c=0 then b:=b||jsonb_build_array('Председатель Правительства ещё не назначен');end if;
  if c2=0 then b:=b||jsonb_build_array('Президент не одобрил структуру из пяти министерств');end if;
  if c3=0 then b:=b||jsonb_build_array('Не завершено назначение Председателя Банка России решением Государственной Думы');end if;
  if exists(select 1 from public.government_nominations where game_id=p_game and stage_no=8 and status not in ('appointed','withdrawn','rejected'))
  then w:=w||jsonb_build_array('Есть незавершённые кадровые процедуры этапа 8');end if;
 elsif p_stage=9 then
  select count(*) into c from public.institution_units where game_id=p_game and unit_kind='ministry';
  select count(*) into c2 from public.institution_assignments where game_id=p_game and unit_kind='ministry';
  select count(*) into c3 from public.game_members gm where gm.game_id=p_game and gm.kind='student' and gm.roster_archived_at is null
   and not exists(select 1 from public.institution_assignments a where a.game_id=p_game and a.user_id=gm.user_id and a.unit_kind='ministry');
  select count(distinct office_key) into n from public.government_nominations where game_id=p_game and stage_no=9 and office_key like 'ministry_%' and status='appointed';
  m:=jsonb_build_object('ministries',c,'ministry_members',c2,'unassigned_students',c3,'ministers_appointed',n,
   'special_ministers',(select count(*) from public.government_nominations where game_id=p_game and stage_no=9 and office_kind='security_minister' and status='appointed'),
   'deputy_pm',(select count(*) from public.government_nominations where game_id=p_game and stage_no=9 and office_kind='deputy_pm' and status='appointed'));
  if not exists(select 1 from public.government_nominations where game_id=p_game and office_kind='prime_minister' and status='appointed')
   or not exists(select 1 from public.government_structures where game_id=p_game and status='approved')
  then b:=b||jsonb_build_array('Завершите назначение Председателя Правительства и утверждение структуры на этапе 8');end if;
  if c<5 then b:=b||jsonb_build_array('Пять министерств ещё не созданы из утверждённой структуры');end if;
  if n<5 then b:=b||jsonb_build_array('Назначьте руководителей всех пяти министерств на этом этапе');end if;
  if (select count(*) from public.government_nominations where game_id=p_game and stage_no=9 and office_kind='security_minister' and status='appointed')<2
  then b:=b||jsonb_build_array('Назначьте обоих специальных министров после консультаций с Советом Федерации');end if;
  if not exists(select 1 from public.government_nominations where game_id=p_game and stage_no=9 and office_kind='deputy_pm' and status='appointed')
  then b:=b||jsonb_build_array('Назначьте одного из министров заместителем Председателя Правительства');end if;
  if exists(select 1 from public.institution_units u where u.game_id=p_game and u.unit_kind='ministry'
    and not exists(select 1 from public.institution_assignments a where a.unit_id=u.id))
  then b:=b||jsonb_build_array('Есть министерства без участников');end if;
  if c3>0 then b:=b||jsonb_build_array('Не все участники распределены по министерствам');end if;
  if exists(select 1 from public.institution_units u where u.game_id=p_game and u.unit_kind='ministry'
    and (select count(*) from public.institution_assignments a where a.unit_id=u.id) not between coalesce(u.capacity_min,3) and coalesce(u.capacity_max,5))
  then w:=w||jsonb_build_array('Численность некоторых министерств выходит за ориентир 3–5 человек; учитывайте размер учебной группы');end if;
 elsif p_stage=10 then
  select count(*) into c from public.presidential_addresses where game_id=p_game and status='published';
  select count(*) into c2 from public.state_programs where game_id=p_game;
  select count(*) into c3 from public.state_programs where game_id=p_game and status not in ('ready','government_vote','adopted','rejected');
  m:=jsonb_build_object('published_addresses',c,'programs',c2,'unfinished_programs',c3);
  if c=0 then b:=b||jsonb_build_array('Не опубликовано послание Президента с приоритетами государственной политики'); end if;
  if c2<5 then b:=b||jsonb_build_array('Создано менее пяти государственных программ — по одной для каждого игрового министерства'); end if;
  if c3>0 then b:=b||jsonb_build_array('Есть государственные программы, не прошедшие этап разработки и предварительного согласования'); end if;
 elsif p_stage=11 then
  select count(*) into c from public.government_sessions where game_id=p_game and stage_no=11 and status='closed';
  select count(*) into c2 from public.state_programs where game_id=p_game and status not in ('adopted','rejected');
  select count(*) into c3 from public.state_programs where game_id=p_game and status='adopted';
  select count(*) into n from public.formal_documents where game_id=p_game and stage_no=11 and doc_type='government_resolution'
    and status_code='published' and metadata ? 'state_program_id';
  m:=jsonb_build_object('closed_sessions',c,'unresolved_programs',c2,'adopted_programs',c3,'government_resolutions',n);
  if c=0 then b:=b||jsonb_build_array('Не закрыто ни одного заседания Правительства по государственным программам'); end if;
  if c2>0 then b:=b||jsonb_build_array('Не по всем государственным программам принято итоговое решение Правительства'); end if;
  if n<c3 then b:=b||jsonb_build_array('Не все принятые государственные программы оформлены постановлениями Правительства'); end if;
 elsif p_stage=12 then
  select count(*) into c from public.formal_documents where game_id=p_game and stage_no=12 and workflow_key='bill';
  select count(*) into c2 from public.duma_sessions where game_id=p_game and stage_no=12 and status='closed';
  select count(*) into c3 from public.formal_documents where game_id=p_game and stage_no=12 and workflow_key='bill' and status_code in ('published','rejected');
  m:=jsonb_build_object(
   'bills',c,'closed_duma_sessions',c2,'terminal_bills',c3,
   'published_bills',(select count(*) from public.formal_documents where game_id=p_game and stage_no=12 and workflow_key='bill' and status_code='published')
  );
  if c=0 then b:=b||jsonb_build_array('В реестре НПА нет законопроекта, созданного на этапе 12'); end if;
  if c2=0 then b:=b||jsonb_build_array('Не завершено ни одного заседания Государственной Думы с законодательной повесткой'); end if;
  if c3=0 then b:=b||jsonb_build_array('Ни один законопроект этапа 12 не доведён до итогового решения по формальной процедуре'); end if;
  if exists(select 1 from public.duma_sessions where game_id=p_game and stage_no=12 and status='open') then w:=w||jsonb_build_array('Сейчас открыто заседание ГД; завершите или осознанно перенесите остаток повестки'); end if;
  if exists(
   select 1 from public.formal_documents d
   where d.game_id=p_game and d.stage_no=12 and d.workflow_key='bill'
     and d.status_code not in ('published','rejected')
  ) then w:=w||jsonb_build_array('Есть законопроекты, которые ещё проходят процедуру'); end if;
 elsif p_stage=13 then
  select count(*) into c from public.budget_scenarios where game_id=p_game and stage_no=13 and status='final';
  select count(*) into c2 from public.budget_scenarios where game_id=p_game and stage_no=13 and status='final' and formal_document_id is not null;
  select count(*) into c3
  from public.budget_scenarios s join public.formal_documents d on d.id=s.formal_document_id
  where s.game_id=p_game and s.stage_no=13 and s.status='final' and d.status_code='published';
  m:=jsonb_build_object(
   'final_scenarios',c,'budget_bills',c2,'published_budget_laws',c3,
   'preliminary_reviews_accepted',(select count(*) from public.budget_preliminary_reviews br join public.formal_documents d on d.id=br.document_id where br.game_id=p_game and d.stage_no=13 and br.decision='accept')
  );
  if c=0 then b:=b||jsonb_build_array('Не зафиксирован итоговый бюджетный сценарий'); end if;
  if c2=0 then b:=b||jsonb_build_array('Из финального сценария не создан проект федерального бюджета в реестре НПА'); end if;
  if c2>0 and not exists(
    select 1 from public.budget_scenarios s join public.formal_documents d on d.id=s.formal_document_id
    where s.game_id=p_game and s.stage_no=13 and s.status='final'
      and (d.status_code in ('reading1','amendments','reading2','reading3','sf','president','published','budget_conciliation')
        or exists(select 1 from public.budget_preliminary_reviews br where br.document_id=d.id and br.decision='accept'))
  ) then b:=b||jsonb_build_array('Проект федерального бюджета не прошёл предварительную проверку Комитета по бюджету и Совета ГД'); end if;
  if c2>0 and c3=0 then b:=b||jsonb_build_array('Федеральный бюджет не завершил I–III чтения, рассмотрение Советом Федерации и президентскую стадию'); end if;
 elsif p_stage=14 then
  select count(*) into c from public.municipal_mayor_elections where game_id=p_game and status='finished';
  select count(*) into c2 from public.municipal_districts where game_id=p_game;
  select count(*) into c3 from public.municipal_districts where game_id=p_game and head_user_id is not null;
  select count(distinct district_key) into n from public.municipal_projects
   where game_id=p_game and stage_no=14 and status in ('submitted','vote_open','adopted','rejected') and district_key is not null;
  m:=jsonb_build_object(
   'mayor_election_finished',c,'districts',c2,'district_heads',c3,'districts_with_project',n,
   'assigned_students',(select count(*) from public.municipal_district_members where game_id=p_game)
  );
  if c=0 then b:=b||jsonb_build_array('Не завершены тайные выборы главы города Барнаула'); end if;
  if c2<5 then b:=b||jsonb_build_array('Не сформированы все пять районных администраций Барнаула'); end if;
  if c3<5 then b:=b||jsonb_build_array('Назначены не все пять глав районных администраций'); end if;
  if n<5 then b:=b||jsonb_build_array('Не каждый район подготовил и передал на рассмотрение собственный муниципальный проект'); end if;
  if exists(
   select 1 from public.game_members gm
   where gm.game_id=p_game and gm.kind='student' and gm.roster_archived_at is null
     and gm.user_id is distinct from (select winner_user_id from public.municipal_mayor_elections where game_id=p_game and status='finished' order by closed_at desc limit 1)
     and not exists(select 1 from public.municipal_district_members dm where dm.game_id=p_game and dm.user_id=gm.user_id)
  ) then w:=w||jsonb_build_array('Есть студенты, не распределённые по районным администрациям'); end if;
  if exists(select 1 from public.municipal_projects where game_id=p_game and stage_no=14 and status in ('fieldwork','draft')) then w:=w||jsonb_build_array('Есть муниципальные проекты, оставшиеся на полевом или черновом этапе'); end if;
 elsif p_stage=15 then
  select count(*) into c from public.game_crises where game_id=p_game and stage_no=15;
  select count(*) into c2 from public.game_crises where game_id=p_game and stage_no=15 and status='resolved';
  m:=jsonb_build_object('crises',c,'resolved',c2);
  if c=0 then b:=b||jsonb_build_array('Кризисный сценарий этапа 15 ещё не запущен'); end if;
  if exists(select 1 from public.game_crises where game_id=p_game and stage_no=15 and status='active') then b:=b||jsonb_build_array('Активный кризис ещё не завершён и не разобран'); end if;
  if c>0 and c2=0 then b:=b||jsonb_build_array('Нет завершённого кризисного сценария'); end if;
 elsif p_stage=16 then
  select count(*) into c from public.game_members where game_id=p_game and kind='student' and roster_archived_at is null;
  select count(*) into c3 from (select r.user_id from public.game_reflections r join public.game_members gm on gm.game_id=r.game_id and gm.user_id=r.user_id and gm.kind='student' and gm.roster_archived_at is null where r.game_id=p_game and r.status in ('submitted','reviewed') group by r.user_id having count(distinct r.phase_key)>=6) q;
  m:=jsonb_build_object('students',c,'students_completed_reflection',c3);
  if c=0 then b:=b||jsonb_build_array('В игре нет студентов, для которых можно провести итоговую рефлексию');
  elsif c3<c then b:=b||jsonb_build_array('Не все студенты сдали рефлексию по шести фазам игры'); end if;
  if exists(select 1 from public.game_reflections where game_id=p_game and status='submitted') then w:=w||jsonb_build_array('Есть сданные рефлексии, которые преподаватель ещё не разобрал'); end if;
 end if;
 return jsonb_build_object('stage_no',p_stage,'ready',jsonb_array_length(b)=0,'blockers',b,'warnings',w,'metrics',m);
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_expired_game_stages()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare g uuid;n integer:=0;v_total integer;v_extended integer;v_open integer;v_earliest timestamptz;v_next integer;
begin
 for g in select distinct game_id from public.game_stages
  where status='open' and deadline is not null and deadline<=clock_timestamp() loop
  perform pg_advisory_xact_lock(hashtextextended('stage-control:'||g,0));
  -- Incomplete stage 4 must remain actionable. Renew only its expired deadline;
  -- all other stages retain the previous expiry behavior.
  update public.game_stages s set deadline=clock_timestamp()+interval '30 minutes'
  where s.game_id=g and s.stage_no=4 and s.status='open'
    and s.deadline is not null and s.deadline<=clock_timestamp()
    and not coalesce((private.stage_readiness_json(g,4)->>'ready')::boolean,false);
  get diagnostics v_extended=row_count;
  if v_extended>0 then
   update public.stage_deadline_rules r set
     deadline_at=(select s.deadline from public.game_stages s where s.game_id=g and s.stage_no=4),
     updated_at=clock_timestamp()
   where r.game_id=g and r.stage_no=4;
  end if;
  update public.game_stages set status='completed',completed_at=clock_timestamp()
  where game_id=g and status='open' and deadline is not null and deadline<=clock_timestamp();
  get diagnostics v_total=row_count;n:=n+v_total;
  if v_total>0 or v_extended>0 then
   select count(*),min(deadline) into v_open,v_earliest from public.game_stages where game_id=g and status='open';
   select stage_no into v_next from public.game_stages where game_id=g and status='open' order by deadline nulls last,stage_no limit 1;
   update public.games set current_round=greatest(current_round,coalesce(v_next,current_round)),
    turn_open=v_open>0,turn_ends_at=case when v_open>0 then v_earliest else null end,
    status=case when v_open>0 then 'running' else 'paused' end where id=g;
  end if;
 end loop;
 return n;
end $function$;

CREATE OR REPLACE FUNCTION public.manage_game_stage(p_game_id uuid, p_stage_no integer, p_action text, p_minutes integer DEFAULT 30)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.game_stages%rowtype;v_deadline timestamptz;v_next integer;v_earliest timestamptz;v_count integer;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required' using errcode='42501';end if;
 if p_stage_no not between 1 and 16 or p_action not in ('open','close','extend') then
  raise exception 'Invalid stage operation' using errcode='22023';end if;
 if p_action in ('open','extend') and (p_minutes is null or p_minutes<1 or p_minutes>43200) then
  raise exception 'Duration must be 1–43200 minutes' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('stage-control:'||p_game_id,0));
 select * into s from public.game_stages where game_id=p_game_id and stage_no=p_stage_no for update;
 if not found then raise exception 'Stage not found' using errcode='P0002';end if;
 if p_action='close' then
  if s.status<>'open' then raise exception 'Stage is not open' using errcode='22023';end if;
  if p_stage_no=4
    and not coalesce((private.stage_readiness_json(p_game_id,4)->>'ready')::boolean,false)
  then raise exception 'Нельзя завершить этап 4: сначала изберите руководство и председателей пяти комитетов, распределите депутатов и завершите обязательные процедуры' using errcode='23514';end if;
  update public.game_stages set status='completed',completed_at=clock_timestamp() where id=s.id;
 elsif p_action='open' then
  if s.status='open' then raise exception 'Stage is already open' using errcode='22023';end if;
  v_deadline:=case when s.deadline>clock_timestamp() then s.deadline
   else clock_timestamp()+make_interval(mins=>p_minutes) end;
  update public.game_stages set status='open',
   opened_at=clock_timestamp(),completed_at=null,deadline=v_deadline where id=s.id;
 elsif p_action='extend' then
  if s.status<>'open' then raise exception 'Only open stages can be extended' using errcode='22023';end if;
  v_deadline:=greatest(coalesce(s.deadline,clock_timestamp()),clock_timestamp())+make_interval(mins=>p_minutes);
  update public.game_stages set deadline=v_deadline where id=s.id;
 end if;
 if p_action in ('open','extend') then
  update public.stage_deadline_rules set deadline_at=v_deadline,updated_by=auth.uid(),updated_at=clock_timestamp()
  where game_id=p_game_id and stage_no=p_stage_no;
 end if;
 select count(*),min(deadline) into v_count,v_earliest
 from public.game_stages where game_id=p_game_id and status='open';
 select stage_no into v_next from public.game_stages
 where game_id=p_game_id and status='open' order by deadline nulls last,stage_no limit 1;
 update public.games set
  current_round=greatest(current_round,coalesce(v_next,current_round)),
  turn_open=v_count>0,
  turn_ends_at=case when v_count>0 then v_earliest else null end,
  status=case when v_count>0 then 'running' else 'paused' end
 where id=p_game_id;
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(p_game_id,auth.uid(),'manage_game_stage','game_stages',
  jsonb_build_object('stage_no',p_stage_no,'operation',p_action,'minutes',p_minutes,'deadline',v_deadline));
end $function$;
