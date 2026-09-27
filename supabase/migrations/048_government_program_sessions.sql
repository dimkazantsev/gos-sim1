-- Stage 11: Government meeting agenda for presentation and approval of state programs.
create table if not exists public.government_sessions(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 stage_no integer not null default 11,
 session_no integer not null,
 title text not null,
 time_limit_minutes integer not null default 60 check(time_limit_minutes between 5 and 240),
 status text not null default 'draft' check(status in ('draft','open','closed')),
 chair_user_id uuid references auth.users(id) on delete set null,
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 opened_at timestamptz,closed_at timestamptz,
 unique(game_id,session_no)
);
create table if not exists public.government_program_agenda(
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.government_sessions(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 program_id uuid not null references public.state_programs(id) on delete cascade,
 agenda_no integer not null,
 report_minutes integer not null default 7 check(report_minutes between 1 and 60),
 status text not null default 'pending' check(status in ('pending','presenting','decision','completed','withdrawn')),
 vote_id uuid references public.game_votes(id) on delete set null,
 result_note text,started_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now(),
 unique(session_id,program_id),unique(session_id,agenda_no)
);
create index if not exists government_sessions_game_idx on public.government_sessions(game_id,session_no desc);
create index if not exists government_program_agenda_session_idx on public.government_program_agenda(session_id,agenda_no);
alter table public.government_sessions enable row level security;
alter table public.government_program_agenda enable row level security;
revoke all privileges on table public.government_sessions from anon,authenticated;
revoke all privileges on table public.government_program_agenda from anon,authenticated;
grant select on table public.government_sessions to authenticated;
grant select on table public.government_program_agenda to authenticated;
drop policy if exists government_sessions_read on public.government_sessions;
create policy government_sessions_read on public.government_sessions for select to authenticated using(private.is_game_member(game_id));
drop policy if exists government_program_agenda_read on public.government_program_agenda;
create policy government_program_agenda_read on public.government_program_agenda for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='government_sessions') then alter publication supabase_realtime add table public.government_sessions; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='government_program_agenda') then alter publication supabase_realtime add table public.government_program_agenda; end if;
end $$;
create or replace function private.can_manage_government_session(p_game uuid,p_user uuid) returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select private.is_game_teacher(p_game) or private.game_role(p_game,p_user) like '%председател%правительств%' or private.game_role(p_game,p_user) like '%президент%';
$$;
revoke execute on function private.can_manage_government_session(uuid,uuid) from public,anon,authenticated;
create or replace function public.create_government_session(p_game_id uuid,p_title text,p_time_limit_minutes integer default 60)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_no integer;v_id uuid;
begin
 if v_uid is null or not private.can_manage_government_session(p_game_id,v_uid) then raise exception 'Prime Minister / President / teacher access required'; end if;
 if exists(select 1 from public.government_sessions where game_id=p_game_id and status='open') then raise exception 'Close the active Government session first'; end if;
 select coalesce(max(session_no),0)+1 into v_no from public.government_sessions where game_id=p_game_id;
 insert into public.government_sessions(game_id,session_no,title,time_limit_minutes,chair_user_id,created_by)
 values(p_game_id,v_no,coalesce(nullif(trim(p_title),''),'Заседание Правительства №'||v_no),greatest(5,least(240,p_time_limit_minutes)),v_uid,v_uid)
 returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.create_government_session(uuid,text,integer) from public,anon;
grant execute on function public.create_government_session(uuid,text,integer) to authenticated;
create or replace function public.add_program_to_government_agenda(p_session_id uuid,p_program_id uuid,p_report_minutes integer default 7)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.government_sessions%rowtype;p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_no integer;v_id uuid;
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Government session not found'; end if;
 if not private.can_manage_government_session(s.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'draft' then raise exception 'Agenda is locked after the session opens'; end if;
 select * into p from public.state_programs where id=p_program_id;
 if p.id is null or p.game_id<>s.game_id or p.status<>'ready' then raise exception 'Only programs ready for Government consideration may enter the agenda'; end if;
 select coalesce(max(agenda_no),0)+1 into v_no from public.government_program_agenda where session_id=s.id;
 insert into public.government_program_agenda(session_id,game_id,program_id,agenda_no,report_minutes)
 values(s.id,s.game_id,p.id,v_no,greatest(1,least(60,p_report_minutes))) returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.add_program_to_government_agenda(uuid,uuid,integer) from public,anon;
grant execute on function public.add_program_to_government_agenda(uuid,uuid,integer) to authenticated;
create or replace function public.open_government_session(p_session_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Government session not found'; end if;
 if not private.can_manage_government_session(s.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'draft' then raise exception 'Government session is not a draft'; end if;
 if not exists(select 1 from public.government_program_agenda where session_id=s.id and status='pending') then raise exception 'Add at least one program to the agenda'; end if;
 update public.government_sessions set status='open',opened_at=now(),chair_user_id=v_uid where id=s.id;
end;$$;
revoke all on function public.open_government_session(uuid) from public,anon;
grant execute on function public.open_government_session(uuid) to authenticated;
create or replace function public.start_government_program_report(p_item_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare i public.government_program_agenda%rowtype;s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into i from public.government_program_agenda where id=p_item_id for update;
 if i.id is null then raise exception 'Agenda item not found'; end if;
 select * into s from public.government_sessions where id=i.session_id;
 if not private.can_manage_government_session(i.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'open' or i.status<>'pending' then raise exception 'Agenda item cannot start'; end if;
 if exists(select 1 from public.government_program_agenda where session_id=s.id and status in ('presenting','decision')) then raise exception 'Finish the current agenda item first'; end if;
 update public.government_program_agenda set status='presenting',started_at=now() where id=i.id;
end;$$;
revoke all on function public.start_government_program_report(uuid) from public,anon;
grant execute on function public.start_government_program_report(uuid) to authenticated;
create or replace function public.open_program_vote_from_agenda(p_item_id uuid) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare i public.government_program_agenda%rowtype;s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;
begin
 select * into i from public.government_program_agenda where id=p_item_id for update;
 if i.id is null then raise exception 'Agenda item not found'; end if;
 select * into s from public.government_sessions where id=i.session_id;
 if not private.can_manage_government_session(i.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'open' or i.status<>'presenting' then raise exception 'Complete presentation before opening the decision'; end if;
 v_vote:=public.open_state_program_government_vote(i.program_id);
 update public.government_program_agenda set status='decision',vote_id=v_vote where id=i.id;
 return v_vote;
end;$$;
revoke all on function public.open_program_vote_from_agenda(uuid) from public,anon;
grant execute on function public.open_program_vote_from_agenda(uuid) to authenticated;
create or replace function private.government_program_agenda_vote_trigger() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if new.status='closed' and old.status is distinct from new.status then
  update public.government_program_agenda set status='completed',completed_at=now(),result_note=coalesce(new.result_label,new.result_code)
  where vote_id=new.id and status='decision';
 end if;
 return new;
end;$$;
revoke execute on function private.government_program_agenda_vote_trigger() from public,anon,authenticated;
drop trigger if exists trg_government_program_agenda_vote on public.game_votes;
create trigger trg_government_program_agenda_vote after update of status on public.game_votes for each row execute function private.government_program_agenda_vote_trigger();
create or replace function public.close_government_session(p_session_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Government session not found'; end if;
 if not private.can_manage_government_session(s.game_id,v_uid) then raise exception 'Government session management access required'; end if;
 if s.status<>'open' then raise exception 'Government session is not open'; end if;
 if exists(select 1 from public.government_program_agenda where session_id=s.id and status in ('presenting','decision')) then raise exception 'Finish the active agenda item before closing the session'; end if;
 update public.government_sessions set status='closed',closed_at=now() where id=s.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(s.game_id,11,'Заседание Правительства','notice','Заседание Правительства закрыто','Рассмотрено программ: '||(select count(*) from public.government_program_agenda where session_id=s.id and status='completed'),v_uid);
end;$$;
revoke all on function public.close_government_session(uuid) from public,anon;
grant execute on function public.close_government_session(uuid) to authenticated;