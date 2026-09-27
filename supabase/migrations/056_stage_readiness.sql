-- Cross-stage readiness diagnostics. Does not block the teacher; it exposes unfinished core procedures and warnings.
create or replace function private.stage_readiness_json(p_game uuid,p_stage integer)
returns jsonb
language plpgsql stable security definer
set search_path=public,private,pg_temp
as $$
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
  select count(*) into c from public.institution_units where game_id=p_game and unit_kind='committee';
  select count(*) into c2 from public.institution_units where game_id=p_game and unit_kind='ministry';
  select count(*) into c3 from public.institution_units where game_id=p_game and head_user_id is not null;
  m:=jsonb_build_object('committees',c,'ministries',c2,'heads',c3);
  if c<5 or c2<5 then b:=b||jsonb_build_array('Не создан полный набор из 5 комитетов ГД и 5 министерств'); end if;
  if c>=5 and (select count(*) from public.institution_units where game_id=p_game and unit_kind='committee' and head_user_id is not null)<5 then b:=b||jsonb_build_array('Не избраны председатели всех пяти комитетов ГД'); end if;
  if c2>=5 and (select count(*) from public.institution_units where game_id=p_game and unit_kind='ministry' and head_user_id is not null)<5 then b:=b||jsonb_build_array('Не определены руководители всех пяти министерств'); end if;
  if exists(select 1 from public.institution_units u where u.game_id=p_game and not exists(select 1 from public.institution_assignments a where a.unit_id=u.id)) then b:=b||jsonb_build_array('Есть комитеты или министерства без участников'); end if;
  if exists(select 1 from public.institution_units u where u.game_id=p_game and u.unit_kind='ministry' and (select count(*) from public.institution_assignments a where a.unit_id=u.id) not between coalesce(u.capacity_min,3) and coalesce(u.capacity_max,5)) then w:=w||jsonb_build_array('Численность некоторых министерств выходит за ориентир 3–5 человек; это допустимо при ином размере учебной группы'); end if;
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
  m:=jsonb_build_object('closed_sessions',c,'unresolved_programs',c2);
  if c=0 then b:=b||jsonb_build_array('Не закрыто ни одного заседания Правительства по государственным программам'); end if;
  if c2>0 then b:=b||jsonb_build_array('Не по всем государственным программам принято итоговое решение Правительства'); end if;
 elsif p_stage=12 then
  select count(*) into c from public.formal_documents where game_id=p_game and stage_no=12 and workflow_key in ('bill','gd_resolution');
  select count(*) into c2 from public.duma_sessions where game_id=p_game and stage_no=12 and status='closed';
  m:=jsonb_build_object('legislative_documents',c,'closed_duma_sessions',c2);
  if c=0 then b:=b||jsonb_build_array('В реестре НПА нет законопроекта или постановления, созданного на этапе 12'); end if;
  if c2=0 then b:=b||jsonb_build_array('Не завершено ни одного заседания Государственной Думы с законодательной повесткой'); end if;
  if exists(select 1 from public.duma_sessions where game_id=p_game and stage_no=12 and status='open') then w:=w||jsonb_build_array('Сейчас открыто заседание ГД; завершите или осознанно перенесите остаток повестки'); end if;
 elsif p_stage=13 then
  select count(*) into c from public.budget_scenarios where game_id=p_game and stage_no=13 and status='final';
  select count(*) into c2 from public.budget_scenarios where game_id=p_game and stage_no=13 and status='final' and formal_document_id is not null;
  m:=jsonb_build_object('final_scenarios',c,'budget_bills',c2);
  if c=0 then b:=b||jsonb_build_array('Не зафиксирован итоговый бюджетный сценарий'); end if;
  if c2=0 then b:=b||jsonb_build_array('Из финального сценария не создан проект федерального бюджета в реестре НПА'); end if;
  if exists(select 1 from public.budget_scenarios s join public.formal_documents d on d.id=s.formal_document_id where s.game_id=p_game and s.stage_no=13 and s.status='final' and d.status_code not in ('published','signed','adopted')) then w:=w||jsonb_build_array('Проект федерального бюджета ещё проходит формальную законодательную процедуру'); end if;
 elsif p_stage=14 then
  select count(*) into c from public.municipal_projects where game_id=p_game and stage_no=14;
  select count(*) into c2 from public.municipal_projects where game_id=p_game and stage_no=14 and status in ('submitted','vote_open','adopted','rejected');
  m:=jsonb_build_object('projects',c,'submitted_or_decided',c2);
  if c=0 then b:=b||jsonb_build_array('Не создан ни один муниципальный полевой проект'); end if;
  if c>0 and c2=0 then b:=b||jsonb_build_array('Ни один муниципальный проект не передан на защиту или принятие решения'); end if;
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
$$;
revoke execute on function private.stage_readiness_json(uuid,integer) from public,anon,authenticated;
create or replace function public.get_stage_readiness(p_game_id uuid,p_stage_no integer)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if p_stage_no<1 or p_stage_no>16 then raise exception 'Stage number must be 1-16'; end if;
 return private.stage_readiness_json(p_game_id,p_stage_no);
end;$$;
revoke all on function public.get_stage_readiness(uuid,integer) from public,anon;
grant execute on function public.get_stage_readiness(uuid,integer) to authenticated;
create or replace function public.get_game_readiness(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v jsonb:='[]'::jsonb;i integer;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 for i in 1..16 loop v:=v||jsonb_build_array(private.stage_readiness_json(p_game_id,i)); end loop;
 return v;
end;$$;
revoke all on function public.get_game_readiness(uuid) from public,anon;
grant execute on function public.get_game_readiness(uuid) to authenticated;