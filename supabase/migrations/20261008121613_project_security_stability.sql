-- Defensive authorization, consistent readiness and document/chat scope.
-- Existing classroom data and unrelated applications are preserved.


CREATE OR REPLACE FUNCTION private.game_role(p_game uuid, p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 select coalesce((select case when private.role_is_available(p_game,p_user)
   then lower(coalesce(role_title,'')) else '' end
 from public.game_members
 where game_id=p_game and user_id=p_user
 limit 1),'');
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
 if v_uid is null or not private.is_game_member(u.game_id) or private.is_game_observer(u.game_id) then raise exception 'Game participant access required';end if;
 if not exists(select 1 from public.game_members where game_id=u.game_id and user_id=p_user_id and kind='student' and roster_archived_at is null) then raise exception 'Student not found in this game'; end if;

 if u.unit_kind='committee' then
   v_party:=private.member_party_id(u.game_id,v_uid);
   v_target_party:=private.member_party_id(u.game_id,p_user_id);
   if not private.is_game_teacher(u.game_id) then
     if v_party is null or not exists(select 1 from public.game_parties where id=v_party and leader_user_id=v_uid) then raise exception 'Faction leader access required'; end if;
     if v_target_party is distinct from v_party then raise exception 'Faction leader may assign only members of their own faction'; end if;
   end if;
   if v_target_party is null then raise exception 'Committee member must belong to a parliamentary faction'; end if;
 else
   v_role:=private.game_role(u.game_id,v_uid);
   if not private.is_game_teacher(u.game_id)
      and v_uid is distinct from u.head_user_id
      and v_role not like '%председател%правительств%'
   then raise exception 'Minister / Prime Minister / teacher access required'; end if;
   v_target_party:=null;
 end if;

 insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,created_by)
 values(u.game_id,u.id,u.unit_kind,p_user_id,v_target_party,v_uid)
 on conflict(game_id,user_id,unit_kind) do update
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
 if a.unit_kind='committee' then
   v_party:=private.member_party_id(a.game_id,v_uid);
   if not private.is_game_teacher(a.game_id)
      and not exists(select 1 from public.game_parties where id=v_party and leader_user_id=v_uid and id=a.party_id)
   then raise exception 'Faction leader access required'; end if;
 else
   v_role:=private.game_role(a.game_id,v_uid);
   if not private.is_game_teacher(a.game_id) and v_uid is distinct from u.head_user_id and v_role not like '%председател%правительств%'
   then raise exception 'Minister / Prime Minister / teacher access required'; end if;
 end if;
 delete from public.institution_assignments where id=a.id;
end;$function$
;

CREATE OR REPLACE FUNCTION public.advance_state_program(p_program_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_role text;v_ready jsonb;
begin
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found'; end if;
 if v_uid is null or not private.is_game_member(p.game_id) or private.is_game_observer(p.game_id) then raise exception 'Game participant access required';end if;
 v_role:=private.game_role(p.game_id,v_uid);
 if p_action='submit_minister' then
  if p.status not in ('draft','revision') then raise exception 'Program is not awaiting submission';end if;
  if not private.can_edit_state_program(p.id,v_uid) then raise exception 'Program editing access required'; end if;
  v_ready:=private.state_program_readiness_json(p.id);
  if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Program is not ready: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;
  update public.state_programs set status='minister_review',updated_at=now() where id=p.id;
 elsif p_action in ('minister_approve','minister_revision') then
  if p.status<>'minister_review' then raise exception 'Program is not awaiting minister review';end if;
  if not private.is_game_teacher(p.game_id) and p.responsible_minister_id is distinct from v_uid then raise exception 'Responsible minister access required'; end if;
  update public.state_programs set status=case when p_action='minister_approve' then 'pm_review' else 'revision' end,updated_at=now() where id=p.id;
 elsif p_action in ('pm_ready','pm_revision') then
  if p.status<>'pm_review' then raise exception 'Program is not awaiting Prime Minister review';end if;
  if not private.is_game_teacher(p.game_id) and v_role not like '%председател%правительств%' then raise exception 'Prime Minister access required'; end if;
  update public.state_programs set status=case when p_action='pm_ready' then 'ready' else 'revision' end,updated_at=now() where id=p.id;
 else raise exception 'Unsupported program action'; end if;
end;$function$
;

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
  select coalesce(sum(mandates),0) into n from public.game_parties where game_id=p_game;
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
  if c=0 then b:=b||jsonb_build_array('ГД не приняла постановление о режиме Ghost voting'); end if;
  if exists(select 1 from public.game_parties where game_id=p_game and ghost_active) then w:=w||jsonb_build_array('Сейчас действует временная потеря мандатов Ghost voting; снимите её после завершения соответствующего заседания'); end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_stage_readiness(p_game_id uuid, p_stage_no integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_uid uuid:=(select auth.uid());
 v jsonb;
 v_reason text;
 v_at timestamptz;
 v_original jsonb;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if p_stage_no<1 or p_stage_no>16 then raise exception 'Stage number must be 1-16'; end if;

 v:=private.stage_readiness_json(p_game_id,p_stage_no);


 select reason,created_at into v_reason,v_at
 from public.stage_readiness_overrides
 where game_id=p_game_id and stage_no=p_stage_no and is_active
 order by created_at desc limit 1;

 if v_reason is not null then
  v_original:=coalesce(v->'blockers','[]'::jsonb);
  v:=jsonb_set(jsonb_set(v,'{ready}','true'::jsonb),'{blockers}','[]'::jsonb)
    ||jsonb_build_object(
      'overridden',true,'override_reason',v_reason,'override_at',v_at,'original_blockers',v_original,
      'warnings',(v->'warnings')||jsonb_build_array('Историческое прохождение подтверждено преподавателем; структурированные данные этого этапа могут отсутствовать')
    );
 else
  v:=v||jsonb_build_object('overridden',false,'original_blockers','[]'::jsonb);
 end if;
 return v;
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
 if p_candidate_user_id is not null and not exists(
  select 1 from public.game_members where game_id=p_game_id and user_id=p_candidate_user_id and kind='student' and roster_archived_at is null
 ) then raise exception 'Candidate must be a game participant'; end if;

 if p_office_kind in ('prime_minister','central_bank_chair') and p_office_key<>p_office_kind then raise exception 'Office key must match office kind';end if;
 if v_stage=9 and not exists(select 1 from public.government_nominations where game_id=p_game_id and office_kind='prime_minister' and status='appointed') then raise exception 'Appoint the Prime Minister at stage 8 first';end if;
 v_role:=coalesce(private.game_role(p_game_id,v_uid),'');
 select status into v_structure_status from public.government_structures where game_id=p_game_id;

 if p_office_kind in ('prime_minister','central_bank_chair') then
  v_route:='president_to_duma';
  if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;
 elsif p_office_kind in ('deputy_pm','duma_minister') then
  v_route:='pm_to_duma';
  if not private.is_appointed_pm(p_game_id,v_uid) then raise exception 'Appointed Prime Minister role required'; end if;
  if v_structure_status is distinct from 'approved' then raise exception 'Government structure must be approved first'; end if;
  if p_office_key not in ('ministry_social','ministry_economic','ministry_foreign') then raise exception 'This portfolio belongs to the Duma-approved group'; end if;
 else
  v_route:='president_after_sf';
  if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;
  if v_structure_status is distinct from 'approved' then raise exception 'Government structure must be approved first'; end if;
  if p_office_key not in ('ministry_defence','ministry_internal') then raise exception 'Unsupported special portfolio'; end if;
 end if;

 if exists(select 1 from public.government_nominations where game_id=p_game_id and office_key=trim(p_office_key) and status not in ('rejected','withdrawn')) then
  raise exception 'This office already has an active nomination or appointed head';end if;
 if p_candidate_user_id is not null and p_office_kind in ('deputy_pm','duma_minister','security_minister') and exists(
  select 1 from public.government_nominations where game_id=p_game_id and candidate_user_id=p_candidate_user_id
   and office_kind in ('deputy_pm','duma_minister','security_minister') and status not in ('rejected','withdrawn')
 ) then raise exception 'A participant may head only one ministry';end if;

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

 return v_id;
end;
$function$
;

create unique index if not exists government_nominations_one_ministry_candidate_idx
 on public.government_nominations(game_id,candidate_user_id)
 where candidate_user_id is not null and office_kind in ('deputy_pm','duma_minister','security_minister') and status not in ('rejected','withdrawn');

-- The channel, game and author must refer to the same scope in Storage and chat.
alter policy game_media_insert on storage.objects with check(
 bucket_id='game-media' and split_part(name,'/',3)=(select auth.uid())::text
 and private.can_access_channel(split_part(name,'/',2)::uuid)
 and exists(select 1 from public.chat_channels c where c.id=split_part(name,'/',2)::uuid and c.game_id=split_part(name,'/',1)::uuid)
 and not private.is_game_observer(split_part(name,'/',1)::uuid)
);
create policy chat_messages_media_scope on public.chat_messages as restrictive for all to authenticated
 using(true) with check(storage_path is null or (
  split_part(storage_path,'/',1)=game_id::text and split_part(storage_path,'/',2)=channel_id::text
  and split_part(storage_path,'/',3)=author_id::text and split_part(storage_path,'/',4)<>''
  and array_length(string_to_array(storage_path,'/'),1)=4
 ));
update storage.buckets set file_size_limit=25*1024*1024 where id='game-media' and (file_size_limit is null or file_size_limit>25*1024*1024);
-- UPDATE must validate the destination as strictly as INSERT.
alter policy game_assets_profile_update on storage.objects
 using(bucket_id='game-assets' and split_part(name,'/',2)='profiles' and split_part(name,'/',3)=(select auth.uid())::text
  and private.is_game_member(split_part(name,'/',1)::uuid) and not private.is_game_observer(split_part(name,'/',1)::uuid))
 with check(bucket_id='game-assets' and split_part(name,'/',2)='profiles' and split_part(name,'/',3)=(select auth.uid())::text
  and private.is_game_member(split_part(name,'/',1)::uuid) and not private.is_game_observer(split_part(name,'/',1)::uuid));
alter policy game_assets_party_update on storage.objects
 with check(bucket_id='game-assets' and split_part(name,'/',2)='parties' and private.is_game_member(split_part(name,'/',1)::uuid)
  and not private.is_game_observer(split_part(name,'/',1)::uuid)
  and (private.is_game_teacher(split_part(name,'/',1)::uuid) or exists(
   select 1 from public.game_parties gp join public.game_members gm on gm.game_id=gp.game_id and gm.team=gp.name
   where gp.id=split_part(name,'/',3)::uuid and gp.game_id=split_part(name,'/',1)::uuid and gm.user_id=(select auth.uid()))));
alter policy game_assets_municipal_insert on storage.objects with check(
 bucket_id='game-assets' and split_part(name,'/',2)='municipal' and private.is_game_member(split_part(name,'/',1)::uuid)
 and not private.is_game_observer(split_part(name,'/',1)::uuid)
 and exists(select 1 from public.municipal_projects p where p.id=split_part(name,'/',3)::uuid and p.game_id=split_part(name,'/',1)::uuid)
 and private.can_edit_municipal_project(split_part(name,'/',3)::uuid,(select auth.uid())));


-- Server-side allocation shares the UI's electorate and deterministic party order.
create or replace function private.largest_remainder_seats(p_values double precision[],p_seats integer,p_quota double precision)
returns integer[] language plpgsql immutable set search_path='public','private','pg_temp'
as $function$
declare n integer:=coalesce(array_length(p_values,1),0);result integer[]:=array_fill(0,array[n]);remainders double precision[]:=array_fill(-1::double precision,array[n]);i integer;leftover integer:=p_seats;best integer;q double precision;
begin
 if n=0 or p_quota<=0 then return result;end if;
 for i in 1..n loop
  q:=p_values[i]/p_quota;result[i]:=floor(q)::integer;leftover:=leftover-result[i];
  if p_values[i]>0 then remainders[i]:=q-floor(q);end if;
 end loop;
 for seat in 1..leftover loop
  best:=0;
  for i in 1..n loop
   if remainders[i]>=0 and (best=0 or remainders[i]>remainders[best]+1e-9) then best:=i;end if;
  end loop;
  if best=0 then raise exception 'Allocation remainder is inconsistent';end if;
  result[best]:=result[best]+1;remainders[best]:=-1;
 end loop;
 return result;
end;$function$;

create or replace function private.allocate_electoral_seats(p_weights double precision[],p_seats integer,p_method text)
returns integer[] language plpgsql immutable set search_path='public','private','pg_temp'
as $function$
declare n integer:=coalesce(array_length(p_weights,1),0);result integer[]:=array_fill(0,array[n]);scaled double precision[]:=p_weights;ballots integer[];maximum double precision:=0;total double precision:=0;q double precision;best_q double precision;best integer;i integer;divisor integer;
begin
 if p_seats=0 then return result;end if;
 if n=0 or p_seats not between 1 and 450 or p_method is null or p_method not in('hare','droop','dhondt','sainte_lague','imperiali') then raise exception 'Invalid electoral allocation';end if;
 for i in 1..n loop
  if p_weights[i] is null or p_weights[i]<0 or p_weights[i]>'1e300'::double precision then raise exception 'Invalid support';end if;
  maximum:=greatest(maximum,p_weights[i]);
 end loop;
 if maximum=0 then raise exception 'Positive support is required';end if;
 for i in 1..n loop scaled[i]:=p_weights[i]/maximum;total:=total+scaled[i];end loop;
 ballots:=private.largest_remainder_seats(scaled,100000000,total/100000000);
 if p_method='hare' then return private.largest_remainder_seats(ballots::double precision[],p_seats,100000000::double precision/p_seats);end if;
 if p_method='droop' then return private.largest_remainder_seats(ballots::double precision[],p_seats,floor(100000000::double precision/(p_seats+1))+1);end if;
 for seat in 1..p_seats loop
  best:=0;best_q:=-1;
  for i in 1..n loop
   if ballots[i]=0 then continue;end if;
   divisor:=case p_method when 'dhondt' then result[i]+1 when 'sainte_lague' then result[i]*2+1 else result[i]+2 end;
   q:=ballots[i]::double precision/divisor;
   if q>best_q+1.7763568394002505e-15*greatest(1,q,best_q) then best:=i;best_q:=q;end if;
  end loop;
  result[best]:=result[best]+1;
 end loop;
 return result;
end;$function$;

create or replace function private.valid_party_numbers(p_game uuid,p_values jsonb,p_limit numeric,p_integer boolean)
returns boolean language plpgsql stable security definer set search_path='public','private','pg_temp'
as $function$
declare r record;v numeric;
begin
 if p_values is null or jsonb_typeof(p_values)<>'object' then return false;end if;
 if (select count(*)from jsonb_object_keys(p_values))<>(select count(*)from public.game_parties where game_id=p_game) then return false;end if;
 for r in select key,value from jsonb_each(p_values) loop
  if jsonb_typeof(r.value)<>'number' or not exists(select 1 from public.game_parties where game_id=p_game and id::text=r.key) then return false;end if;
  v:=(r.value#>>'{}')::numeric;
  if v<0 or v>p_limit or (p_integer and v<>trunc(v)) then return false;end if;
 end loop;
 return exists(select 1 from public.game_parties where game_id=p_game);
end;$function$;
revoke all on function private.largest_remainder_seats(double precision[],integer,double precision) from public,anon,authenticated;
revoke all on function private.allocate_electoral_seats(double precision[],integer,text) from public,anon,authenticated;
revoke all on function private.valid_party_numbers(uuid,jsonb,numeric,boolean) from public,anon,authenticated;

create or replace function public.publish_electoral_calculator_result(p_game_id uuid,p_system_type text,p_allocation_method text,p_proportional_share integer,p_support jsonb,p_district_seats jsonb,p_result jsonb)
returns uuid language plpgsql security definer set search_path='public','private','pg_temp'
as $function$
declare v_id uuid;party_ids uuid[];weights double precision[];allocation integer[];pool integer;district_pool integer;total integer;i integer;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Сохранение расчёта доступно только преподавателю';end if;
 if p_system_type is null or p_system_type not in ('proportional','majoritarian','mixed') then raise exception 'Неизвестный тип избирательной системы';end if;
 if p_system_type<>'majoritarian' and (p_allocation_method is null or p_allocation_method not in ('hare','droop','dhondt','sainte_lague','imperiali')) then raise exception 'Неизвестная формула распределения';end if;
 if p_system_type='mixed' and (p_proportional_share is null or p_proportional_share not between 1 and 99) then raise exception 'Для смешанной системы задайте долю пропорциональной части';end if;
 perform 1 from public.games where id=p_game_id for update;
 if not private.valid_party_numbers(p_game_id,p_support,100,false) or not private.valid_party_numbers(p_game_id,p_district_seats,450,true) or not private.valid_party_numbers(p_game_id,p_result,450,true) then raise exception 'Расчёт должен содержать числовые значения для всех партий этой игры';end if;
 pool:=case p_system_type when 'proportional' then 450 when 'mixed' then round(450*p_proportional_share::numeric/100)::integer else 0 end;
 district_pool:=450-pool;
 select array_agg(id order by support desc,created_at,id),array_agg((p_support->>id::text)::double precision order by support desc,created_at,id)
 into party_ids,weights from public.game_parties where game_id=p_game_id;
 allocation:=private.allocate_electoral_seats(weights,pool,p_allocation_method);
 if district_pool>0 then
  select sum(value::integer)into total from jsonb_each_text(p_district_seats);
  if total<>district_pool then raise exception 'Сумма мажоритарных мест не соответствует выбранной системе';end if;
 end if;
 for i in 1..array_length(party_ids,1) loop
  if (p_result->>party_ids[i]::text)::integer<>allocation[i]+(case when district_pool>0 then(p_district_seats->>party_ids[i]::text)::integer else 0 end) then raise exception 'Итог не совпадает с рассчитанным распределением мандатов';end if;
 end loop;
 insert into public.electoral_calculator_results(game_id,created_by,system_type,allocation_method,proportional_share,support,district_seats,result)
 values(p_game_id,auth.uid(),p_system_type,case when p_system_type='majoritarian' then null else p_allocation_method end,case when p_system_type='mixed' then p_proportional_share else null end,p_support,p_district_seats,p_result) returning id into v_id;
 return v_id;
end;$function$;

create or replace function public.publish_regional_calculator_result(p_game_id uuid,p_method text,p_inputs jsonb,p_result jsonb)
returns uuid language plpgsql security definer set search_path='public','private','pg_temp'
as $function$
declare v_id uuid;v_total integer;party_ids uuid[];weights double precision[];allocation integer[];total double precision:=0;i integer;mandates jsonb;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Сохранение расчёта доступно только преподавателю';end if;
 if p_method is null or p_method not in('random','proportional','agreement') then raise exception 'Неизвестный метод распределения';end if;
 perform 1 from public.games where id=p_game_id for update;
 if p_inputs is null or jsonb_typeof(p_inputs)<>'object' or not private.valid_party_numbers(p_game_id,p_result,89,true) then raise exception 'Расчёт должен содержать неотрицательное целое число субъектов для всех партий этой игры';end if;
 select sum(value::integer)into v_total from jsonb_each_text(p_result);
 if v_total<>89 then raise exception 'Итог должен распределять ровно 89 субъектов; сейчас: %',v_total;end if;
 if p_method='agreement' and p_inputs->'agreement' is distinct from p_result then raise exception 'Итог должен совпадать с договорным распределением';end if;
 if p_method='proportional' then
  select jsonb_object_agg(id::text,greatest(0,mandates)),array_agg(id order by support desc,created_at,id),array_agg(greatest(0,mandates)::double precision order by support desc,created_at,id)
  into mandates,party_ids,weights from public.game_parties where game_id=p_game_id;
  if p_inputs->'mandates' is distinct from mandates then raise exception 'Обновите расчёт: распределение мандатов изменилось';end if;
  for i in 1..array_length(weights,1) loop total:=total+weights[i];end loop;
  if total<=0 then raise exception 'Сначала распределите мандаты Государственной Думы';end if;
  allocation:=private.largest_remainder_seats(weights,89,total/89);
  for i in 1..array_length(party_ids,1) loop
   if (p_result->>party_ids[i]::text)::integer<>allocation[i] then raise exception 'Итог не совпадает с пропорциональным распределением субъектов';end if;
  end loop;
 end if;
 insert into public.regional_calculator_results(game_id,created_by,method,inputs,result) values(p_game_id,auth.uid(),p_method,p_inputs,p_result) returning id into v_id;
 return v_id;
end;$function$;


-- Half-point penalties are retained rather than rounded away by integer storage.
-- Teacher final grades remain the established integer 0-3 rubric.
drop trigger trg_stage_assessment_deadline_penalty on public.stage_assessments;
alter table public.stage_assessments alter column auto_score type numeric using auto_score::numeric;
alter table public.stage_assessment_runs alter column auto_score type numeric using auto_score::numeric;
CREATE OR REPLACE FUNCTION private.stage_assessment_deadline_penalty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_penalty numeric:=0;
begin
  select coalesce(sum(i.penalty_points),0)
    into v_penalty
  from public.stage_deadline_incidents i
  where i.game_id=new.game_id
    and i.stage_no=new.stage_no
    and i.user_id=new.user_id
    and i.status='active';

  new.auto_score:=greatest(0,least(3,new.auto_score-v_penalty));
  new.evidence_summary:=coalesce(new.evidence_summary,'{}'::jsonb)
    || jsonb_build_object('deadline_penalty_points',v_penalty);
  return new;
end;
$function$
;
create trigger trg_stage_assessment_deadline_penalty before insert or update of auto_score on public.stage_assessments for each row execute function private.stage_assessment_deadline_penalty();

CREATE OR REPLACE FUNCTION private.compute_vsn_assessment(p_game uuid, p_user uuid, p_stage integer, p_run_type text DEFAULT 'hourly'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_start timestamptz; v_end timestamptz;
  v_existing public.stage_assessments%rowtype; v_id uuid;
  chat_count int:=0; post_count int:=0; ballot_count int:=0;
  formal_doc_count int:=0; formal_action_count int:=0; formal_ballot_count int:=0;
  player_action_count int:=0; party_action_count int:=0; party_response_count int:=0;
  party_document_count int:=0; game_document_count int:=0;
  decision_count int:=0; activity_count int:=0; debrief_count int:=0;
  legal_hits int:=0; strategy_hits int:=0; analysis_chat_hits int:=0;
  debrief_categories int:=0; debrief_text text:='';
  participation int:=0; law_signal numeric:=0; strategy_signal numeric:=0;
  c1 boolean:=false; c2 boolean:=false; c3 boolean:=false;
  adjusted_score numeric;
  score int:=0; rationale text; summary jsonb;
 event_law int:=0;event_invalid int:=0;event_strategy int:=0;
begin
  if p_stage<1 or p_stage>16 then raise exception 'Only stages 1-16 are assessed'; end if;

  select * into v_existing from public.stage_assessments
  where game_id=p_game and stage_no=p_stage and user_id=p_user for update;
  if v_existing.id is not null and v_existing.status='final' then return v_existing.id; end if;

  select w.start_at,w.end_at into v_start,v_end from private.vsn_stage_window(p_game,p_stage) w;
  if v_start is null then v_start:=now()-interval '30 days'; end if;
  if v_end is null or v_end<v_start then v_end:=now(); end if;

  select count(*)::int,
    count(*) filter(where lower(coalesce(text,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int,
    count(*) filter(where lower(coalesce(text,'')) ~ '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|голосуем|переговор)')::int,
    count(*) filter(where lower(coalesce(text,'')) ~ '(почему|потому|причин|обуслов|из-за)'
      and lower(coalesce(text,'')) ~ '(последств|результат|итог|повлиял|привел|интерес|выгод|потер|правил|институт|полномоч|процедур)')::int
  into chat_count,legal_hits,strategy_hits,analysis_chat_hits
  from public.chat_messages
  where game_id=p_game and author_id=p_user and created_at>=v_start and created_at<=v_end
    and (kind<>'text' or length(trim(coalesce(text,'')))>0);

  select count(*)::int,
    legal_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int,
    strategy_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|переговор)')::int
  into post_count,legal_hits,strategy_hits
  from public.political_posts
  where game_id=p_game and author_id=p_user and created_at>=v_start and created_at<=v_end
    and source_key is null and (context->>'automatic') is distinct from 'true';

  select count(*)::int,count(*) filter(where v.formal_document_id is not null)::int
  into ballot_count,formal_ballot_count
  from public.game_ballots b join public.game_votes v on v.id=b.vote_id
  where v.game_id=p_game and v.stage_no=p_stage and b.voter_id=p_user;

  select count(*)::int,
    legal_hits+count(*) filter(where lower(coalesce(d.title,'')||' '||coalesce(d.body_text,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int
  into formal_doc_count,legal_hits
  from public.formal_documents d
  where d.game_id=p_game and d.stage_no=p_stage and d.author_id=p_user;

  select count(*)::int into formal_action_count
  from public.formal_document_history h join public.formal_documents d on d.id=h.document_id
  where h.game_id=p_game and h.actor_id=p_user and d.stage_no=p_stage;

  select count(*)::int,
    strategy_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|переговор)')::int,
    legal_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int
  into player_action_count,strategy_hits,legal_hits
  from public.player_actions where game_id=p_game and round_no=p_stage and author_id=p_user;

  select count(*)::int,
    legal_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(конституц|закон|правов|норм|устав|положен|регламент|полномоч|процедур)')::int,
    strategy_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(стратег|интерес|цель|ресурс|риск|программ|план|предлага|коалиц|переговор)')::int
  into game_document_count,legal_hits,strategy_hits
  from public.game_documents
  where game_id=p_game and created_by=p_user and created_at>=v_start and created_at<=v_end;

  select count(*)::int into party_document_count
  from public.party_documents
  where game_id=p_game and uploaded_by=p_user and created_at>=v_start and created_at<=v_end;

  select count(*)::int into party_action_count
  from public.party_invitations
  where game_id=p_game and invited_by=p_user and created_at>=v_start and created_at<=v_end;

  select count(*)::int into party_response_count
  from public.party_invitations
  where game_id=p_game and invited_user_id=p_user and responded_at is not null
    and responded_at>=v_start and responded_at<=v_end;

  select count(*)::int into decision_count
  from public.political_decisions d join public.political_posts p on p.id=d.post_id
  where d.game_id=p_game and p.author_id=p_user and d.created_at>=v_start and d.created_at<=v_end
    and p.source_key is null and (p.context->>'automatic') is distinct from 'true';

  select count(*)::int into activity_count
  from public.game_activity
  where game_id=p_game and actor_id=p_user and created_at>=v_start and created_at<=v_end
    and event_type not in ('navigation','presence');

  select count(*)::int,coalesce(max(body),'') into debrief_count,debrief_text
  from public.stage_debriefs where game_id=p_game and stage_no=p_stage and user_id=p_user;

  if length(trim(debrief_text))>=80 then
    debrief_categories :=
      (case when lower(debrief_text) ~ '(почему|потому|причин|обуслов|из-за)' then 1 else 0 end)+
      (case when lower(debrief_text) ~ '(последств|результат|итог|повлиял|привел|выиграл|проиграл|потер)' then 1 else 0 end)+
      (case when lower(debrief_text) ~ '(интерес|выгод|цель|стратег|ресурс|риск)' then 1 else 0 end)+
      (case when lower(debrief_text) ~ '(правил|институт|полномоч|норм|закон|процедур|кворум)' then 1 else 0 end);
  end if;

  participation:=chat_count+post_count+ballot_count+formal_doc_count+formal_action_count+
    player_action_count+party_action_count+party_response_count+party_document_count+
    game_document_count+decision_count+activity_count+debrief_count;

  law_signal:=formal_doc_count*2+formal_action_count+formal_ballot_count*1.5+
    game_document_count*0.7+party_document_count*0.8+least(legal_hits,8)*0.5;
  strategy_signal:=post_count*0.75+ballot_count*0.5+player_action_count+decision_count*1.5+
    formal_doc_count+game_document_count*0.8+party_document_count*0.7+
    party_action_count*0.75+party_response_count*0.35+least(strategy_hits,8)*0.4;

  select count(*) filter(where authority_ok and lawful),count(*) filter(where not authority_ok or not lawful),count(*) filter(where strategy_point)
  into event_law,event_invalid,event_strategy from public.event_authority_evidence where game_id=p_game and actor_id=p_user and stage_no=p_stage;
  participation:=participation+event_law+event_invalid;
  c1:=(law_signal>=2 or event_law>0) and event_invalid=0;
  c2:=strategy_signal>=2 or event_strategy>0;
  c3:=(length(trim(debrief_text))>=80 and debrief_categories>=3) or analysis_chat_hits>=2;

  if participation=0 then score:=0;
  else score:=greatest(1,(case when c1 then 1 else 0 end)+(case when c2 then 1 else 0 end)+(case when c3 then 1 else 0 end)); end if;

  rationale:=
    'Критерий 1 · право и правила: '||(case when c1 then 'зачтён' else 'пока не подтверждён' end)||
    '. НПА '||formal_doc_count||', процедурных действий '||formal_action_count||
    ', голосований по НПА '||formal_ballot_count||', партийных документов '||party_document_count||
    ', иных документов '||game_document_count||', правовых упоминаний '||legal_hits||'. '||
    'Критерий 2 · стратегия и интересы: '||(case when c2 then 'зачтён' else 'пока не подтверждён' end)||
    '. Публикаций '||post_count||', голосований '||ballot_count||
    ', действий/решений '||(player_action_count+decision_count)||', партийных инициатив '||party_action_count||
    ', ответов на партийные приглашения '||party_response_count||'. '||
    'Критерий 3 · итоговый разбор: '||(case when c3 then 'зачтён' else 'пока не подтверждён' end)||
    '. Разбор '||(case when debrief_count>0 then 'представлен' else 'не представлен' end)||
    ', аналитических связок в обсуждении '||analysis_chat_hits||'. '||
    'Автооценка: '||score||'/3'||case score when 3 then ' — высокий уровень.' when 2 then ' — средний уровень.' when 1 then ' — низкий уровень.' else ' — участия на этапе не зафиксировано.' end;

  summary:=jsonb_build_object(
    'window',jsonb_build_object('from',v_start,'to',v_end),
    'counts',jsonb_build_object(
      'chat',chat_count,'posts',post_count,'ballots',ballot_count,
      'formal_documents',formal_doc_count,'formal_actions',formal_action_count,
      'player_actions',player_action_count,'party_invitations_sent',party_action_count,
      'party_invitation_responses',party_response_count,'party_documents',party_document_count,
      'game_documents',game_document_count,'accepted_decisions',decision_count,
      'meaningful_activity',activity_count,'debriefs',debrief_count
    ),
    'signals',jsonb_build_object(
      'law',law_signal,'strategy',strategy_signal,'legal_keyword_hits',legal_hits,
      'strategy_keyword_hits',strategy_hits,'analysis_chat_hits',analysis_chat_hits,
      'debrief_categories',debrief_categories
    )
  );

  if v_existing.id is null then
    insert into public.stage_assessments(
      game_id,stage_no,user_id,auto_score,status,criterion_law,criterion_strategy,criterion_debrief,
      public_rationale,evidence_summary,last_run_type,last_auto_at,revision_count
    ) values(p_game,p_stage,p_user,score,'draft',c1,c2,c3,rationale,summary,p_run_type,now(),1)
    returning id into v_id;
  else
    update public.stage_assessments
    set auto_score=score,criterion_law=c1,criterion_strategy=c2,criterion_debrief=c3,
      public_rationale=rationale,evidence_summary=summary,last_run_type=p_run_type,
      last_auto_at=now(),revision_count=revision_count+1,updated_at=now()
    where id=v_existing.id returning id into v_id;
  end if;

  -- Journal the stored score and evidence after the deadline trigger.
  select auto_score,evidence_summary into adjusted_score,summary from public.stage_assessments where id=v_id;

  insert into public.stage_assessment_runs(
    assessment_id,game_id,stage_no,user_id,run_type,auto_score,
    criterion_law,criterion_strategy,criterion_debrief,rationale,evidence_summary
  ) values(v_id,p_game,p_stage,p_user,p_run_type,adjusted_score,c1,c2,c3,rationale,summary);

  update public.stage_assessments set evidence_summary=evidence_summary||jsonb_build_object('event_authority',jsonb_build_object('valid',event_law,'invalid',event_invalid,'strategy',event_strategy)), public_rationale=public_rationale||E'\nСобытия: правомерных решений в пределах полномочий '||event_law||', нарушений '||event_invalid||'. Правовой критерий: '||case when c1 then '1 балл' else '0 баллов' end||'.' where id=v_id;
  return v_id;
end;
$function$
;
drop function public.get_public_stage_scores(uuid);
CREATE OR REPLACE FUNCTION public.get_public_stage_scores(p_game_id uuid)
 RETURNS TABLE(user_id uuid, stage_no integer, auto_score numeric, final_score integer, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
 if not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 return query select a.user_id,a.stage_no,a.auto_score,a.final_score,a.status
 from public.stage_assessments a where a.game_id=p_game_id
 order by a.user_id,a.stage_no;
end;
$function$
;
revoke all on function public.get_public_stage_scores(uuid) from public,anon;
grant execute on function public.get_public_stage_scores(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.open_presidential_system_vote(p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.presidential_system_proposals%rowtype;
begin
 select * into p from public.presidential_system_proposals where id=p_proposal_id;
 if p.id is null then raise exception 'Proposal not found';end if;
 if auth.uid() is null or not private.is_game_member(p.game_id) then raise exception 'Game access required';end if;
 if p.vote_id is not null then return p.vote_id; end if;
 raise exception 'Legacy proposal has no linked vote; create a new proposal in the stage 6 form';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.register_presidential_system_proposal(p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.presidential_system_proposals%rowtype;
begin
 select * into p from public.presidential_system_proposals where id=p_proposal_id;
 if p.id is null then raise exception 'Proposal not found';end if;
 if auth.uid() is null or not private.is_game_member(p.game_id) then raise exception 'Game access required';end if;
 if p.bill_document_id is not null then return p.bill_document_id; end if;
 raise exception 'Legacy proposal has no linked bill; create a new proposal in the stage 6 form';
end;
$function$
;

-- Keep the already-deployed withdrawal workflow in versioned source.
CREATE OR REPLACE FUNCTION public.withdraw_government_nomination(p_nomination_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 n public.government_nominations%rowtype;
begin
 select * into n
 from public.government_nominations
 where id=p_nomination_id
 for update;

 if n.id is null then raise exception 'Nomination not found'; end if;
 if not private.is_game_teacher(n.game_id) then raise exception 'Teacher access required'; end if;
 if n.status='appointed' then raise exception 'Appointed officeholder cannot be removed from the agenda'; end if;

 if n.vote_id is not null then
  update public.game_votes
  set status='closed',
      closed_at=coalesce(closed_at,now()),
      result_code='cancelled',
      result_label='Отменено преподавателем',
      decision_note='Кандидатура снята преподавателем.'
  where id=n.vote_id and status<>'closed';
 end if;

 if n.formal_document_id is not null then
  update public.formal_documents
  set status_code='withdrawn',
      status_label='Кандидатура снята',
      current_owner_key='system',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'withdrawn',true,
        'withdrawn_at',now()::text
      ),
      updated_at=now()
  where id=n.formal_document_id;
 end if;

 update public.government_nominations
 set status='withdrawn',
     office_key='withdrawn:'||n.id::text||':'||n.office_key,
     note=trim(both from concat_ws(E'
',nullif(note,''),'Кандидатура снята преподавателем.')),
     updated_at=now(),
     decided_at=coalesce(decided_at,now())
 where id=n.id;
end;
$function$
;
