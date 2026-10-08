-- Committees are formed at the first Duma meeting (stage 4).
-- Stage 9 only staffs ministries whose structure and ministers come from stage 8.
create or replace function private.can_manage_duma_committees(p_game uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select p_user is not null and private.is_game_member(p_game) and (
  private.is_game_teacher(p_game)
  or coalesce(private.game_role(p_game,p_user),'') like '%председател%дум%'
  or coalesce(private.game_role(p_game,p_user),'') like '%совет%дум%'
  or exists(select 1 from public.game_office_assignments a
    where a.game_id=p_game and a.user_id=p_user and a.status='active'
      and (lower(a.role_title) like '%председател%дум%' or lower(a.role_title) like '%совет%дум%'))
 );
$$;
revoke all on function private.can_manage_duma_committees(uuid,uuid) from public,anon,authenticated;

create or replace function public.ensure_duma_committees(p_game_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if not private.can_manage_duma_committees(p_game_id,(select auth.uid())) then
  raise exception 'State Duma chair / Council / teacher access required';
 end if;
 insert into public.institution_units(game_id,unit_kind,unit_key,title,description,mandate_capacity)
 values
 (p_game_id,'committee','social','Комитет по социальной политике','Труд, демография, культура, образование, здравоохранение и смежные вопросы',90),
 (p_game_id,'committee','economic','Комитет по экономической политике','Финансы, налоги, транспорт, энергетика и смежные вопросы',90),
 (p_game_id,'committee','defence','Комитет по обороне и безопасности','Оборона и безопасность',90),
 (p_game_id,'committee','foreign','Комитет по внешней политике','Внешняя политика и международные отношения',90),
 (p_game_id,'committee','internal','Комитет по внутренней политике и государству','ОГВ, ОМС, национальности, гражданское общество, НКО и смежные вопросы',90)
 on conflict(game_id,unit_kind,unit_key) do nothing;
end;$$;
revoke all on function public.ensure_duma_committees(uuid) from public,anon;
grant execute on function public.ensure_duma_committees(uuid) to authenticated;

create or replace function public.ensure_stage9_units(p_game_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.government_structures%rowtype;
begin
 if (select auth.uid()) is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 select * into s from public.government_structures where game_id=p_game_id and status='approved';
 if not found then return;end if;
 insert into public.institution_units(game_id,unit_kind,unit_key,title,description,capacity_min,capacity_max)
 values
 (p_game_id,'ministry','social',s.social_title,'Труд, демография, культура, образование, здравоохранение и смежные вопросы',3,5),
 (p_game_id,'ministry','economic',s.economic_title,'Финансы, налоги, транспорт, энергетика и смежные вопросы',3,5),
 (p_game_id,'ministry','defence',s.defence_title,'Оборона и внутренняя безопасность',3,5),
 (p_game_id,'ministry','foreign',s.foreign_title,'Внешняя политика',3,5),
 (p_game_id,'ministry','internal',s.internal_title,'ОГВ, ОМС, национальности, гражданское общество, НКО и смежные вопросы',3,5)
 on conflict(game_id,unit_kind,unit_key) do update set title=excluded.title
 where public.institution_units.title is distinct from excluded.title;
 update public.institution_units set capacity_min=3,capacity_max=5
 where game_id=p_game_id and unit_kind='ministry' and capacity_min is null;
 update public.institution_units u set head_user_id=n.candidate_user_id
 from public.government_nominations n
 where u.game_id=p_game_id and u.unit_kind='ministry' and n.game_id=p_game_id
  and n.stage_no=8 and n.status='appointed' and n.office_key='ministry_'||u.unit_key
  and n.candidate_user_id is not null and u.head_user_id is distinct from n.candidate_user_id;
 insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
 select u.game_id,u.id,'ministry',n.candidate_user_id,null,'head',n.nominated_by
 from public.institution_units u join public.government_nominations n
  on n.game_id=u.game_id and n.office_key='ministry_'||u.unit_key and n.stage_no=8 and n.status='appointed'
 where u.game_id=p_game_id and u.unit_kind='ministry' and n.candidate_user_id is not null
 on conflict(game_id,user_id,unit_kind) do update
 set unit_id=excluded.unit_id,assignment_role='head',party_id=null
 where public.institution_assignments.unit_id is distinct from excluded.unit_id
    or public.institution_assignments.assignment_role is distinct from 'head'
    or public.institution_assignments.party_id is not null;
end;$$;
revoke all on function public.ensure_stage9_units(uuid) from public,anon;
grant execute on function public.ensure_stage9_units(uuid) to authenticated;

create or replace function public.create_committee_chair_election(p_unit_id uuid,p_vote_mode text default 'open')
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;v_key text;
begin
 select * into u from public.institution_units where id=p_unit_id for update;
 if u.id is null or u.unit_kind<>'committee' then raise exception 'Committee not found';end if;
 if not private.can_manage_duma_committees(u.game_id,v_uid) then raise exception 'State Duma chair / Council / teacher access required';end if;
 if p_vote_mode is null or p_vote_mode not in ('open','secret') then raise exception 'Unsupported vote mode';end if;
 v_key:='committee:'||u.id::text;
 if exists(select 1 from public.office_elections where game_id=u.game_id and office_key=v_key and status in ('nomination','open'))
 then raise exception 'An active chair election already exists for this committee';end if;
 insert into public.office_elections(game_id,stage_no,office_key,office_title,round_no,vote_mode,status,created_by)
 values(u.game_id,4,v_key,'Председатель · '||u.title,1,p_vote_mode,'nomination',v_uid) returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.create_committee_chair_election(uuid,text) from public,anon;
grant execute on function public.create_committee_chair_election(uuid,text) to authenticated;

-- Reclassify existing election records without changing candidates, ballots or outcomes.
update public.office_elections set stage_no=4 where stage_no=9 and office_key like 'committee:%';

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
     where n.game_id=u.game_id and n.stage_no=8 and n.office_key='ministry_'||u.unit_key
       and n.status='appointed' and n.candidate_user_id=p_user_id)
   then raise exception 'Minister must already be appointed through stage 8';end if;
   if not private.is_game_teacher(u.game_id) and v_role not like '%председател%правительств%' and v_role not like '%президент%'
   then raise exception 'Prime Minister / President / teacher access required'; end if;
 end if;
 update public.institution_units set head_user_id=p_user_id where id=u.id;
 if u.unit_kind='ministry' then
   insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
   values(u.game_id,u.id,'ministry',p_user_id,null,'head',v_uid)
   on conflict(game_id,user_id,unit_kind) do update set unit_id=excluded.unit_id,assignment_role='head',created_by=v_uid,created_at=now();
 else
   insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
   values(u.game_id,u.id,'committee',p_user_id,private.member_party_id(u.game_id,p_user_id),'head',v_uid)
   on conflict(game_id,user_id,unit_kind) do update set unit_id=excluded.unit_id,party_id=excluded.party_id,assignment_role='head',created_by=v_uid,created_at=now();
 end if;
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
  select count(*) into c from public.presidential_candidates where game_id=p_game and registration_status='registered';
  select count(*) into c2 from public.presidential_candidates where game_id=p_game and registration_status in ('submitted','revision');
  m:=jsonb_build_object('registered_candidates',c,'pending_candidates',c2);
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
  select count(*) into n from public.government_nominations where game_id=p_game and stage_no=8 and office_key like 'ministry_%' and status='appointed';
  m:=jsonb_build_object(
   'prime_minister_appointed',c,'structure_approved',c2,'central_bank_chair_appointed',c3,'ministers_appointed',n,
   'special_ministers',(select count(*) from public.government_nominations where game_id=p_game and stage_no=8 and office_kind='security_minister' and status='appointed'),
   'deputy_pm',(select count(*) from public.government_nominations where game_id=p_game and stage_no=8 and office_kind='deputy_pm' and status='appointed')
  );
  if c=0 then b:=b||jsonb_build_array('Председатель Правительства ещё не назначен'); end if;
  if c2=0 then b:=b||jsonb_build_array('Президент не одобрил структуру из пяти министерств'); end if;
  if c3=0 then b:=b||jsonb_build_array('Не завершено назначение Председателя Банка России решением Государственной Думы'); end if;
  if n<5 then b:=b||jsonb_build_array('Назначены руководители не всех пяти игровых министерств'); end if;
  if (select count(*) from public.government_nominations where game_id=p_game and stage_no=8 and office_kind='security_minister' and status='appointed')<2
  then b:=b||jsonb_build_array('Не назначены оба специальных министра после консультаций с Советом Федерации'); end if;
  if (select count(*) from public.government_nominations where game_id=p_game and stage_no=8 and office_kind='deputy_pm' and status='appointed')<1
  then b:=b||jsonb_build_array('Не назначен заместитель Председателя Правительства'); end if;
  if exists(select 1 from public.government_nominations where game_id=p_game and stage_no=8 and status not in ('appointed','withdrawn','rejected'))
  then w:=w||jsonb_build_array('Есть незавершённые кадровые процедуры Правительства'); end if;
 elsif p_stage=9 then
  select count(*) into c from public.institution_units where game_id=p_game and unit_kind='ministry';
  select count(*) into c2 from public.institution_assignments where game_id=p_game and unit_kind='ministry';
  select count(*) into c3 from public.game_members gm where gm.game_id=p_game and gm.kind='student'
   and not exists(select 1 from public.institution_assignments a where a.game_id=p_game and a.user_id=gm.user_id and a.unit_kind='ministry');
  m:=jsonb_build_object('ministries',c,'ministry_members',c2,'unassigned_students',c3);
  if c<5 then b:=b||jsonb_build_array('Сначала утвердите структуру Правительства на этапе 8');end if;
  if exists(select 1 from public.institution_units u where u.game_id=p_game and u.unit_kind='ministry' and u.head_user_id is null)
  then b:=b||jsonb_build_array('Завершите назначения министров на этапе 8');end if;
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
   where gm.game_id=p_game and gm.kind='student'
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
  select count(*) into c from public.game_members where game_id=p_game and kind='student';
  select count(*) into c3 from (select user_id from public.game_reflections where game_id=p_game and status in ('submitted','reviewed') group by user_id having count(distinct phase_key)>=6) q;
  m:=jsonb_build_object('students',c,'students_completed_reflection',c3);
  if c=0 then b:=b||jsonb_build_array('В игре нет студентов, для которых можно провести итоговую рефлексию');
  elsif c3<c then b:=b||jsonb_build_array('Не все студенты сдали рефлексию по шести фазам игры'); end if;
  if exists(select 1 from public.game_reflections where game_id=p_game and status='submitted') then w:=w||jsonb_build_array('Есть сданные рефлексии, которые преподаватель ещё не разобрал'); end if;
 end if;
 return jsonb_build_object('stage_no',p_stage,'ready',jsonb_array_length(b)=0,'blockers',b,'warnings',w,'metrics',m);
end;
$function$
;


update public.game_stages set title='Первое заседание Государственной Думы',
 summary='Избрать руководство ГД, создать пять комитетов, распределить депутатов и избрать председателей комитетов.'
 where stage_no=4;
update public.game_stages set title='Комплектование министерств',
 summary='Министры, назначенные на этапе 8, набирают сотрудников и формируют команды пяти ведомств.'
 where stage_no=9;

CREATE OR REPLACE FUNCTION public.create_game_session(p_title text, p_game_code text, p_teacher_code text, p_student_code text, p_teacher_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 g uuid;
 c uuid;
begin
 if (select auth.uid()) is null then
   raise exception 'Authentication required';
 end if;
 if coalesce(trim(p_title),'') = '' or coalesce(trim(p_game_code),'') = '' then
   raise exception 'Title and game code are required';
 end if;
 if char_length(p_teacher_code) < 4 or char_length(p_student_code) < 4 then
   raise exception 'Invite codes must be at least 4 characters';
 end if;
 if p_teacher_code = p_student_code then
   raise exception 'Teacher and student codes must be different';
 end if;

 insert into public.games(title,game_code,owner_id,status)
 values(trim(p_title),upper(trim(p_game_code)),(select auth.uid()),'lobby')
 returning id into g;

 insert into public.game_members(game_id,user_id,full_name,kind,role_title)
 values(g,(select auth.uid()),trim(p_teacher_name),'teacher','Руководитель симуляции');

 insert into public.invite_codes(game_id,code_hash,kind) values
 (g,extensions.crypt(p_teacher_code,extensions.gen_salt('bf')),'teacher'),
 (g,extensions.crypt(p_student_code,extensions.gen_salt('bf')),'student');

 insert into public.state_metrics(game_id,metric_key,label,value,unit) values
 (g,'legitimacy','Легитимность',67,'%'),
 (g,'economy','Экономика',54,'%'),
 (g,'budget','Бюджет',742,'млн'),
 (g,'social_tension','Социальное напряжение',41,'%'),
 (g,'security','Безопасность',73,'%');

 insert into public.chat_channels(game_id,name,kind,created_by)
 values(g,'Общий штаб','public',(select auth.uid()))
 returning id into c;

 insert into public.rounds(game_id,round_no,status) values(g,1,'planned');

 insert into public.game_stages(game_id,stage_no,title,mode,summary,status) values
 (g,1,'Создание партий','Заочный','Учредительный съезд: название, идеология, программа минимум из 10 пунктов, символика, председатель и пакет документов для регистрации.','open'),
 (g,2,'Тип избирательной системы','Заочный','Определить тип системы выборов в ГД и электоральную формулу; позиции фракций, переговоры и голосование простым большинством.','locked'),
 (g,3,'Выборы в субъектах РФ','Заочный','Определить способ распределения контроля над региональными парламентами: случайный, пропорциональный или договорной.','locked'),
 (g,4,'Первое заседание Государственной Думы','Заочный / очный','Избрать руководство ГД, создать пять комитетов, распределить депутатов и избрать председателей комитетов.','locked'),
 (g,5,'Ghost voting','Заочный / очный','Определить режим ghost voting и разыгрывать отсутствие 25–50 депутатов перед соответствующими заседаниями.','locked'),
 (g,6,'Кандидаты в Президенты РФ','Заочный','Выдвижение кандидатов, политические программы и регистрационные документы в ЦИК.','locked'),
 (g,7,'Выборы Президента','Заочный / очный','Определить тип мажоритарной системы, провести кампанию, голосование и при необходимости второй тур, затем инаугурацию.','locked'),
 (g,8,'Правительство','Заочный / очный','Представление и утверждение Председателя Правительства, министров и Председателя Банка России; формирование структуры Правительства.','locked'),
 (g,9,'Комплектование министерств','Заочный / очный','Министры, назначенные на этапе 8, набирают сотрудников и формируют команды пяти ведомств.','locked'),
 (g,10,'Разработка государственных программ','Заочный / очный','Министерства разрабатывают государственные программы по своим направлениям под руководством министров.','locked'),
 (g,11,'Представление государственных программ','Очный / заочный','Представить государственные программы на заседании Правительства и принять решения по ним.','locked'),
 (g,12,'Разработка законопроектов','Заочный / очный','Моделирование законодательного процесса: инициатива, законопроект, обсуждение, голосование и оформление решений.','locked'),
 (g,13,'Бюджетное правило и федеральный бюджет','Заочный / очный','Банк России и Правительство моделируют бюджетное правило, макропрогноз, доходы, расходы, дефицит и проект федерального бюджета.','locked'),
 (g,14,'Местное самоуправление','Заочный / очный','Работа муниципальных органов Барнаула: глава города, районные администрации, исследование территории и проектные решения.','locked'),
 (g,15,'Кризис / конфликт в государственном управлении','Заочный','Преподаватель в любой момент разыгрывает кризисное, конфликтное или чрезвычайное событие и оценивает реакцию должностных лиц.','locked'),
 (g,16,'Обсуждение деловой игры','Очный','Итоговая рефлексия: анализ решений, эффективности, логики действий и предложения по улучшению игры.','locked');

 insert into public.audit_log(game_id,actor_id,action,entity_type,entity_id,payload)
 values(g,(select auth.uid()),'game_created','game',g,jsonb_build_object('title',trim(p_title)));

 return g;
end
$function$
;
