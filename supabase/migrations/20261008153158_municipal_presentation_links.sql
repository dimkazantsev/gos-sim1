-- Named Google Slides references belong to the same saved municipal project.
-- No remote content is fetched, and existing callers retain their old RPC.
create function private.municipal_presentation_links_valid(p_links jsonb)
returns boolean
language plpgsql immutable security invoker
set search_path = ''
as $function$
declare item jsonb; link_url text; link_name text;
begin
 if p_links is null or jsonb_typeof(p_links)<>'array' then return false; end if;
 if jsonb_array_length(p_links)>10 then return false; end if;
 for item in select value from jsonb_array_elements(p_links) loop
  if jsonb_typeof(item)<>'object'
     or jsonb_typeof(item->'name') is distinct from 'string'
     or jsonb_typeof(item->'url') is distinct from 'string' then return false; end if;
  link_name:=trim(item->>'name'); link_url:=trim(item->>'url');
  if length(link_name) not between 1 and 120 or link_name~'[[:cntrl:]]'
     or length(link_url)>2048 or link_url~'[[:cntrl:][:space:]<>]'
     or position(chr(92) in link_url)>0 then return false; end if;
  if link_url!~'^https://((docs|slides)\.google\.com/presentation/d/|slides\.google\.com/d/)(e/)?[A-Za-z0-9_-]+(/(edit|view|present|preview|embed|copy|pub|pubembed))?/?([?#][^[:space:]<>]*)?$'
  then return false; end if;
 end loop;
 return true;
end;
$function$;
revoke all on function private.municipal_presentation_links_valid(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.municipal_presentation_links_valid(jsonb) to authenticated,service_role;

alter table public.municipal_projects
 add column presentation_links jsonb not null default '[]'::jsonb,
 add constraint municipal_projects_presentation_links_valid
 check(private.municipal_presentation_links_valid(presentation_links));

-- Both endpoints require a current writer, including former project owners.
-- Lock the actor before reading eligibility so an archive/removal cannot race a save.
create function private.require_municipal_project_writer(p_game_id uuid,p_estimated_cost numeric)
returns uuid
language plpgsql volatile security invoker
set search_path = ''
as $function$
declare writer_id uuid:=(select auth.uid());actor public.game_members%rowtype;
begin
 if writer_id is null then raise exception 'Game access required'; end if;
 if not private.is_platform_admin() then
  select * into actor from public.game_members where game_id=p_game_id and user_id=writer_id for update;
  if not found or actor.kind not in ('student','teacher') or actor.roster_archived_at is not null
     or not private.role_is_available(p_game_id,writer_id)
  then raise exception 'Game access required'; end if;
 end if;
 if coalesce(p_estimated_cost,0)::text in ('NaN','Infinity','-Infinity')
    or coalesce(p_estimated_cost,0)<0 or coalesce(p_estimated_cost,0)>1000000000000000
 then raise exception 'Cost must be finite, nonnegative and not exceed 1000000000000000'; end if;
 return writer_id;
end;
$function$;
revoke all on function private.require_municipal_project_writer(uuid,numeric) from public,anon,authenticated,service_role;

-- Preserve the original endpoint/signature and its project validation and locks,
-- while applying the same current-writer and finite-cost guard as the wrapper.
create or replace function public.save_municipal_project(
 p_game_id uuid,p_project_id uuid,p_team_name text,p_problem_title text,p_location_text text,
 p_problem_description text,p_legal_competence text,p_proposed_solution text,
 p_estimated_cost numeric,p_expected_effect text
)
returns uuid
language plpgsql security definer
set search_path = ''
as $function$
declare v_uid uuid;v_id uuid;
begin
 v_uid:=private.require_municipal_project_writer(p_game_id,p_estimated_cost);
 if length(trim(coalesce(p_problem_title,'')))<5 or length(trim(coalesce(p_location_text,'')))<3
    or length(trim(coalesce(p_problem_description,'')))<20 or length(trim(coalesce(p_legal_competence,'')))<10
    or length(trim(coalesce(p_proposed_solution,'')))<20 or length(trim(coalesce(p_expected_effect,'')))<10
 then raise exception 'Complete the problem, location, competence, solution and expected effect'; end if;
 if p_project_id is null then
  insert into public.municipal_projects(
   game_id,team_name,problem_title,location_text,problem_description,legal_competence,proposed_solution,estimated_cost,expected_effect,created_by,status
  ) values(
   p_game_id,nullif(trim(coalesce(p_team_name,'')),''),trim(p_problem_title),trim(p_location_text),trim(p_problem_description),
   trim(p_legal_competence),trim(p_proposed_solution),coalesce(p_estimated_cost,0),trim(p_expected_effect),v_uid,'draft'
  ) returning id into v_id;
  insert into public.municipal_project_members(project_id,game_id,user_id) values(v_id,p_game_id,v_uid) on conflict do nothing;
 else
  perform 1 from public.municipal_projects where id=p_project_id and game_id=p_game_id for update;
  if not found then raise exception 'Project not found in this game'; end if;
  if not private.can_edit_municipal_project(p_project_id,v_uid) then raise exception 'Project editing access required'; end if;
  if exists(select 1 from public.municipal_projects where id=p_project_id and status not in ('fieldwork','draft'))
  then raise exception 'Submitted project is locked'; end if;
  update public.municipal_projects set team_name=nullif(trim(coalesce(p_team_name,'')),''),
   problem_title=trim(p_problem_title),location_text=trim(p_location_text),problem_description=trim(p_problem_description),
   legal_competence=trim(p_legal_competence),proposed_solution=trim(p_proposed_solution),estimated_cost=coalesce(p_estimated_cost,0),
   expected_effect=trim(p_expected_effect),status='draft',updated_at=now()
  where id=p_project_id and game_id=p_game_id returning id into v_id;
 end if;
 return v_id;
end;
$function$;
revoke all on function public.save_municipal_project(uuid,uuid,text,text,text,text,text,text,numeric,text) from public,anon;
grant execute on function public.save_municipal_project(uuid,uuid,text,text,text,text,text,text,numeric,text) to authenticated;

create function public.save_municipal_project_with_presentations(
 p_game_id uuid,p_project_id uuid,p_team_name text,p_problem_title text,p_location_text text,
 p_problem_description text,p_legal_competence text,p_proposed_solution text,
 p_estimated_cost numeric,p_expected_effect text,p_presentation_links jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer
set search_path = ''
as $function$
declare saved_id uuid; normalized_links jsonb;
begin
 perform private.require_municipal_project_writer(p_game_id,p_estimated_cost);
 if not private.municipal_presentation_links_valid(p_presentation_links)
 then raise exception 'Добавьте до 10 презентаций: название до 120 символов и HTTPS-ссылка на презентацию Google до 2048 символов'; end if;

 -- Hold the existing row across both writes, including the original status check.
 if p_project_id is not null then
  perform 1 from public.municipal_projects where id=p_project_id and game_id=p_game_id for update;
  if not found then raise exception 'Project not found in this game'; end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('name',trim(value->>'name'),'url',trim(value->>'url')) order by ordinal),'[]'::jsonb)
 into normalized_links from jsonb_array_elements(p_presentation_links) with ordinality as links(value,ordinal);

 -- The original RPC remains the single authority for create/edit permissions,
 -- required project fields, cost, and the submitted/adopted project lock.
 saved_id:=public.save_municipal_project(p_game_id,p_project_id,p_team_name,p_problem_title,p_location_text,
  p_problem_description,p_legal_competence,p_proposed_solution,p_estimated_cost,p_expected_effect);
 update public.municipal_projects set presentation_links=normalized_links
 where id=saved_id and game_id=p_game_id and status in ('fieldwork','draft');
 if not found then raise exception 'Project save failed'; end if;
 return saved_id;
end;
$function$;
revoke all on function public.save_municipal_project_with_presentations(uuid,uuid,text,text,text,text,text,text,numeric,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_municipal_project_with_presentations(uuid,uuid,text,text,text,text,text,text,numeric,text,jsonb) to authenticated;
