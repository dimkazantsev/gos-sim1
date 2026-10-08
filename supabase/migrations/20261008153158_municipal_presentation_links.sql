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
 if (select auth.uid()) is null or not private.is_game_member(p_game_id)
 then raise exception 'Game access required'; end if;
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
