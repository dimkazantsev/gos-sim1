-- Agenda documents, agenda questions, and review proposals for Stage 11.
alter table public.government_sessions add column if not exists agenda_document_id uuid references public.formal_documents(id) on delete set null;
create unique index if not exists government_sessions_agenda_document_uidx on public.government_sessions(agenda_document_id) where agenda_document_id is not null;

create table if not exists public.government_session_questions(
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.government_sessions(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 title text not null check(length(btrim(title)) between 3 and 500),
 description text not null default '',
 duration_minutes integer not null default 10 check(duration_minutes between 1 and 60),
 program_agenda_id uuid unique references public.government_program_agenda(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','discussed')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists government_questions_session_idx on public.government_session_questions(session_id,created_at,id);
alter table public.government_session_questions enable row level security;
revoke all on public.government_session_questions from anon,authenticated;
grant select on public.government_session_questions to authenticated;
create policy government_questions_member_read on public.government_session_questions for select to authenticated using(private.is_game_member(game_id));

create table if not exists public.state_program_review_proposals(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 program_id uuid not null references public.state_programs(id) on delete cascade,
 section_key text not null check(section_key in ('passport','goals','structure','expenses','other')),
 original_text text not null default '',
 proposed_text text not null check(length(btrim(proposed_text)) between 5 and 6000),
 justification text not null default '',
 status text not null default 'submitted' check(status in ('submitted','accepted','rejected')),
 created_by uuid not null references auth.users(id),
 reviewed_by uuid references auth.users(id),
 review_note text,
 created_at timestamptz not null default now(),
 reviewed_at timestamptz
);
create index if not exists program_review_proposals_game_idx on public.state_program_review_proposals(game_id,program_id,created_at);
alter table public.state_program_review_proposals enable row level security;
revoke all on public.state_program_review_proposals from anon,authenticated;
grant select on public.state_program_review_proposals to authenticated;
create policy program_review_proposals_member_read on public.state_program_review_proposals for select to authenticated using(private.is_game_member(game_id));

create or replace function private.refresh_government_agenda_document(p_session uuid) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.government_sessions%rowtype; v_doc uuid;v_registry text;v_steps jsonb;v_body text;v_rows text;v_actor uuid;
begin
 select * into s from public.government_sessions where id=p_session;
 if s.id is null then return null; end if;
 v_actor:=coalesce((select auth.uid()),s.created_by);
 select string_agg(format('%s. %s%s%s', q.rn, q.title,
    case when q.description='' then '' else E'\n   '||q.description end,
    E'\n   Доклад: '||q.minutes||' мин.'), E'\n\n' order by q.rn) into v_rows
 from (
   select row_number() over(order by src.sort_at,src.sort_id) as rn,src.title,src.description,src.minutes
   from (
      select q.created_at as sort_at,q.id as sort_id,q.title,q.description,q.duration_minutes as minutes
      from public.government_session_questions q where q.session_id=s.id
      union all
      select a.created_at,a.id,'Рассмотрение государственной программы «'||p.title||'»',
             'Ответственный исполнитель: '||p.responsible_ministry,a.report_minutes
      from public.government_program_agenda a
      join public.state_programs p on p.id=a.program_id
      where a.session_id=s.id and not exists(select 1 from public.government_session_questions q where q.program_agenda_id=a.id)
   ) src
 ) q;
 v_body:='ПОВЕСТКА ЗАСЕДАНИЯ ПРАВИТЕЛЬСТВА РОССИЙСКОЙ ФЕДЕРАЦИИ'
      ||E'\n\n'||s.title||E'\nЗаседание № '||s.session_no
      ||E'\nОбщий регламент: '||s.time_limit_minutes||' мин.'
      ||E'\nСтатус: '||case s.status when 'draft' then 'Проект' when 'open' then 'Утверждена' else 'Заседание завершено' end
      ||E'\n\nВОПРОСЫ ПОВЕСТКИ\n\n'||coalesce(v_rows,'Вопросы повестки пока не внесены.');
 v_doc:=s.agenda_document_id;
 if v_doc is null then
   v_doc:=gen_random_uuid();
   v_registry:='ИГРА-ПОВ-'||lpad(nextval('public.formal_registry_seq')::text,4,'0');
   v_steps:=private.formal_workflow('government_act');
   insert into public.formal_documents(
     id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
     body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
   ) values(
     v_doc,s.game_id,11,v_registry,'Повестка заседания Правительства № '||s.session_no,
     'meeting_agenda','government','Правительство Российской Федерации',s.created_by,
     v_body,'government_act',v_steps,0,'draft','Проект повестки','government',
     jsonb_build_object('document_kind','government_session_agenda','government_session_id',s.id,'auto_generated',true)
   );
   update public.government_sessions set agenda_document_id=v_doc where id=s.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
     values(v_doc,s.game_id,v_actor,'Создан проект повестки','draft','government','Связан с заседанием Правительства № '||s.session_no);
 else
   update public.formal_documents set body_text=v_body,updated_at=now(),
     status_code=case when s.status='draft' then 'draft' else 'published' end,
     status_label=case s.status when 'draft' then 'Проект повестки' when 'open' then 'Утверждена' else 'Заседание завершено' end,
     current_owner_key=case when s.status='draft' then 'government' else 'system' end
   where id=v_doc and (body_text is distinct from v_body or status_label is distinct from
      case s.status when 'draft' then 'Проект повестки' when 'open' then 'Утверждена' else 'Заседание завершено' end);
 end if;
 return v_doc;
end;$$;
revoke execute on function private.refresh_government_agenda_document(uuid) from public,anon,authenticated;

create or replace function private.government_session_document_trigger() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if tg_op='INSERT' then perform private.refresh_government_agenda_document(new.id);
 elsif old.status is distinct from new.status or old.title is distinct from new.title or old.time_limit_minutes is distinct from new.time_limit_minutes then
 perform private.refresh_government_agenda_document(new.id);
 end if;
 return new;
end;$$;
revoke execute on function private.government_session_document_trigger() from public,anon,authenticated;
drop trigger if exists trg_government_session_agenda_document on public.government_sessions;
create trigger trg_government_session_agenda_document after insert or update on public.government_sessions
for each row execute function private.government_session_document_trigger();

create or replace function private.government_question_doc_trigger() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 perform private.refresh_government_agenda_document(case when tg_op='DELETE' then old.session_id else new.session_id end);
 return coalesce(new,old);
end;$$;
revoke execute on function private.government_question_doc_trigger() from public,anon,authenticated;
drop trigger if exists trg_government_question_doc on public.government_session_questions;
create trigger trg_government_question_doc after insert or update or delete on public.government_session_questions
for each row execute function private.government_question_doc_trigger();
drop trigger if exists trg_government_program_doc on public.government_program_agenda;
create trigger trg_government_program_doc after insert or update or delete on public.government_program_agenda
for each row execute function private.government_question_doc_trigger();

create or replace function public.add_government_session_question(
 p_session_id uuid,p_title text,p_description text default '',p_duration_minutes integer default 10,p_program_id uuid default null
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;v_agenda uuid;p public.state_programs%rowtype;v_no integer;
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null or v_uid is null or not private.can_manage_government_session(s.game_id,v_uid) then raise exception 'Недостаточно прав на повестку'; end if;
 if s.status<>'draft' then raise exception 'Повестка закрыта для редактирования'; end if;
 if length(btrim(coalesce(p_title,'')))<3 or length(p_title)>500 then raise exception 'Введите название вопроса (3–500 символов)'; end if;
 if p_duration_minutes not between 1 and 60 then raise exception 'Время доклада: 1–60 минут';end if;
 if p_program_id is not null then
   select * into p from public.state_programs where id=p_program_id and game_id=s.game_id;
   if p.id is null or p.status<>'ready' then raise exception 'В повестку можно внести только подписанную и готовую к рассмотрению программу'; end if;
   if exists(select 1 from public.government_program_agenda where session_id=s.id and program_id=p.id) then raise exception 'Программа уже включена в повестку'; end if;
   select coalesce(max(agenda_no),0)+1 into v_no from public.government_program_agenda where session_id=s.id;
   insert into public.government_program_agenda(session_id,game_id,program_id,agenda_no,report_minutes)
      values(s.id,s.game_id,p.id,v_no,p_duration_minutes) returning id into v_agenda;
 end if;
 insert into public.government_session_questions(session_id,game_id,title,description,duration_minutes,program_agenda_id,created_by)
 values(s.id,s.game_id,btrim(p_title),left(coalesce(p_description,''),6000),p_duration_minutes,v_agenda,v_uid) returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.add_government_session_question(uuid,text,text,integer,uuid) from public,anon;
grant execute on function public.add_government_session_question(uuid,text,text,integer,uuid) to authenticated;

create or replace function public.create_government_session_with_questions(
 p_game_id uuid,p_title text,p_time_limit_minutes integer,p_questions jsonb
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_id uuid;item jsonb;
begin
 if jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions)<1 or jsonb_array_length(p_questions)>30 then raise exception 'Добавьте от 1 до 30 вопросов повестки';end if;
 v_id:=public.create_government_session(p_game_id,p_title,p_time_limit_minutes);
 for item in select value from jsonb_array_elements(p_questions) loop
   perform public.add_government_session_question(v_id,item->>'title',coalesce(item->>'description',''),coalesce((item->>'minutes')::integer,10),null);
 end loop;
 return v_id;
end;$$;
revoke all on function public.create_government_session_with_questions(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.create_government_session_with_questions(uuid,text,integer,jsonb) to authenticated;

create or replace function public.update_government_session_question(p_question_id uuid,p_title text,p_description text,p_duration_minutes integer)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare q public.government_session_questions%rowtype;s public.government_sessions%rowtype;
begin
 select * into q from public.government_session_questions where id=p_question_id for update;
 if q.id is null then raise exception 'Вопрос не найден';end if;
 select * into s from public.government_sessions where id=q.session_id;
 if not private.can_manage_government_session(q.game_id,(select auth.uid())) or s.status<>'draft' then raise exception 'Редактирование недоступно';end if;
 if length(btrim(coalesce(p_title,''))) not between 3 and 500 or p_duration_minutes not between 1 and 60 then raise exception 'Проверьте название и время доклада';end if;
 update public.government_session_questions set title=btrim(p_title),description=left(coalesce(p_description,''),6000),duration_minutes=p_duration_minutes where id=q.id;
 if q.program_agenda_id is not null then update public.government_program_agenda set report_minutes=p_duration_minutes where id=q.program_agenda_id;end if;
end;$$;
revoke all on function public.update_government_session_question(uuid,text,text,integer) from public,anon;
grant execute on function public.update_government_session_question(uuid,text,text,integer) to authenticated;

create or replace function public.remove_government_session_question(p_question_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare q public.government_session_questions%rowtype;s public.government_sessions%rowtype;
begin
 select * into q from public.government_session_questions where id=p_question_id for update;
 if q.id is null then return;end if;
 select * into s from public.government_sessions where id=q.session_id;
 if not private.can_manage_government_session(q.game_id,(select auth.uid())) or s.status<>'draft' then raise exception 'Удаление недоступно';end if;
 delete from public.government_session_questions where id=q.id;
 if q.program_agenda_id is not null then delete from public.government_program_agenda where id=q.program_agenda_id;end if;
end;$$;
revoke all on function public.remove_government_session_question(uuid) from public,anon;
grant execute on function public.remove_government_session_question(uuid) to authenticated;

create or replace function public.set_government_session_question_discussed(p_question_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare q public.government_session_questions%rowtype;s public.government_sessions%rowtype;
begin
 select * into q from public.government_session_questions where id=p_question_id for update;
 if q.id is null then raise exception 'Вопрос не найден';end if;
 select * into s from public.government_sessions where id=q.session_id;
 if not private.can_manage_government_session(q.game_id,(select auth.uid())) or s.status<>'open' then raise exception 'Заседание не открыто';end if;
 if q.program_agenda_id is not null then raise exception 'Государственная программа рассматривается по отдельной процедуре с голосованием';end if;
 update public.government_session_questions set status='discussed' where id=q.id;
end;$$;
revoke all on function public.set_government_session_question_discussed(uuid) from public,anon;
grant execute on function public.set_government_session_question_discussed(uuid) to authenticated;

create or replace function public.submit_state_program_review_proposal(
 p_program_id uuid,p_section_key text,p_original_text text,p_proposed_text text,p_justification text
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into p from public.state_programs where id=p_program_id;
 if p.id is null or v_uid is null or not private.is_game_member(p.game_id)
   or not exists(select 1 from public.game_members gm where gm.game_id=p.game_id and gm.user_id=v_uid and gm.kind in ('student','teacher') and gm.roster_archived_at is null)
 then raise exception 'Право подачи поправок есть только у участников игры';end if;
 if p_section_key not in ('passport','goals','structure','expenses','other') then raise exception 'Неизвестный раздел программы';end if;
 if length(btrim(coalesce(p_proposed_text,''))) not between 5 and 6000 then raise exception 'Опишите предлагаемую поправку (5–6000 символов)';end if;
 insert into public.state_program_review_proposals(game_id,program_id,section_key,original_text,proposed_text,justification,created_by)
 values(p.game_id,p.id,p_section_key,left(coalesce(p_original_text,''),4000),btrim(p_proposed_text),left(coalesce(p_justification,''),4000),v_uid)
 returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.submit_state_program_review_proposal(uuid,text,text,text,text) from public,anon;
grant execute on function public.submit_state_program_review_proposal(uuid,text,text,text,text) to authenticated;

create or replace function public.review_state_program_proposal(p_proposal_id uuid,p_action text,p_note text default '')
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare q public.state_program_review_proposals%rowtype;v_uid uuid:=(select auth.uid());p public.state_programs%rowtype;
begin
 select * into q from public.state_program_review_proposals where id=p_proposal_id for update;
 if q.id is null then raise exception 'Предложение не найдено';end if;
 select * into p from public.state_programs where id=q.program_id;
 if v_uid is null or not (private.can_manage_government_session(q.game_id,v_uid) or p.responsible_minister_id=v_uid)
 then raise exception 'Недостаточно прав для рассмотрения';end if;
 if q.status<>'submitted' or p_action not in ('accepted','rejected') then raise exception 'Решение недоступно';end if;
 update public.state_program_review_proposals set status=p_action,reviewed_by=v_uid,reviewed_at=now(),review_note=left(coalesce(p_note,''),4000) where id=q.id;
end;$$;
revoke all on function public.review_state_program_proposal(uuid,text,text) from public,anon;
grant execute on function public.review_state_program_proposal(uuid,text,text) to authenticated;

-- Backfill existing sessions and agenda, preserving records and program votes.
do $$
declare s record;
begin
 for s in select id from public.government_sessions where agenda_document_id is null loop
  perform private.refresh_government_agenda_document(s.id);
 end loop;
end;$$;