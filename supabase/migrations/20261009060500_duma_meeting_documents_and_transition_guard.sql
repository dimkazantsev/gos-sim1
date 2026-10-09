-- Stage 12: keep the meeting agenda connected to registered documents and genuine bill progress.
alter table public.duma_sessions
  add column if not exists agenda_document_id uuid references public.formal_documents(id) on delete set null;
alter table public.duma_agenda_items
  add column if not exists opened_document_step text;
create unique index if not exists duma_session_agenda_document_uidx
  on public.duma_sessions(agenda_document_id) where agenda_document_id is not null;

create or replace function private.sync_duma_session_agenda_document(p_session_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.duma_sessions%rowtype; v_doc uuid; v_lines text; v_body text; v_steps jsonb;
begin
 select * into s from public.duma_sessions where id=p_session_id;
 if s.id is null then return null; end if;
 select string_agg(format('%s. %s · %s%s',
      x.agenda_no,d.title,d.registry_no,
      E'\n   Текущая стадия НПА: '||d.status_label),
      E'\n\n' order by x.agenda_no)
  into v_lines
  from public.duma_agenda_items x join public.formal_documents d on d.id=x.formal_document_id
  where x.session_id=s.id;
 v_body:='ПОВЕСТКА ЗАСЕДАНИЯ ГОСУДАРСТВЕННОЙ ДУМЫ'
   ||E'\n\nЗаседание № '||s.session_no||E'\n'||s.title
   ||E'\nВремя начала: '||coalesce(to_char(s.scheduled_start at time zone 'Asia/Barnaul','DD.MM.YYYY HH24:MI'),'Не указано')
   ||E'\nВремя окончания: '||coalesce(to_char(s.scheduled_end at time zone 'Asia/Barnaul','DD.MM.YYYY HH24:MI'),'Не указано')
   ||E'\nСтатус заседания: '||case s.status when 'draft' then 'Подготовка' when 'open' then 'Открыто' else 'Завершено' end
   ||E'\n\nВОПРОСЫ ПОВЕСТКИ\n\n'||coalesce(v_lines,'Документы ещё не включены в повестку.');
 if s.agenda_document_id is null then
  v_doc:=gen_random_uuid();
  v_steps:=private.formal_workflow('gd_resolution');
  insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
    body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
  values(v_doc,s.game_id,12,'ИГРА-ПОВ-ГД-'||lpad(nextval('public.formal_registry_seq')::text,5,'0'),
    'Повестка заседания Государственной Думы № '||s.session_no,
    'meeting_agenda','gd','Государственная Дума Федерального Собрания РФ',s.created_by,
    v_body,'gd_resolution',v_steps,0,'draft','Проект повестки','gd',
    jsonb_build_object('document_kind','duma_session_agenda','duma_session_id',s.id,'auto_generated',true));
  update public.duma_sessions set agenda_document_id=v_doc where id=s.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
  values(v_doc,s.game_id,s.created_by,'Создана повестка заседания','draft','gd','Служебный документ заседания № '||s.session_no);
 else
  v_doc:=s.agenda_document_id;
  update public.formal_documents set body_text=v_body,
   status_code=case when s.status='draft' then 'draft' else 'published' end,
   status_label=case s.status when 'draft' then 'Проект повестки' when 'open' then 'Утверждённая повестка' else 'Повестка завершённого заседания' end,
   current_owner_key=case when s.status='draft' then 'gd' else 'system' end,
   updated_at=now()
  where id=v_doc and (body_text is distinct from v_body or status_label is distinct from
   case s.status when 'draft' then 'Проект повестки' when 'open' then 'Утверждённая повестка' else 'Повестка завершённого заседания' end);
 end if;
 return v_doc;
end;$$;
revoke all on function private.sync_duma_session_agenda_document(uuid) from public,anon,authenticated;

create or replace function private.on_duma_session_agenda_change()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if tg_table_name='duma_sessions' then
  if tg_op='INSERT' or old.status is distinct from new.status or old.scheduled_start is distinct from new.scheduled_start
    or old.scheduled_end is distinct from new.scheduled_end or old.title is distinct from new.title then
   perform private.sync_duma_session_agenda_document(new.id);
  end if;
 else
  perform private.sync_duma_session_agenda_document(case when tg_op='DELETE' then old.session_id else new.session_id end);
 end if;
 return case when tg_op='DELETE' then old else new end;
end;$$;
revoke all on function private.on_duma_session_agenda_change() from public,anon,authenticated;
drop trigger if exists trg_duma_session_document on public.duma_sessions;
create trigger trg_duma_session_document after insert or update on public.duma_sessions
for each row execute function private.on_duma_session_agenda_change();
drop trigger if exists trg_duma_agenda_document on public.duma_agenda_items;
create trigger trg_duma_agenda_document after insert or delete on public.duma_agenda_items
for each row execute function private.on_duma_session_agenda_change();

-- Do not allow "completed" to replace actual voting and legislative transitions.
create or replace function public.set_duma_agenda_item_status(p_item_id uuid,p_status text,p_note text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare i public.duma_agenda_items%rowtype;s public.duma_sessions%rowtype;d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into i from public.duma_agenda_items where id=p_item_id for update;
 if i.id is null then raise exception 'Вопрос повестки не найден';end if;
 select * into s from public.duma_sessions where id=i.session_id;
 if not private.can_manage_duma_session(i.game_id,v_uid) then raise exception 'Нет полномочий на управление заседанием ГД';end if;
 if s.status<>'open' then raise exception 'Заседание не открыто';end if;
 if p_status not in ('in_progress','completed','withdrawn') then raise exception 'Неизвестный статус вопроса';end if;
 select * into d from public.formal_documents where id=i.formal_document_id;
 if d.id is null then raise exception 'Связанный НПА не найден';end if;
 if p_status='in_progress' then
  if i.status not in ('pending','in_progress') then raise exception 'Этот вопрос уже завершён';end if;
  if exists(select 1 from public.duma_agenda_items x where x.session_id=i.session_id and x.id<>i.id and x.status='in_progress') then
   raise exception 'Сначала завершите предыдущий вопрос повестки';end if;
  update public.duma_agenda_items
    set status='in_progress',started_at=coalesce(started_at,now()),opened_document_step=coalesce(opened_document_step,d.status_code),
      result_note=nullif(btrim(coalesce(p_note,'')),'')
  where id=i.id;
 elsif p_status='completed' then
  if i.status<>'in_progress' then raise exception 'Сначала начните рассмотрение вопроса';end if;
  if exists(select 1 from public.game_votes v where v.formal_document_id=d.id and v.status='open') then
    raise exception 'Сначала завершите голосование по этому документу';end if;
  if d.status_code=coalesce(i.opened_document_step,d.status_code) then
    raise exception 'Стадия документа не изменилась. Проведите чтение или процедурное решение в реестре НПА';end if;
  update public.duma_agenda_items set status='completed',completed_at=now(),
    result_note=nullif(btrim(coalesce(p_note,'')),'')
   where id=i.id;
 else
  if i.status not in ('pending','in_progress') then raise exception 'Этот вопрос уже завершён';end if;
  update public.duma_agenda_items set status='withdrawn',completed_at=now(),
    result_note=nullif(btrim(coalesce(p_note,'')),'') where id=i.id;
 end if;
end;$$;
revoke all on function public.set_duma_agenda_item_status(uuid,text,text) from public,anon;
grant execute on function public.set_duma_agenda_item_status(uuid,text,text) to authenticated;

-- Existing sessions retain their documents and results; add only the missing agenda document.
do $$
declare s record;
begin
 for s in select id from public.duma_sessions where agenda_document_id is null loop
  perform private.sync_duma_session_agenda_document(s.id);
 end loop;
end;$$;