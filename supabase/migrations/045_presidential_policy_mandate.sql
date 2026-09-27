-- Stage 10 policy mandate + state-program readiness.
create table if not exists public.presidential_addresses(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no integer not null default 10,
  title text not null,
  body_text text not null default '',
  video_url text,
  status text not null default 'draft' check(status in ('draft','published')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create table if not exists public.presidential_priorities(
  id uuid primary key default gen_random_uuid(),
  address_id uuid not null references public.presidential_addresses(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  priority_no integer not null check(priority_no between 1 and 50),
  title text not null,
  description text,
  national_goal text,
  created_at timestamptz not null default now(),
  unique(address_id,priority_no)
);
alter table public.state_programs add column if not exists presidential_priority_id uuid references public.presidential_priorities(id) on delete set null;
create index if not exists presidential_addresses_game_idx on public.presidential_addresses(game_id,created_at desc);
create index if not exists presidential_priorities_game_idx on public.presidential_priorities(game_id,address_id,priority_no);
create index if not exists state_programs_priority_idx on public.state_programs(presidential_priority_id);
alter table public.presidential_addresses enable row level security;
alter table public.presidential_priorities enable row level security;
revoke all privileges on table public.presidential_addresses from anon,authenticated;
revoke all privileges on table public.presidential_priorities from anon,authenticated;
grant select on table public.presidential_addresses to authenticated;
grant select on table public.presidential_priorities to authenticated;
drop policy if exists presidential_addresses_read on public.presidential_addresses;
create policy presidential_addresses_read on public.presidential_addresses for select to authenticated using(private.is_game_member(game_id));
drop policy if exists presidential_priorities_read on public.presidential_priorities;
create policy presidential_priorities_read on public.presidential_priorities for select to authenticated using(private.is_game_member(game_id));
do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_addresses')
 then alter publication supabase_realtime add table public.presidential_addresses; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_priorities')
 then alter publication supabase_realtime add table public.presidential_priorities; end if;
end $$;
create or replace function private.can_manage_presidential_policy(p_game uuid,p_user uuid) returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select private.is_game_teacher(p_game) or private.game_role(p_game,p_user) like '%президент%';
$$;
revoke execute on function private.can_manage_presidential_policy(uuid,uuid) from public,anon,authenticated;
create or replace function public.save_presidential_address(p_game_id uuid,p_address_id uuid,p_title text,p_body_text text,p_video_url text default null) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;
begin
 if v_uid is null or not private.can_manage_presidential_policy(p_game_id,v_uid) then raise exception 'President / teacher access required'; end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Address title is required'; end if;
 if length(trim(coalesce(p_body_text,'')))<20 then raise exception 'Add the policy content of the address'; end if;
 if p_address_id is null then
  insert into public.presidential_addresses(game_id,title,body_text,video_url,created_by)
  values(p_game_id,trim(p_title),trim(p_body_text),nullif(trim(coalesce(p_video_url,'')),''),v_uid) returning id into v_id;
 else
  if not exists(select 1 from public.presidential_addresses where id=p_address_id and game_id=p_game_id) then raise exception 'Address not found'; end if;
  update public.presidential_addresses set title=trim(p_title),body_text=trim(p_body_text),video_url=nullif(trim(coalesce(p_video_url,'')),''),updated_at=now()
  where id=p_address_id and status='draft' returning id into v_id;
  if v_id is null then raise exception 'Published address is locked'; end if;
 end if;
 return v_id;
end;$$;
revoke all on function public.save_presidential_address(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.save_presidential_address(uuid,uuid,text,text,text) to authenticated;
create or replace function public.add_presidential_priority(p_address_id uuid,p_priority_no integer,p_title text,p_description text default null,p_national_goal text default null) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.presidential_addresses%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into a from public.presidential_addresses where id=p_address_id for update;
 if a.id is null then raise exception 'Address not found'; end if;
 if not private.can_manage_presidential_policy(a.game_id,v_uid) then raise exception 'President / teacher access required'; end if;
 if a.status<>'draft' then raise exception 'Published address is locked'; end if;
 if p_priority_no<1 or p_priority_no>50 then raise exception 'Priority number is out of range'; end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Priority title is required'; end if;
 insert into public.presidential_priorities(address_id,game_id,priority_no,title,description,national_goal)
 values(a.id,a.game_id,p_priority_no,trim(p_title),nullif(trim(coalesce(p_description,'')),''),nullif(trim(coalesce(p_national_goal,'')),''))
 on conflict(address_id,priority_no) do update set title=excluded.title,description=excluded.description,national_goal=excluded.national_goal returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.add_presidential_priority(uuid,integer,text,text,text) from public,anon;
grant execute on function public.add_presidential_priority(uuid,integer,text,text,text) to authenticated;
create or replace function public.delete_presidential_priority(p_priority_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_priorities%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into p from public.presidential_priorities where id=p_priority_id;
 if p.id is null then return; end if;
 if not private.can_manage_presidential_policy(p.game_id,v_uid) then raise exception 'President / teacher access required'; end if;
 if exists(select 1 from public.presidential_addresses where id=p.address_id and status='published') then raise exception 'Published address is locked'; end if;
 delete from public.presidential_priorities where id=p.id;
end;$$;
revoke all on function public.delete_presidential_priority(uuid) from public,anon;
grant execute on function public.delete_presidential_priority(uuid) to authenticated;
create or replace function public.publish_presidential_address(p_address_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.presidential_addresses%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into a from public.presidential_addresses where id=p_address_id for update;
 if a.id is null then raise exception 'Address not found'; end if;
 if not private.can_manage_presidential_policy(a.game_id,v_uid) then raise exception 'President / teacher access required'; end if;
 if not exists(select 1 from public.presidential_priorities where address_id=a.id) then raise exception 'Add at least one policy priority before publication'; end if;
 update public.presidential_addresses set status='published',published_at=now(),updated_at=now() where id=a.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(a.game_id,10,'Послание Президента','notice','Опубликовано послание Президента Федеральному Собранию',a.title,v_uid);
end;$$;
revoke all on function public.publish_presidential_address(uuid) from public,anon;
grant execute on function public.publish_presidential_address(uuid) to authenticated;
create or replace function public.link_state_program_priority(p_program_id uuid,p_priority_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found'; end if;
 if not private.can_edit_state_program(p.id,v_uid) then raise exception 'Program editing access required'; end if;
 if p_priority_id is not null and not exists(
   select 1 from public.presidential_priorities pr join public.presidential_addresses a on a.id=pr.address_id
   where pr.id=p_priority_id and pr.game_id=p.game_id and a.status='published'
 ) then raise exception 'Priority must belong to a published presidential address in this game'; end if;
 update public.state_programs set presidential_priority_id=p_priority_id,updated_at=now() where id=p.id;
end;$$;
revoke all on function public.link_state_program_priority(uuid,uuid) from public,anon;
grant execute on function public.link_state_program_priority(uuid,uuid) to authenticated;
create or replace function private.state_program_readiness_json(p_program_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare p public.state_programs%rowtype;v_goals integer;v_components integer;v_dirs integer;v_component_budget numeric;v_has_published_address boolean;v_issues jsonb:='[]'::jsonb;
begin
 select * into p from public.state_programs where id=p_program_id;
 if p.id is null then return jsonb_build_object('ready',false,'issues',jsonb_build_array('Программа не найдена')); end if;
 select count(*) into v_goals from public.state_program_goals where program_id=p.id;
 select count(*),count(distinct direction_no),coalesce(sum(budget),0) into v_components,v_dirs,v_component_budget from public.state_program_components where program_id=p.id;
 select exists(select 1 from public.presidential_addresses where game_id=p.game_id and status='published') into v_has_published_address;
 if nullif(trim(coalesce(p.national_goal,'')),'') is null then v_issues:=v_issues||jsonb_build_array('Не выбрана национальная цель'); end if;
 if p.start_date is null or p.end_date is null then v_issues:=v_issues||jsonb_build_array('Не указан полный срок реализации'); end if;
 if p.total_budget<=0 then v_issues:=v_issues||jsonb_build_array('Не задан общий бюджет программы'); end if;
 if length(trim(coalesce(p.expected_results,'')))<5 then v_issues:=v_issues||jsonb_build_array('Не заполнены ожидаемые результаты'); end if;
 if v_goals<1 then v_issues:=v_issues||jsonb_build_array('Нет целей с измеримыми показателями'); end if;
 if v_dirs<>3 then v_issues:=v_issues||jsonb_build_array('По правилам этапов 10–11 программа должна содержать три направления'); end if;
 if v_components<3 then v_issues:=v_issues||jsonb_build_array('Недостаточно структурных элементов программы'); end if;
 if v_components>25 then v_issues:=v_issues||jsonb_build_array('Превышен лимит 25 структурных элементов'); end if;
 if v_component_budget>p.total_budget then v_issues:=v_issues||jsonb_build_array('Сумма бюджетов структурных элементов превышает общий бюджет программы'); end if;
 if exists(select 1 from public.state_program_components where program_id=p.id and (start_date is null or end_date is null)) then v_issues:=v_issues||jsonb_build_array('Не у всех структурных элементов указаны сроки'); end if;
 if v_has_published_address and p.presidential_priority_id is null then v_issues:=v_issues||jsonb_build_array('Программа не связана с опубликованным приоритетом послания Президента'); end if;
 return jsonb_build_object('ready',jsonb_array_length(v_issues)=0,'issues',v_issues,'goals',v_goals,'directions',v_dirs,'components',v_components,'component_budget',v_component_budget,'total_budget',p.total_budget);
end;$$;
revoke execute on function private.state_program_readiness_json(uuid) from public,anon,authenticated;
create or replace function public.get_state_program_readiness(p_program_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into p from public.state_programs where id=p_program_id;
 if p.id is null then raise exception 'Program not found'; end if;
 if v_uid is null or not private.is_game_member(p.game_id) then raise exception 'Game access required'; end if;
 return private.state_program_readiness_json(p.id);
end;$$;
revoke all on function public.get_state_program_readiness(uuid) from public,anon;
grant execute on function public.get_state_program_readiness(uuid) to authenticated;
create or replace function public.advance_state_program(p_program_id uuid,p_action text) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_role text;v_ready jsonb;
begin
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found'; end if;
 v_role:=private.game_role(p.game_id,v_uid);
 if p_action='submit_minister' then
  if not private.can_edit_state_program(p.id,v_uid) then raise exception 'Program editing access required'; end if;
  v_ready:=private.state_program_readiness_json(p.id);
  if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Program is not ready: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;
  update public.state_programs set status='minister_review',updated_at=now() where id=p.id;
 elsif p_action in ('minister_approve','minister_revision') then
  if not private.is_game_teacher(p.game_id) and p.responsible_minister_id<>v_uid then raise exception 'Responsible minister access required'; end if;
  update public.state_programs set status=case when p_action='minister_approve' then 'pm_review' else 'revision' end,updated_at=now() where id=p.id;
 elsif p_action in ('pm_ready','pm_revision') then
  if not private.is_game_teacher(p.game_id) and v_role not like '%председател%правительств%' then raise exception 'Prime Minister access required'; end if;
  update public.state_programs set status=case when p_action='pm_ready' then 'ready' else 'revision' end,updated_at=now() where id=p.id;
 else raise exception 'Unsupported program action'; end if;
end;$$;
revoke all on function public.advance_state_program(uuid,text) from public,anon;
grant execute on function public.advance_state_program(uuid,text) to authenticated;