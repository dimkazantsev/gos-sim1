-- ГОС.ID: personal assignments and targeted Telegram notifications.
-- Migration contains additive schema/RPC/triggers only; no historic data is deleted.
create table if not exists public.game_assigned_tasks (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  assigned_by uuid not null,
  author_id uuid not null,
  recipient_id uuid not null,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text not null check (char_length(btrim(description)) between 1 and 6000),
  due_at timestamptz not null,
  requires_confirmation boolean not null default true,
  status text not null default 'open' check (status in ('open','completed','confirmed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  confirmed_at timestamptz,
  unique (game_id,id),
  foreign key (game_id,assigned_by) references public.game_members(game_id,user_id),
  foreign key (game_id,author_id) references public.game_members(game_id,user_id),
  foreign key (game_id,recipient_id) references public.game_members(game_id,user_id)
);
create index if not exists game_assigned_tasks_game_due on public.game_assigned_tasks(game_id,due_at desc);
create index if not exists game_assigned_tasks_recipient on public.game_assigned_tasks(game_id,recipient_id,status);
alter table public.game_assigned_tasks enable row level security;
revoke all on public.game_assigned_tasks from anon;
grant select on public.game_assigned_tasks to authenticated;
-- No direct INSERT/UPDATE/DELETE: validated SECURITY DEFINER RPC only.
revoke insert,update,delete on public.game_assigned_tasks from authenticated;
drop policy if exists assigned_tasks_read on public.game_assigned_tasks;
create policy assigned_tasks_read on public.game_assigned_tasks for select to authenticated using (
  exists(select 1 from public.game_members gm
   where gm.game_id=game_assigned_tasks.game_id and gm.user_id=(select auth.uid())
    and gm.roster_archived_at is null
    and (gm.kind='teacher' or game_assigned_tasks.assigned_by=gm.user_id
     or game_assigned_tasks.author_id=gm.user_id or game_assigned_tasks.recipient_id=gm.user_id))
);
create or replace function public.create_game_assigned_task(
 p_game_id uuid,p_author_id uuid,p_recipient_id uuid,p_title text,p_description text,
 p_due_at timestamptz,p_requires_confirmation boolean default true
) returns uuid language plpgsql security definer set search_path to 'public','private','pg_temp'
as $$
declare actor uuid:=auth.uid(); teacher boolean; new_id uuid;
begin
 if actor is null or not exists(select 1 from public.game_members m
    where m.game_id=p_game_id and m.user_id=actor and m.kind<>'observer' and m.roster_archived_at is null)
 then raise exception 'Нет доступа к назначению задач'; end if;
 teacher:=private.is_game_teacher(p_game_id);
 if p_author_id is distinct from actor and not teacher then
   raise exception 'Назначать задачи от имени другого участника может только преподаватель';
 end if;
 if not exists(select 1 from public.game_members m where m.game_id=p_game_id
      and m.user_id=p_author_id and m.kind<>'observer' and m.roster_archived_at is null)
    or not exists(select 1 from public.game_members m where m.game_id=p_game_id
      and m.user_id=p_recipient_id and m.kind<>'observer' and m.roster_archived_at is null)
 then raise exception 'Выберите действующих участников игры'; end if;
 if length(btrim(coalesce(p_title,''))) not between 3 and 160
   or length(btrim(coalesce(p_description,''))) not between 1 and 6000
 then raise exception 'Укажите название и описание поручения'; end if;
 if p_due_at is null or p_due_at <= now() or p_due_at > now()+interval '365 days'
 then raise exception 'Укажите дату исполнения в течение ближайшего года'; end if;
 insert into public.game_assigned_tasks(game_id,assigned_by,author_id,recipient_id,title,description,due_at,requires_confirmation)
 values(p_game_id,actor,p_author_id,p_recipient_id,btrim(p_title),btrim(p_description),p_due_at,coalesce(p_requires_confirmation,true))
 returning id into new_id;
 return new_id;
end $$;
create or replace function public.complete_game_assigned_task(p_task_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','private','pg_temp'
as $$
declare t public.game_assigned_tasks%rowtype;
begin
 select * into t from public.game_assigned_tasks where id=p_task_id for update;
 if t.id is null or t.recipient_id is distinct from auth.uid()
    or not exists(select 1 from public.game_members m where m.game_id=t.game_id and m.user_id=auth.uid() and m.roster_archived_at is null)
 then raise exception 'Нет доступа к выполнению поручения'; end if;
 if t.status='open' then
  update public.game_assigned_tasks set
   status=case when requires_confirmation then 'completed' else 'confirmed' end,
   completed_at=now(),
   confirmed_at=case when requires_confirmation then null else now() end where id=t.id;
 end if;
 return true;
end $$;
create or replace function public.confirm_game_assigned_task(p_task_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','private','pg_temp'
as $$
declare t public.game_assigned_tasks%rowtype;
begin
 select * into t from public.game_assigned_tasks where id=p_task_id for update;
 if t.id is null or not (t.author_id=auth.uid() or t.assigned_by=auth.uid() or private.is_game_teacher(t.game_id))
    or not exists(select 1 from public.game_members m where m.game_id=t.game_id and m.user_id=auth.uid() and m.roster_archived_at is null)
 then raise exception 'Подтверждение поручения недоступно'; end if;
 if t.status='completed' then update public.game_assigned_tasks set status='confirmed',confirmed_at=now() where id=t.id;
 elsif t.status='open' then raise exception 'Адресат ещё не отметил выполнение'; end if;
 return true;
end $$;
revoke all on function public.create_game_assigned_task(uuid,uuid,uuid,text,text,timestamptz,boolean) from public,anon;
revoke all on function public.complete_game_assigned_task(uuid) from public,anon;
revoke all on function public.confirm_game_assigned_task(uuid) from public,anon;
grant execute on function public.create_game_assigned_task(uuid,uuid,uuid,text,text,timestamptz,boolean) to authenticated;
grant execute on function public.complete_game_assigned_task(uuid) to authenticated;
grant execute on function public.confirm_game_assigned_task(uuid) to authenticated;

create or replace function private.gos_task_telegram_enqueue()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
 if tg_op='INSERT' then
  insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
  select new.game_id,l.user_id,'task',new.id,
   '📌 Вам назначено поручение «'||left(new.title,160)||'». '||
   'Срок исполнения: '||to_char(new.due_at at time zone 'Asia/Barnaul','DD.MM.YYYY HH24:MI')||' (Барнаул).'
  from public.telegram_links l join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
  where l.game_id=new.game_id and l.user_id=new.recipient_id and l.notifications_enabled and m.roster_archived_at is null
  on conflict do nothing;
 elsif new.status='completed' and old.status='open' then
  insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
  select new.game_id,l.user_id,'task_done',new.id,'✅ Поручение «'||left(new.title,160)||'» отмечено выполненным. Ожидает подтверждения.'
  from public.telegram_links l join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
  where l.game_id=new.game_id and l.user_id=new.author_id and l.notifications_enabled
   and new.author_id<>new.recipient_id and m.roster_archived_at is null on conflict do nothing;
 end if;
 return new;
end $$;
drop trigger if exists gos_task_notify on public.game_assigned_tasks;
create trigger gos_task_notify after insert or update of status on public.game_assigned_tasks
for each row execute function private.gos_task_telegram_enqueue();

create or replace function private.gos_chat_mention_telegram_enqueue()
returns trigger language plpgsql security definer set search_path to '' as $$
declare author_name text; channel_name text;
begin
 select full_name into author_name from public.game_members where game_id=new.game_id and user_id=new.author_id;
 select name into channel_name from public.chat_channels where game_id=new.game_id and id=new.channel_id;
 insert into public.telegram_outbox(game_id,user_id,category,source_id,body,channel_id)
 select new.game_id,l.user_id,'mention_chat',new.id,
 '🔔 Вас упомянул(а) '||coalesce(author_name,'участник')||' в чате «'||coalesce(channel_name,'Беседа')||'». Вас ждут в обсуждении.',new.channel_id
 from public.telegram_links l join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
 where l.game_id=new.game_id and l.user_id=new.mentioned_user_id
 and l.notifications_enabled and m.roster_archived_at is null on conflict do nothing;
 return new;
end $$;
drop trigger if exists gos_chat_mention_notify on public.chat_mentions;
create trigger gos_chat_mention_notify after insert on public.chat_mentions
for each row execute function private.gos_chat_mention_telegram_enqueue();

-- @Фамилия works in comments on posts and documents and in public political posts.
-- Skip ambiguous shared surnames rather than notifying the wrong person.
create or replace function private.gos_text_mentions_enqueue()
returns trigger language plpgsql security definer set search_path to '' as $$
declare body text;section_name text;source uuid;creator uuid;target_game uuid;author_name text;
begin
 if tg_table_name='civic_comments' then
  body:=new.body;section_name:=case when new.target_kind='document' then 'documents' else 'actions' end;
  source:=new.id;creator:=new.author_id;target_game:=new.game_id;
 elsif tg_table_name='political_posts' then
  if new.deleted_at is not null then return new;end if;
  body:=new.body;section_name:='actions';source:=new.id;creator:=new.author_id;target_game:=new.game_id;
 else return new;end if;
 select full_name into author_name from public.game_members where game_id=target_game and user_id=creator;
 insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
 select target_game,l.user_id,'mention_'||section_name,source,
 '🔔 '||coalesce(author_name,'Участник')||' упомянул(а) вас. Вас ждут в разделе «'||
 case when section_name='documents' then 'Документы' else 'Политический процесс' end||'».'
 from (select distinct lower((regexp_matches(body,'@([[:alpha:]0-9_]+)','g'))[1]) as handle) tokens
 join public.game_members m on m.game_id=target_game and m.kind<>'observer' and m.roster_archived_at is null
  and m.user_id<>creator
 join public.telegram_links l on l.game_id=target_game and l.user_id=m.user_id and l.notifications_enabled
 where (
  (lower(split_part(btrim(m.full_name),' ',1))=tokens.handle and
   (select count(*) from public.game_members dm where dm.game_id=target_game and dm.roster_archived_at is null
      and lower(split_part(btrim(dm.full_name),' ',1))=tokens.handle)=1)
  or (lower(split_part(btrim(m.full_name),' ',1))||'_'||left(replace(m.user_id::text,'-',''),8)=tokens.handle)
 )
 on conflict do nothing;
 return new;
end $$;
drop trigger if exists gos_civic_mention_notify on public.civic_comments;
create trigger gos_civic_mention_notify after insert on public.civic_comments
for each row execute function private.gos_text_mentions_enqueue();
drop trigger if exists gos_wall_mention_notify on public.political_posts;
create trigger gos_wall_mention_notify after insert on public.political_posts
for each row execute function private.gos_text_mentions_enqueue();

create or replace function private.gos_document_delivery_notify()
returns trigger language plpgsql security definer set search_path to '' as $$
declare title text;position text;
begin
 select d.title into title from public.formal_documents d where d.id=new.document_id and d.game_id=new.game_id;
 select m.role_title into position from public.game_members m where m.game_id=new.game_id and m.user_id=new.recipient_id;
 insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
 select new.game_id,l.user_id,'document_delivery',new.id,
 case when coalesce(new.destination,'') ilike '%подпис%' or coalesce(new.delivery_kind,'') ilike '%sign%'
 then '🖋 К вам на подпись поступил документ: ' else '📜 Вам поступил документ на рассмотрение: ' end
 ||coalesce(left(title,180),'Документ')||'. Откройте реестр НПА.'
 from public.telegram_links l join public.game_members m on m.game_id=l.game_id and m.user_id=l.user_id
 where l.game_id=new.game_id and l.user_id=new.recipient_id and l.notifications_enabled and m.roster_archived_at is null
 on conflict do nothing;
 return new;
end $$;
drop trigger if exists gos_document_delivery_notify on public.formal_document_deliveries;
create trigger gos_document_delivery_notify after insert on public.formal_document_deliveries
for each row execute function private.gos_document_delivery_notify();
