-- Structured state-program management for stages 10-11.

create table if not exists public.state_programs(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no integer not null default 10,
  title text not null,
  responsible_ministry text not null,
  responsible_minister_id uuid references auth.users(id) on delete set null,
  curator_id uuid references auth.users(id) on delete set null,
  national_goal text,
  start_date date,
  end_date date,
  total_budget numeric not null default 0 check(total_budget>=0),
  expected_results text,
  status text not null default 'draft'
    check(status in ('draft','minister_review','revision','pm_review','ready','government_vote','adopted','rejected')),
  government_vote_id uuid references public.game_votes(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.state_program_goals(
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.state_programs(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  goal_text text not null,
  indicator_name text not null,
  unit text,
  baseline_value numeric,
  target_value numeric,
  target_year integer,
  created_at timestamptz not null default now()
);

create table if not exists public.state_program_components(
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.state_programs(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  direction_no integer not null check(direction_no between 1 and 3),
  direction_title text not null,
  component_kind text not null check(component_kind in ('project','target_program','measure')),
  title text not null,
  goal_text text not null,
  start_date date,
  end_date date,
  budget numeric not null default 0 check(budget>=0),
  created_at timestamptz not null default now()
);

create index if not exists state_programs_game_idx on public.state_programs(game_id,status,created_at);
create index if not exists state_program_goals_program_idx on public.state_program_goals(program_id);
create index if not exists state_program_components_program_idx on public.state_program_components(program_id,direction_no);

alter table public.state_programs enable row level security;
alter table public.state_program_goals enable row level security;
alter table public.state_program_components enable row level security;
revoke all privileges on table public.state_programs from anon,authenticated;
revoke all privileges on table public.state_program_goals from anon,authenticated;
revoke all privileges on table public.state_program_components from anon,authenticated;
grant select on table public.state_programs to authenticated;
grant select on table public.state_program_goals to authenticated;
grant select on table public.state_program_components to authenticated;

drop policy if exists state_programs_read on public.state_programs;
create policy state_programs_read on public.state_programs for select to authenticated using(private.is_game_member(game_id));
drop policy if exists state_program_goals_read on public.state_program_goals;
create policy state_program_goals_read on public.state_program_goals for select to authenticated using(private.is_game_member(game_id));
drop policy if exists state_program_components_read on public.state_program_components;
create policy state_program_components_read on public.state_program_components for select to authenticated using(private.is_game_member(game_id));

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='state_programs')
 then alter publication supabase_realtime add table public.state_programs; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='state_program_goals')
 then alter publication supabase_realtime add table public.state_program_goals; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='state_program_components')
 then alter publication supabase_realtime add table public.state_program_components; end if;
end $$;

create or replace function private.can_edit_state_program(p_program uuid,p_user uuid)
returns boolean
language sql stable security definer
set search_path=public,private,pg_temp
as $$
 select exists(
  select 1 from public.state_programs p
  where p.id=p_program and (
   private.is_game_teacher(p.game_id)
   or p.created_by=p_user
   or p.responsible_minister_id=p_user
  )
 );
$$;
revoke execute on function private.can_edit_state_program(uuid,uuid) from public,anon,authenticated;

create or replace function public.save_state_program(
 p_game_id uuid,p_program_id uuid,p_title text,p_responsible_ministry text,p_responsible_minister_id uuid,
 p_curator_id uuid,p_national_goal text,p_start_date date,p_end_date date,p_total_budget numeric,p_expected_results text
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_role text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_responsible_ministry,'')))<3 then raise exception 'Program title and responsible ministry are required'; end if;
 if p_total_budget<0 then raise exception 'Budget cannot be negative'; end if;
 if p_end_date is not null and p_start_date is not null and p_end_date<p_start_date then raise exception 'Program end date must follow start date'; end if;
 if p_responsible_minister_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_responsible_minister_id)
 then raise exception 'Responsible minister is not a game member'; end if;
 if p_curator_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_curator_id)
 then raise exception 'Curator is not a game member'; end if;

 if p_program_id is null then
  v_role:=private.game_role(p_game_id,v_uid);
  if not private.is_game_teacher(p_game_id)
     and v_role not like '%министр%'
     and v_role not like '%правительств%'
  then raise exception 'Government member role required to create a state program'; end if;
  insert into public.state_programs(
   game_id,title,responsible_ministry,responsible_minister_id,curator_id,national_goal,start_date,end_date,total_budget,expected_results,created_by
  ) values(
   p_game_id,trim(p_title),trim(p_responsible_ministry),coalesce(p_responsible_minister_id,v_uid),p_curator_id,
   nullif(trim(coalesce(p_national_goal,'')),''),p_start_date,p_end_date,coalesce(p_total_budget,0),
   nullif(trim(coalesce(p_expected_results,'')),''),v_uid
  ) returning id into v_id;
 else
  if not private.can_edit_state_program(p_program_id,v_uid) then raise exception 'Program editing access required'; end if;
  update public.state_programs set title=trim(p_title),responsible_ministry=trim(p_responsible_ministry),
   responsible_minister_id=p_responsible_minister_id,curator_id=p_curator_id,national_goal=nullif(trim(coalesce(p_national_goal,'')),''),
   start_date=p_start_date,end_date=p_end_date,total_budget=coalesce(p_total_budget,0),
   expected_results=nullif(trim(coalesce(p_expected_results,'')),''),updated_at=now()
  where id=p_program_id and game_id=p_game_id returning id into v_id;
 end if;
 return v_id;
end;
$$;
revoke all on function public.save_state_program(uuid,uuid,text,text,uuid,uuid,text,date,date,numeric,text) from public,anon;
grant execute on function public.save_state_program(uuid,uuid,text,text,uuid,uuid,text,date,date,numeric,text) to authenticated;

create or replace function public.add_state_program_goal(
 p_program_id uuid,p_goal_text text,p_indicator_name text,p_unit text,p_baseline numeric,p_target numeric,p_target_year integer
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into p from public.state_programs where id=p_program_id;
 if p.id is null then raise exception 'Program not found'; end if;
 if not private.can_edit_state_program(p.id,v_uid) then raise exception 'Program editing access required'; end if;
 if p.status not in ('draft','revision','minister_review') then raise exception 'Program structure is locked at this stage'; end if;
 if length(trim(coalesce(p_goal_text,'')))<5 or length(trim(coalesce(p_indicator_name,'')))<3 then raise exception 'Goal and indicator are required'; end if;
 insert into public.state_program_goals(program_id,game_id,goal_text,indicator_name,unit,baseline_value,target_value,target_year)
 values(p.id,p.game_id,trim(p_goal_text),trim(p_indicator_name),nullif(trim(coalesce(p_unit,'')),''),p_baseline,p_target,p_target_year)
 returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.add_state_program_goal(uuid,text,text,text,numeric,numeric,integer) from public,anon;
grant execute on function public.add_state_program_goal(uuid,text,text,text,numeric,numeric,integer) to authenticated;

create or replace function public.add_state_program_component(
 p_program_id uuid,p_direction_no integer,p_direction_title text,p_component_kind text,p_title text,p_goal_text text,p_start_date date,p_end_date date,p_budget numeric
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;v_total integer;v_kind_count integer;
begin
 select * into p from public.state_programs where id=p_program_id;
 if p.id is null then raise exception 'Program not found'; end if;
 if not private.can_edit_state_program(p.id,v_uid) then raise exception 'Program editing access required'; end if;
 if p.status not in ('draft','revision','minister_review') then raise exception 'Program structure is locked at this stage'; end if;
 if p_direction_no not between 1 and 3 then raise exception 'The game allows no more than three program directions'; end if;
 if p_component_kind not in ('project','target_program','measure') then raise exception 'Unsupported component kind'; end if;
 if length(trim(coalesce(p_direction_title,'')))<3 or length(trim(coalesce(p_title,'')))<3 or length(trim(coalesce(p_goal_text,'')))<5 then raise exception 'Direction, title and goal are required'; end if;
 if p_budget<0 then raise exception 'Budget cannot be negative'; end if;
 select count(*)::integer into v_total from public.state_program_components where program_id=p.id;
 if v_total>=25 then raise exception 'The game allows no more than 25 measures in one state program'; end if;
 if p_component_kind in ('project','target_program') then
  select count(*)::integer into v_kind_count from public.state_program_components
  where program_id=p.id and direction_no=p_direction_no and component_kind=p_component_kind;
  if v_kind_count>=5 then raise exception 'The game allows no more than five projects and five target programs per direction'; end if;
 end if;
 insert into public.state_program_components(program_id,game_id,direction_no,direction_title,component_kind,title,goal_text,start_date,end_date,budget)
 values(p.id,p.game_id,p_direction_no,trim(p_direction_title),p_component_kind,trim(p_title),trim(p_goal_text),p_start_date,p_end_date,coalesce(p_budget,0))
 returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.add_state_program_component(uuid,integer,text,text,text,text,date,date,numeric) from public,anon;
grant execute on function public.add_state_program_component(uuid,integer,text,text,text,text,date,date,numeric) to authenticated;

create or replace function public.delete_state_program_item(p_item_type text,p_item_id uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());v_program uuid;
begin
 if p_item_type='goal' then
  select program_id into v_program from public.state_program_goals where id=p_item_id;
  if v_program is null or not private.can_edit_state_program(v_program,v_uid) then raise exception 'Program editing access required'; end if;
  delete from public.state_program_goals where id=p_item_id;
 elsif p_item_type='component' then
  select program_id into v_program from public.state_program_components where id=p_item_id;
  if v_program is null or not private.can_edit_state_program(v_program,v_uid) then raise exception 'Program editing access required'; end if;
  delete from public.state_program_components where id=p_item_id;
 else raise exception 'Unsupported item type';
 end if;
end;
$$;
revoke all on function public.delete_state_program_item(text,uuid) from public,anon;
grant execute on function public.delete_state_program_item(text,uuid) to authenticated;

create or replace function public.advance_state_program(p_program_id uuid,p_action text)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_role text;
begin
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found'; end if;
 v_role:=private.game_role(p.game_id,v_uid);

 if p_action='submit_minister' then
  if not private.can_edit_state_program(p.id,v_uid) then raise exception 'Program editing access required'; end if;
  update public.state_programs set status='minister_review',updated_at=now() where id=p.id;
 elsif p_action in ('minister_approve','minister_revision') then
  if not private.is_game_teacher(p.game_id) and p.responsible_minister_id<>v_uid then raise exception 'Responsible minister access required'; end if;
  update public.state_programs set status=case when p_action='minister_approve' then 'pm_review' else 'revision' end,updated_at=now() where id=p.id;
 elsif p_action in ('pm_ready','pm_revision') then
  if not private.is_game_teacher(p.game_id) and v_role not like '%председател%правительств%' then raise exception 'Prime Minister access required'; end if;
  update public.state_programs set status=case when p_action='pm_ready' then 'ready' else 'revision' end,updated_at=now() where id=p.id;
 else raise exception 'Unsupported program action';
 end if;
end;
$$;
revoke all on function public.advance_state_program(uuid,text) from public,anon;
grant execute on function public.advance_state_program(uuid,text) to authenticated;

create or replace function public.open_state_program_government_vote(p_program_id uuid)
returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_role text;v_vote uuid;
begin
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found'; end if;
 v_role:=private.game_role(p.game_id,v_uid);
 if not private.is_game_teacher(p.game_id) and v_role not like '%председател%правительств%' then raise exception 'Prime Minister access required'; end if;
 if p.status<>'ready' then raise exception 'Program must pass minister and Prime Minister review first'; end if;

 insert into public.game_votes(
  game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition
 ) values(
  p.game_id,11,'Государственная программа · '||p.title,
  'Решение Правительства по государственной программе. Кворум — не менее половины состава; решение при голосовании — большинством присутствующих.',
  'member','open',v_uid,'government','state_program',
  'fraction',0.5,'present_majority',0.5,true,true,'none','none'
 ) returning id into v_vote;

 update public.state_programs set status='government_vote',government_vote_id=v_vote,updated_at=now() where id=p.id;
 return v_vote;
end;
$$;
revoke all on function public.open_state_program_government_vote(uuid) from public,anon;
grant execute on function public.open_state_program_government_vote(uuid) to authenticated;

create or replace function private.state_program_vote_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
 if new.status='closed' and old.status is distinct from new.status and new.procedure_key='state_program' then
  update public.state_programs
  set status=case when new.result_code='passed' then 'adopted' else 'rejected' end,updated_at=now()
  where government_vote_id=new.id;
 end if;
 return new;
end;
$$;
revoke execute on function private.state_program_vote_trigger() from public,anon,authenticated;
drop trigger if exists trg_state_program_vote on public.game_votes;
create trigger trg_state_program_vote after update of status on public.game_votes
for each row execute function private.state_program_vote_trigger();
