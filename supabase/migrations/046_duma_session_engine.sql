-- Stage 12: State Duma session agenda and carry-over engine.
create table if not exists public.duma_sessions(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 stage_no integer not null default 12,
 session_no integer not null,
 title text not null,
 scheduled_start timestamptz,
 scheduled_end timestamptz,
 status text not null default 'draft' check(status in ('draft','open','closed')),
 chair_user_id uuid references auth.users(id) on delete set null,
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 opened_at timestamptz,
 closed_at timestamptz,
 unique(game_id,session_no)
);
create table if not exists public.duma_agenda_items(
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.duma_sessions(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 formal_document_id uuid not null references public.formal_documents(id) on delete cascade,
 agenda_no integer not null,
 status text not null default 'pending' check(status in ('pending','in_progress','completed','carried_over','withdrawn')),
 result_note text,started_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now(),
 unique(session_id,formal_document_id),unique(session_id,agenda_no)
);
create index if not exists duma_sessions_game_idx on public.duma_sessions(game_id,session_no desc);
create index if not exists duma_agenda_session_idx on public.duma_agenda_items(session_id,agenda_no);
create index if not exists duma_agenda_doc_idx on public.duma_agenda_items(formal_document_id,status);
alter table public.duma_sessions enable row level security;
alter table public.duma_agenda_items enable row level security;
revoke all privileges on table public.duma_sessions from anon,authenticated;
revoke all privileges on table public.duma_agenda_items from anon,authenticated;
grant select on table public.duma_sessions to authenticated;
grant select on table public.duma_agenda_items to authenticated;
drop policy if exists duma_sessions_read on public.duma_sessions;
create policy duma_sessions_read on public.duma_sessions for select to authenticated using(private.is_game_member(game_id));
drop policy if exists duma_agenda_items_read on public.duma_agenda_items;
create policy duma_agenda_items_read on public.duma_agenda_items for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='duma_sessions') then alter publication supabase_realtime add table public.duma_sessions; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='duma_agenda_items') then alter publication supabase_realtime add table public.duma_agenda_items; end if;
end $$;
create or replace function private.can_manage_duma_session(p_game uuid,p_user uuid) returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select private.is_game_teacher(p_game) or private.game_role(p_game,p_user) like '%председател%дум%' or private.game_role(p_game,p_user) like '%совет%дум%';
$$;
revoke execute on function private.can_manage_duma_session(uuid,uuid) from public,anon,authenticated;
create or replace function public.create_duma_session(p_game_id uuid,p_title text,p_scheduled_start timestamptz default null,p_scheduled_end timestamptz default null) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_no integer;v_id uuid;
begin
 if v_uid is null or not private.can_manage_duma_session(p_game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 if exists(select 1 from public.duma_sessions where game_id=p_game_id and status='open') then raise exception 'Close the current State Duma session first'; end if;
 select coalesce(max(session_no),0)+1 into v_no from public.duma_sessions where game_id=p_game_id;
 insert into public.duma_sessions(game_id,session_no,title,scheduled_start,scheduled_end,chair_user_id,created_by)
 values(p_game_id,v_no,coalesce(nullif(trim(p_title),''),'Заседание Государственной Думы №'||v_no),p_scheduled_start,p_scheduled_end,v_uid,v_uid) returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.create_duma_session(uuid,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.create_duma_session(uuid,text,timestamptz,timestamptz) to authenticated;
create or replace function public.add_duma_agenda_item(p_session_id uuid,p_document_id uuid) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.duma_sessions%rowtype;d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_no integer;v_id uuid;
begin
 select * into s from public.duma_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Session not found'; end if;
 if not private.can_manage_duma_session(s.game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 if s.status<>'draft' then raise exception 'Agenda can be changed only before the session opens'; end if;
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or d.game_id<>s.game_id then raise exception 'Document not found in this game'; end if;
 if d.workflow_key not in ('bill','budget','gd_resolution') then raise exception 'Only parliamentary documents may enter the Duma agenda'; end if;
 select coalesce(max(agenda_no),0)+1 into v_no from public.duma_agenda_items where session_id=s.id;
 insert into public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no) values(s.id,s.game_id,d.id,v_no) returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.add_duma_agenda_item(uuid,uuid) from public,anon;
grant execute on function public.add_duma_agenda_item(uuid,uuid) to authenticated;
create or replace function public.open_duma_session(p_session_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.duma_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.duma_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Session not found'; end if;
 if not private.can_manage_duma_session(s.game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 if s.status<>'draft' then raise exception 'Session is not a draft'; end if;
 if not exists(select 1 from public.duma_agenda_items where session_id=s.id and status='pending') then raise exception 'The Duma does not meet without an agenda'; end if;
 update public.duma_sessions set status='open',opened_at=now(),chair_user_id=v_uid where id=s.id;
end;$$;
revoke all on function public.open_duma_session(uuid) from public,anon;
grant execute on function public.open_duma_session(uuid) to authenticated;
create or replace function public.set_duma_agenda_item_status(p_item_id uuid,p_status text,p_note text default null) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare i public.duma_agenda_items%rowtype;s public.duma_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into i from public.duma_agenda_items where id=p_item_id for update;
 if i.id is null then raise exception 'Agenda item not found'; end if;
 select * into s from public.duma_sessions where id=i.session_id;
 if not private.can_manage_duma_session(i.game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 if s.status<>'open' then raise exception 'Session is not open'; end if;
 if p_status not in ('in_progress','completed','withdrawn') then raise exception 'Unsupported agenda status'; end if;
 if p_status='in_progress' then update public.duma_agenda_items set status='in_progress',started_at=coalesce(started_at,now()),result_note=nullif(trim(coalesce(p_note,'')),'') where id=i.id;
 elsif p_status='completed' then update public.duma_agenda_items set status='completed',completed_at=now(),result_note=nullif(trim(coalesce(p_note,'')),'') where id=i.id;
 else update public.duma_agenda_items set status='withdrawn',completed_at=now(),result_note=nullif(trim(coalesce(p_note,'')),'') where id=i.id; end if;
end;$$;
revoke all on function public.set_duma_agenda_item_status(uuid,text,text) from public,anon;
grant execute on function public.set_duma_agenda_item_status(uuid,text,text) to authenticated;
create or replace function public.close_duma_session(p_session_id uuid,p_create_next boolean default true) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.duma_sessions%rowtype;v_uid uuid:=(select auth.uid());v_next uuid;v_next_no integer;v_carried integer;
begin
 select * into s from public.duma_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Session not found'; end if;
 if not private.can_manage_duma_session(s.game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 if s.status<>'open' then raise exception 'Session is not open'; end if;
 update public.duma_sessions set status='closed',closed_at=now() where id=s.id;
 select count(*)::integer into v_carried from public.duma_agenda_items where session_id=s.id and status in ('pending','in_progress');
 update public.duma_agenda_items set status='carried_over' where session_id=s.id and status in ('pending','in_progress');
 if p_create_next and v_carried>0 then
  select coalesce(max(session_no),0)+1 into v_next_no from public.duma_sessions where game_id=s.game_id;
  insert into public.duma_sessions(game_id,session_no,title,status,chair_user_id,created_by) values(s.game_id,v_next_no,'Заседание Государственной Думы №'||v_next_no,'draft',v_uid,v_uid) returning id into v_next;
  insert into public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no,status)
  select v_next,s.game_id,formal_document_id,row_number() over(order by agenda_no),'pending' from public.duma_agenda_items where session_id=s.id and status='carried_over' order by agenda_no;
 end if;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,12,'Заседание ГД','notice','Заседание Государственной Думы закрыто','Рассмотрено: '||(select count(*) from public.duma_agenda_items where session_id=s.id and status='completed')||'; перенесено: '||v_carried,v_uid);
 return jsonb_build_object('carried_over',v_carried,'next_session_id',v_next);
end;$$;
revoke all on function public.close_duma_session(uuid,boolean) from public,anon;
grant execute on function public.close_duma_session(uuid,boolean) to authenticated;