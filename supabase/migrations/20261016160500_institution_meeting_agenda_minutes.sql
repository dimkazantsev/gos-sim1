-- A prepared and approved numbered agenda is required before new institutional meeting registrations.
-- Minutes are a separate formal document after the session. Historic attendance is preserved.
create table if not exists public.institution_meeting_records(
 game_id uuid not null references public.games(id) on delete cascade,
 stage_no integer not null check(stage_no between 1 and 16),
 institution_key text not null,
 agenda_document_id uuid references public.formal_documents(id) on delete set null,
 agenda_body text,
 agenda_prepared_by uuid,
 agenda_approved_by uuid,
 agenda_approved_at timestamptz,
 minutes_document_id uuid references public.formal_documents(id) on delete set null,
 minutes_body text,
 minutes_prepared_by uuid,
 minutes_saved_at timestamptz,
 minutes_approved_at timestamptz,
 minutes_approved_by uuid,
 delegate_user_id uuid,
 updated_at timestamptz not null default now(),
 primary key(game_id,stage_no,institution_key)
);
create index if not exists meeting_records_game_stage on public.institution_meeting_records(game_id,stage_no);
alter table public.institution_meeting_records enable row level security;
revoke all on public.institution_meeting_records from public,anon,authenticated;
grant select on public.institution_meeting_records to authenticated;
drop policy if exists meeting_records_authorised_read on public.institution_meeting_records;
create policy meeting_records_authorised_read on public.institution_meeting_records
 for select to authenticated using(
  private.is_game_teacher(game_id) or private.vote_member_has_office(game_id,(select auth.uid()),institution_key)
 );

create or replace function private.can_coordinate_institution_meeting(p_game uuid,p_institution text,p_uid uuid)
returns boolean language plpgsql stable security definer set search_path=public,private,pg_temp as $$
begin
 if p_uid is null then return false;end if;
 if private.is_game_teacher(p_game) then return true;end if;
 if p_institution='ksrf' then return private.party_led_by(p_game,p_uid) is not null;end if;
 if p_institution='gd' and private.can_manage_duma_session(p_game,p_uid) then return true;end if;
 if exists(select 1 from public.institution_units u
  where u.game_id=p_game and 'unit:'||u.id::text=p_institution and u.head_user_id=p_uid) then return true;end if;
 return exists(
  select 1 from public.game_office_assignments o
  where o.game_id=p_game and o.user_id=p_uid and o.status='active'
    and o.role_title ~* 'председател|руководител|глава|директор'
    and private.role_matches_voting_body(o.role_title,p_institution)
 );
end;$$;
revoke all on function private.can_coordinate_institution_meeting(uuid,text,uuid) from public,anon,authenticated;

create or replace function public.save_institution_meeting_document(
 p_game_id uuid,p_stage_no integer,p_institution text,p_kind text,p_body text,
 p_delegate_user_id uuid default null
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare uid uuid:=auth.uid();m public.institution_meeting_records%rowtype;
 v_manager boolean;v_doc uuid;v_subject text;v_steps jsonb;v_title text;v_reg text;
begin
 if uid is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 if p_stage_no not between 1 and 16 or not exists(
   select 1 from public.game_stages where game_id=p_game_id and stage_no=p_stage_no
 ) then raise exception 'Этап не найден';end if;
 if p_kind not in ('agenda','minutes') then raise exception 'Неизвестный вид документа';end if;
 if length(btrim(coalesce(p_body,'')))<30 then raise exception 'Заполните содержание документа (не менее 30 символов)';end if;
 if p_institution not in ('ksrf','gd','government','municipality','sf','committee','region','cec','ks','vs','central_bank','accounts')
 and not exists(select 1 from public.institution_units where game_id=p_game_id and 'unit:'||id::text=p_institution)
 then raise exception 'Орган не найден';end if;
 v_manager:=private.can_coordinate_institution_meeting(p_game_id,p_institution,uid);
 insert into public.institution_meeting_records(game_id,stage_no,institution_key)
 values(p_game_id,p_stage_no,p_institution) on conflict do nothing;
 select * into m from public.institution_meeting_records
 where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution for update;
 if not v_manager and m.delegate_user_id is distinct from uid then
  raise exception 'Повестку и протокол готовит председатель или назначенный им участник';end if;
 if not v_manager and p_delegate_user_id is not null then
  raise exception 'Поручить подготовку вправе председатель';end if;
 if p_delegate_user_id is not null and not private.vote_member_has_office(p_game_id,p_delegate_user_id,p_institution) then
  raise exception 'Исполнитель должен иметь действующее назначение в этом органе';end if;
 if p_kind='agenda' then
  if exists(select 1 from public.institution_session_registrations where game_id=p_game_id
    and stage_no=p_stage_no and institution_key=p_institution) then
   raise exception 'После начала регистрации повестку менять нельзя';end if;
  v_doc:=m.agenda_document_id;
  v_title:='Повестка заседания · '||p_institution||' · этап '||p_stage_no;
 else
  if not exists(select 1 from public.institution_session_registrations where game_id=p_game_id
    and stage_no=p_stage_no and institution_key=p_institution) then
   raise exception 'Протокол оформляется после регистрации участников заседания';end if;
  if exists(select 1 from public.game_votes where game_id=p_game_id and stage_no=p_stage_no
    and institution_key=p_institution and status='open') then
   raise exception 'Сначала завершите все голосования заседания';end if;
  v_doc:=m.minutes_document_id;
  v_title:='Протокол заседания · '||p_institution||' · этап '||p_stage_no;
 end if;
 v_subject:=case when p_institution='government' then 'government'
                 when p_institution like 'unit:%' then 'gd' else p_institution end;
 if v_doc is null then
  v_doc:=gen_random_uuid();
  v_reg:='ИГРА-ЗАС-'||lpad(nextval('public.formal_registry_seq')::text,6,'0');
  v_steps:=private.formal_workflow(case when p_institution='government' then 'government_act' else 'gd_resolution' end);
  insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,
   subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,
   current_step,status_code,status_label,current_owner_key,metadata)
  values(v_doc,p_game_id,p_stage_no,v_reg,v_title,
    case when p_kind='agenda' then 'meeting_agenda' else 'minutes' end,
    v_subject,p_institution,uid,btrim(p_body),
    case when p_institution='government' then 'government_act' else 'gd_resolution' end,
    v_steps,0,'draft',
    case when p_kind='agenda' then 'Проект повестки' else 'Протокол подготовлен' end,
    v_subject,jsonb_build_object('document_kind','institution_meeting_'||p_kind,
      'institution_key',p_institution,'stage_no',p_stage_no));
 else
  update public.formal_documents set body_text=btrim(p_body),updated_at=now()
  where id=v_doc and game_id=p_game_id;
 end if;
 if p_kind='agenda' then
  update public.institution_meeting_records set agenda_document_id=v_doc,
   agenda_body=btrim(p_body),agenda_prepared_by=uid,
   agenda_approved_by=case when v_manager then uid else null end,
   agenda_approved_at=case when v_manager then now() else null end,
   delegate_user_id=coalesce(p_delegate_user_id,delegate_user_id),updated_at=now()
   where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution;
  if v_manager then
   update public.formal_documents set status_code='published',status_label='Повестка утверждена',
    current_owner_key='system',updated_at=now() where id=v_doc;
  end if;
 else
  update public.institution_meeting_records set minutes_document_id=v_doc,
   minutes_body=btrim(p_body),minutes_prepared_by=uid,minutes_saved_at=now(),
   minutes_approved_by=case when v_manager then uid else null end,
   minutes_approved_at=case when v_manager then now() else null end,updated_at=now() where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution;
  update public.formal_documents set status_code=case when v_manager then 'published' else 'draft' end,
   status_label=case when v_manager then 'Протокол утверждён' else 'Проект протокола' end,
   current_owner_key=case when v_manager then 'system' else v_subject end,updated_at=now() where id=v_doc;
 end if;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 values(v_doc,p_game_id,uid,case when p_kind='agenda' then 'Подготовлена повестка заседания' else 'Составлен протокол заседания' end,
  case when not v_manager then 'draft' else 'published' end,
  case when v_manager then 'system' else v_subject end,'Этап '||p_stage_no||', орган '||p_institution);
 return v_doc;
end;$$;
revoke all on function public.save_institution_meeting_document(uuid,integer,text,text,text,uuid) from public,anon;
grant execute on function public.save_institution_meeting_document(uuid,integer,text,text,text,uuid) to authenticated;

create or replace function public.approve_institution_meeting_agenda(p_game_id uuid,p_stage_no integer,p_institution text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare uid uuid:=auth.uid();m public.institution_meeting_records%rowtype;
begin
 if uid is null or not private.can_coordinate_institution_meeting(p_game_id,p_institution,uid) then
  raise exception 'Утвердить повестку может только председатель или преподаватель';end if;
 select * into m from public.institution_meeting_records
 where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution for update;
 if m.agenda_document_id is null or length(btrim(coalesce(m.agenda_body,'')))<30 then
  raise exception 'Сначала подготовьте повестку заседания';end if;
 update public.institution_meeting_records set agenda_approved_by=uid,agenda_approved_at=now(),updated_at=now()
 where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution;
 update public.formal_documents set status_code='published',status_label='Повестка утверждена',
 current_owner_key='system',updated_at=now() where id=m.agenda_document_id;
end;$$;
revoke all on function public.approve_institution_meeting_agenda(uuid,integer,text) from public,anon;
grant execute on function public.approve_institution_meeting_agenda(uuid,integer,text) to authenticated;

-- A coordinator may entrust preparation to a member even after the agenda was approved.
create or replace function public.assign_institution_meeting_secretary(p_game_id uuid,p_stage_no integer,p_institution text,p_delegate uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $
declare uid uuid:=auth.uid();
begin
 if uid is null or not private.can_coordinate_institution_meeting(p_game_id,p_institution,uid) then
  raise exception 'Назначение исполнителя доступно только председателю';end if;
 if p_delegate is not null and not private.vote_member_has_office(p_game_id,p_delegate,p_institution) then
  raise exception 'Исполнитель не входит в состав органа';end if;
 insert into public.institution_meeting_records(game_id,stage_no,institution_key,delegate_user_id)
 values(p_game_id,p_stage_no,p_institution,p_delegate)
 on conflict(game_id,stage_no,institution_key) do update set
 delegate_user_id=excluded.delegate_user_id,updated_at=now();
end;$;
revoke all on function public.assign_institution_meeting_secretary(uuid,integer,text,uuid) from public,anon;
grant execute on function public.assign_institution_meeting_secretary(uuid,integer,text,uuid) to authenticated;

create or replace function public.approve_institution_meeting_minutes(p_game_id uuid,p_stage_no integer,p_institution text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $
declare uid uuid:=auth.uid();m public.institution_meeting_records%rowtype;
begin
 if uid is null or not private.can_coordinate_institution_meeting(p_game_id,p_institution,uid) then
  raise exception 'Утвердить протокол может только председатель или преподаватель';end if;
 select * into m from public.institution_meeting_records
 where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution for update;
 if m.minutes_document_id is null or length(btrim(coalesce(m.minutes_body,'')))<30 then
  raise exception 'Сначала подготовьте протокол заседания';end if;
 if exists(select 1 from public.game_votes where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution and status='open') then
  raise exception 'Перед подписанием протокола закройте голосования';end if;
 update public.institution_meeting_records set minutes_approved_by=uid,minutes_approved_at=now(),updated_at=now()
 where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution;
 update public.formal_documents set status_code='published',status_label='Протокол утверждён',
 current_owner_key='system',updated_at=now() where id=m.minutes_document_id;
end;$;
revoke all on function public.approve_institution_meeting_minutes(uuid,integer,text) from public,anon;
grant execute on function public.approve_institution_meeting_minutes(uuid,integer,text) to authenticated;

-- Keep registration role checks unchanged and add a server-side agenda gate.
create or replace function public.register_institution_session_at_stage(p_game_id uuid,p_institution text,p_stage_no integer)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 if p_stage_no is null or p_stage_no<1 or p_stage_no>16
    or not exists(select 1 from public.game_stages s where s.game_id=p_game_id and s.stage_no=p_stage_no)
 then raise exception 'Этап игры не найден';end if;
 if p_institution not in ('ksrf','gd','government','municipality','sf','committee','region',
  'cec','ks','vs','central_bank','accounts')
 and not exists(select 1 from public.institution_units u
  where u.game_id=p_game_id and 'unit:'||u.id::text=p_institution) then
  raise exception 'Орган не найден';end if;
 if not private.vote_member_has_office(p_game_id,uid,p_institution) then
  raise exception 'Должность или назначение в этот орган отсутствует';end if;
 -- Do not revoke anyone's existing registered attendance.
 if exists(select 1 from public.institution_session_registrations where game_id=p_game_id
  and stage_no=p_stage_no and institution_key=p_institution and user_id=uid) then return;end if;
 if not exists(select 1 from public.institution_meeting_records m
  join public.formal_documents d on d.id=m.agenda_document_id and d.game_id=m.game_id
  where m.game_id=p_game_id and m.stage_no=p_stage_no and m.institution_key=p_institution
  and m.agenda_approved_at is not null and d.status_code='published'
  and length(btrim(coalesce(m.agenda_body,'')))>=30) then
  raise exception 'Регистрация откроется после подготовки и утверждения документа повестки заседания';end if;
 insert into public.institution_session_registrations(game_id,stage_no,institution_key,user_id)
 values(p_game_id,p_stage_no,p_institution,uid) on conflict do nothing;
end;$$;
revoke all on function public.register_institution_session_at_stage(uuid,text,integer) from public,anon;
grant execute on function public.register_institution_session_at_stage(uuid,text,integer) to authenticated;

-- Prevent callers of the older registration RPC from bypassing the new agenda requirement.
create or replace function public.register_institution_session(p_game_id uuid,p_institution text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_stage integer;
begin
 select current_round into v_stage from public.games where id=p_game_id;
 if v_stage is null then raise exception 'Игра недоступна';end if;
 perform public.register_institution_session_at_stage(p_game_id,p_institution,v_stage);
end;$$;
revoke all on function public.register_institution_session(uuid,text) from public,anon;
grant execute on function public.register_institution_session(uuid,text) to authenticated;
