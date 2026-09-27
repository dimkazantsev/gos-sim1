-- Stage 14 municipal field-research projects with private media evidence and final municipal vote.

create table if not exists public.municipal_projects(
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no integer not null default 14,
  team_name text,
  problem_title text not null,
  location_text text not null,
  problem_description text not null,
  legal_competence text not null,
  proposed_solution text not null,
  estimated_cost numeric not null default 0 check(estimated_cost>=0),
  expected_effect text not null,
  status text not null default 'fieldwork'
    check(status in ('fieldwork','draft','submitted','vote_open','adopted','rejected')),
  vote_id uuid references public.game_votes(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists public.municipal_project_members(
  project_id uuid not null references public.municipal_projects(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key(project_id,user_id)
);

create table if not exists public.municipal_project_evidence(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.municipal_projects(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  media_kind text not null check(media_kind in ('image','video','audio','file')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists municipal_projects_game_idx on public.municipal_projects(game_id,status,created_at);
create index if not exists municipal_project_members_user_idx on public.municipal_project_members(game_id,user_id);
create index if not exists municipal_project_evidence_project_idx on public.municipal_project_evidence(project_id,created_at);

alter table public.municipal_projects enable row level security;
alter table public.municipal_project_members enable row level security;
alter table public.municipal_project_evidence enable row level security;
revoke all privileges on table public.municipal_projects from anon,authenticated;
revoke all privileges on table public.municipal_project_members from anon,authenticated;
revoke all privileges on table public.municipal_project_evidence from anon,authenticated;
grant select on table public.municipal_projects to authenticated;
grant select on table public.municipal_project_members to authenticated;
grant select on table public.municipal_project_evidence to authenticated;

drop policy if exists municipal_projects_read on public.municipal_projects;
create policy municipal_projects_read on public.municipal_projects for select to authenticated using(private.is_game_member(game_id));
drop policy if exists municipal_members_read on public.municipal_project_members;
create policy municipal_members_read on public.municipal_project_members for select to authenticated using(private.is_game_member(game_id));
drop policy if exists municipal_evidence_read on public.municipal_project_evidence;
create policy municipal_evidence_read on public.municipal_project_evidence for select to authenticated using(private.is_game_member(game_id));

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='municipal_projects')
 then alter publication supabase_realtime add table public.municipal_projects; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='municipal_project_members')
 then alter publication supabase_realtime add table public.municipal_project_members; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='municipal_project_evidence')
 then alter publication supabase_realtime add table public.municipal_project_evidence; end if;
end $$;

create or replace function private.can_edit_municipal_project(p_project uuid,p_user uuid)
returns boolean
language sql stable security definer
set search_path=public,private,pg_temp
as $$
 select exists(
  select 1 from public.municipal_projects p
  where p.id=p_project and (
   private.is_game_teacher(p.game_id) or p.created_by=p_user
   or exists(select 1 from public.municipal_project_members m where m.project_id=p.id and m.user_id=p_user)
  )
 );
$$;
revoke execute on function private.can_edit_municipal_project(uuid,uuid) from public,anon,authenticated;

create or replace function public.save_municipal_project(
 p_game_id uuid,p_project_id uuid,p_team_name text,p_problem_title text,p_location_text text,p_problem_description text,
 p_legal_competence text,p_proposed_solution text,p_estimated_cost numeric,p_expected_effect text
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 if length(trim(coalesce(p_problem_title,'')))<5 or length(trim(coalesce(p_location_text,'')))<3
    or length(trim(coalesce(p_problem_description,'')))<20 or length(trim(coalesce(p_legal_competence,'')))<10
    or length(trim(coalesce(p_proposed_solution,'')))<20 or length(trim(coalesce(p_expected_effect,'')))<10
 then raise exception 'Complete the problem, location, competence, solution and expected effect'; end if;
 if p_estimated_cost<0 then raise exception 'Cost cannot be negative'; end if;

 if p_project_id is null then
  insert into public.municipal_projects(
   game_id,team_name,problem_title,location_text,problem_description,legal_competence,proposed_solution,estimated_cost,expected_effect,created_by,status
  ) values(
   p_game_id,nullif(trim(coalesce(p_team_name,'')),''),trim(p_problem_title),trim(p_location_text),trim(p_problem_description),
   trim(p_legal_competence),trim(p_proposed_solution),coalesce(p_estimated_cost,0),trim(p_expected_effect),v_uid,'draft'
  ) returning id into v_id;
  insert into public.municipal_project_members(project_id,game_id,user_id) values(v_id,p_game_id,v_uid) on conflict do nothing;
 else
  if not private.can_edit_municipal_project(p_project_id,v_uid) then raise exception 'Project editing access required'; end if;
  if exists(select 1 from public.municipal_projects where id=p_project_id and status not in ('fieldwork','draft'))
  then raise exception 'Submitted project is locked'; end if;
  update public.municipal_projects set team_name=nullif(trim(coalesce(p_team_name,'')),''),
   problem_title=trim(p_problem_title),location_text=trim(p_location_text),problem_description=trim(p_problem_description),
   legal_competence=trim(p_legal_competence),proposed_solution=trim(p_proposed_solution),estimated_cost=coalesce(p_estimated_cost,0),
   expected_effect=trim(p_expected_effect),status='draft',updated_at=now()
  where id=p_project_id returning id into v_id;
 end if;
 return v_id;
end;
$$;
revoke all on function public.save_municipal_project(uuid,uuid,text,text,text,text,text,text,numeric,text) from public,anon;
grant execute on function public.save_municipal_project(uuid,uuid,text,text,text,text,text,text,numeric,text) to authenticated;

create or replace function public.add_municipal_project_member(p_project_id uuid,p_user_id uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.municipal_projects%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into p from public.municipal_projects where id=p_project_id;
 if p.id is null then raise exception 'Project not found'; end if;
 if not private.is_game_teacher(p.game_id) and p.created_by<>v_uid then raise exception 'Project owner access required'; end if;
 if not exists(select 1 from public.game_members where game_id=p.game_id and user_id=p_user_id and kind='student') then raise exception 'Student not found'; end if;
 insert into public.municipal_project_members(project_id,game_id,user_id) values(p.id,p.game_id,p_user_id) on conflict do nothing;
end;
$$;
revoke all on function public.add_municipal_project_member(uuid,uuid) from public,anon;
grant execute on function public.add_municipal_project_member(uuid,uuid) to authenticated;

create or replace function public.register_municipal_evidence(
 p_project_id uuid,p_media_kind text,p_storage_path text,p_file_name text,p_mime_type text,p_file_size bigint,p_note text default null
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.municipal_projects%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;v_prefix text;
begin
 select * into p from public.municipal_projects where id=p_project_id;
 if p.id is null then raise exception 'Project not found'; end if;
 if not private.can_edit_municipal_project(p.id,v_uid) then raise exception 'Project editing access required'; end if;
 if p.status not in ('fieldwork','draft') then raise exception 'Project evidence is locked'; end if;
 if p_media_kind not in ('image','video','audio','file') then raise exception 'Unsupported evidence type'; end if;
 v_prefix:=p.game_id::text||'/municipal/'||p.id::text||'/';
 if left(p_storage_path,length(v_prefix))<>v_prefix then raise exception 'Invalid evidence path'; end if;
 insert into public.municipal_project_evidence(project_id,game_id,uploaded_by,media_kind,storage_path,file_name,mime_type,file_size,note)
 values(p.id,p.game_id,v_uid,p_media_kind,p_storage_path,p_file_name,p_mime_type,p_file_size,nullif(trim(coalesce(p_note,'')),''))
 returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.register_municipal_evidence(uuid,text,text,text,text,bigint,text) from public,anon;
grant execute on function public.register_municipal_evidence(uuid,text,text,text,text,bigint,text) to authenticated;

drop policy if exists game_assets_municipal_insert on storage.objects;
create policy game_assets_municipal_insert on storage.objects
for insert to authenticated
with check(
 bucket_id='game-assets'
 and split_part(name,'/',2)='municipal'
 and private.is_game_member((split_part(name,'/',1))::uuid)
 and private.can_edit_municipal_project((split_part(name,'/',3))::uuid,(select auth.uid()))
);

create or replace function public.submit_municipal_project(p_project_id uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.municipal_projects%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into p from public.municipal_projects where id=p_project_id for update;
 if p.id is null then raise exception 'Project not found'; end if;
 if not private.can_edit_municipal_project(p.id,v_uid) then raise exception 'Project editing access required'; end if;
 if p.status not in ('fieldwork','draft') then raise exception 'Project is already submitted'; end if;
 if not exists(select 1 from public.municipal_project_evidence where project_id=p.id) then
  raise exception 'Attach at least one field-research evidence file before submission';
 end if;
 update public.municipal_projects set status='submitted',submitted_at=now(),updated_at=now() where id=p.id;
end;
$$;
revoke all on function public.submit_municipal_project(uuid) from public,anon;
grant execute on function public.submit_municipal_project(uuid) to authenticated;

create or replace function public.open_municipal_project_vote(p_project_id uuid)
returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.municipal_projects%rowtype;v_uid uuid:=(select auth.uid());v_vote uuid;
begin
 select * into p from public.municipal_projects where id=p_project_id for update;
 if p.id is null then raise exception 'Project not found'; end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Teacher access required'; end if;
 if p.status<>'submitted' then raise exception 'Project must be submitted first'; end if;
 insert into public.game_votes(
  game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key,
  quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition
 ) values(
  p.game_id,14,'Муниципальный проект · '||p.problem_title,
  p.proposed_solution,'member','open',v_uid,'municipality','municipal_project',
  'none',0,'present_majority',0.5,true,false,'none','none'
 ) returning id into v_vote;
 update public.municipal_projects set status='vote_open',vote_id=v_vote,updated_at=now() where id=p.id;
 return v_vote;
end;
$$;
revoke all on function public.open_municipal_project_vote(uuid) from public,anon;
grant execute on function public.open_municipal_project_vote(uuid) to authenticated;

create or replace function private.municipal_project_vote_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
 if new.status='closed' and old.status is distinct from new.status and new.procedure_key='municipal_project' then
  update public.municipal_projects set status=case when new.result_code='passed' then 'adopted' else 'rejected' end,updated_at=now()
  where vote_id=new.id;
 end if;
 return new;
end;
$$;
revoke execute on function private.municipal_project_vote_trigger() from public,anon,authenticated;
drop trigger if exists trg_municipal_project_vote on public.game_votes;
create trigger trg_municipal_project_vote after update of status on public.game_votes
for each row execute function private.municipal_project_vote_trigger();
