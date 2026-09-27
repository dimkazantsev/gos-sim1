-- Crisis-response workspace for stage 15 and crises launched at any moment.

alter table public.game_crises
  add column if not exists status text not null default 'active'
    check(status in ('active','resolved')),
  add column if not exists response_deadline timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text;

create table if not exists public.crisis_information_requests(
  id uuid primary key default gen_random_uuid(),
  crisis_id uuid not null references public.game_crises(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  answer text,
  status text not null default 'pending' check(status in ('pending','answered')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_by uuid references auth.users(id) on delete set null
);

create table if not exists public.crisis_responses(
  id uuid primary key default gen_random_uuid(),
  crisis_id uuid not null references public.game_crises(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_title text,
  action_plan text not null,
  legal_basis text,
  resources text,
  public_message text,
  teacher_note text,
  status text not null default 'submitted' check(status in ('submitted','reviewed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique(crisis_id,user_id)
);

create index if not exists crisis_info_game_idx on public.crisis_information_requests(game_id,created_at desc);
create index if not exists crisis_info_crisis_idx on public.crisis_information_requests(crisis_id,status,created_at);
create index if not exists crisis_responses_game_idx on public.crisis_responses(game_id,created_at desc);
create index if not exists crisis_responses_crisis_idx on public.crisis_responses(crisis_id,status,created_at);

alter table public.crisis_information_requests enable row level security;
alter table public.crisis_responses enable row level security;
revoke all privileges on table public.crisis_information_requests from anon,authenticated;
revoke all privileges on table public.crisis_responses from anon,authenticated;
grant select on table public.crisis_information_requests to authenticated;
grant select on table public.crisis_responses to authenticated;

drop policy if exists crisis_information_read on public.crisis_information_requests;
create policy crisis_information_read on public.crisis_information_requests
for select to authenticated
using(private.is_game_member(game_id));

drop policy if exists crisis_responses_read on public.crisis_responses;
create policy crisis_responses_read on public.crisis_responses
for select to authenticated
using(private.is_game_member(game_id));

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='crisis_information_requests')
 then alter publication supabase_realtime add table public.crisis_information_requests; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='crisis_responses')
 then alter publication supabase_realtime add table public.crisis_responses; end if;
end $$;

create or replace function public.launch_crisis(
 p_game_id uuid,p_crisis_type text,p_intensity text,p_description text,p_response_minutes integer default 20
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_stage integer;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
 if p_intensity not in ('low','medium','high','ultra') then raise exception 'Unsupported intensity'; end if;
 if length(trim(coalesce(p_crisis_type,'')))<3 or length(trim(coalesce(p_description,'')))<5 then raise exception 'Crisis description is required'; end if;
 if p_response_minutes<1 or p_response_minutes>240 then raise exception 'Response window must be from 1 to 240 minutes'; end if;
 select stage_no into v_stage from public.game_stages where game_id=p_game_id and status='open' order by stage_no desc limit 1;

 insert into public.game_crises(game_id,stage_no,crisis_type,intensity,description,created_by,status,response_deadline)
 values(p_game_id,coalesce(v_stage,15),trim(p_crisis_type),p_intensity,trim(p_description),v_uid,'active',now()+make_interval(mins=>p_response_minutes))
 returning id into v_id;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,coalesce(v_stage,15),'Кризис',
   case when p_intensity='ultra' then 'critical' when p_intensity='high' then 'warning' else 'notice' end,
   trim(p_crisis_type)||' · '||
   case p_intensity when 'low' then 'Низкая' when 'medium' then 'Средняя' when 'high' then 'Высокая' else 'Ультра' end,
   trim(p_description)||E'\n\nСрок первичной реакции: '||p_response_minutes||' мин.',v_uid);

 return v_id;
end;
$$;
revoke all on function public.launch_crisis(uuid,text,text,text,integer) from public,anon;
grant execute on function public.launch_crisis(uuid,text,text,text,integer) to authenticated;

create or replace function public.ask_crisis_information(p_crisis_id uuid,p_question text)
returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());c public.game_crises%rowtype;v_id uuid;
begin
 select * into c from public.game_crises where id=p_crisis_id;
 if c.id is null then raise exception 'Crisis not found'; end if;
 if v_uid is null or not private.is_game_member(c.game_id) then raise exception 'Game access required'; end if;
 if c.status<>'active' then raise exception 'Crisis is already resolved'; end if;
 if length(trim(coalesce(p_question,'')))<5 then raise exception 'Question is too short'; end if;
 insert into public.crisis_information_requests(crisis_id,game_id,requester_id,question)
 values(c.id,c.game_id,v_uid,trim(p_question)) returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.ask_crisis_information(uuid,text) from public,anon;
grant execute on function public.ask_crisis_information(uuid,text) to authenticated;

create or replace function public.answer_crisis_information(p_request_id uuid,p_answer text)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare r public.crisis_information_requests%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into r from public.crisis_information_requests where id=p_request_id for update;
 if r.id is null then raise exception 'Information request not found'; end if;
 if not private.is_game_teacher(r.game_id) then raise exception 'Teacher access required'; end if;
 if length(trim(coalesce(p_answer,'')))<2 then raise exception 'Answer is required'; end if;
 update public.crisis_information_requests
 set answer=trim(p_answer),status='answered',answered_at=now(),answered_by=v_uid
 where id=r.id;
end;
$$;
revoke all on function public.answer_crisis_information(uuid,text) from public,anon;
grant execute on function public.answer_crisis_information(uuid,text) to authenticated;

create or replace function public.submit_crisis_response(
 p_crisis_id uuid,p_action_plan text,p_legal_basis text default null,p_resources text default null,p_public_message text default null
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());c public.game_crises%rowtype;v_role text;v_id uuid;
begin
 select * into c from public.game_crises where id=p_crisis_id;
 if c.id is null then raise exception 'Crisis not found'; end if;
 if v_uid is null or not private.is_game_member(c.game_id) then raise exception 'Game access required'; end if;
 if c.status<>'active' then raise exception 'Crisis is already resolved'; end if;
 if length(trim(coalesce(p_action_plan,'')))<20 then raise exception 'Action plan is too short'; end if;
 select role_title into v_role from public.game_members where game_id=c.game_id and user_id=v_uid;

 insert into public.crisis_responses(crisis_id,game_id,user_id,role_title,action_plan,legal_basis,resources,public_message)
 values(c.id,c.game_id,v_uid,v_role,trim(p_action_plan),nullif(trim(coalesce(p_legal_basis,'')),''),nullif(trim(coalesce(p_resources,'')),''),nullif(trim(coalesce(p_public_message,'')),''))
 on conflict(crisis_id,user_id) do update
 set role_title=excluded.role_title,action_plan=excluded.action_plan,legal_basis=excluded.legal_basis,
     resources=excluded.resources,public_message=excluded.public_message,status='submitted',
     updated_at=now(),teacher_note=null,reviewed_at=null,reviewed_by=null
 returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.submit_crisis_response(uuid,text,text,text,text) from public,anon;
grant execute on function public.submit_crisis_response(uuid,text,text,text,text) to authenticated;

create or replace function public.review_crisis_response(p_response_id uuid,p_teacher_note text)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare r public.crisis_responses%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into r from public.crisis_responses where id=p_response_id for update;
 if r.id is null then raise exception 'Crisis response not found'; end if;
 if not private.is_game_teacher(r.game_id) then raise exception 'Teacher access required'; end if;
 update public.crisis_responses set teacher_note=nullif(trim(coalesce(p_teacher_note,'')),''),
   status='reviewed',reviewed_at=now(),reviewed_by=v_uid,updated_at=now()
 where id=r.id;
end;
$$;
revoke all on function public.review_crisis_response(uuid,text) from public,anon;
grant execute on function public.review_crisis_response(uuid,text) to authenticated;

create or replace function public.resolve_crisis(p_crisis_id uuid,p_resolution_note text default null)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare c public.game_crises%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into c from public.game_crises where id=p_crisis_id for update;
 if c.id is null then raise exception 'Crisis not found'; end if;
 if not private.is_game_teacher(c.game_id) then raise exception 'Teacher access required'; end if;
 update public.game_crises set status='resolved',resolved_at=now(),resolution_note=nullif(trim(coalesce(p_resolution_note,'')),'')
 where id=c.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(c.game_id,c.stage_no,'Кризис','notice','Кризис завершён · '||c.crisis_type,
   coalesce(nullif(trim(coalesce(p_resolution_note,'')),''),'Преподаватель завершил кризисный сценарий.'),v_uid);
end;
$$;
revoke all on function public.resolve_crisis(uuid,text) from public,anon;
grant execute on function public.resolve_crisis(uuid,text) to authenticated;
