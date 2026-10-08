-- Run after the municipal_presentation_links migration. Fictional fixtures only.
-- Tests the real wrapper, original editing gates, column constraint and privileges.
begin;
create function pg_temp.save_link_project(g uuid,project_id uuid,links jsonb,title text default 'QA municipal project',cost numeric default 125)
returns uuid language sql security invoker set search_path='' as $function$
 select public.save_municipal_project_with_presentations(g,project_id,'Отдел QA',title,'QA location',
  'Observed municipal problem with enough evidence detail','Classroom municipal competence',
  'A municipal solution with steps and responsible officials',cost,'Measurable improvement',links);
$function$;
create function pg_temp.save_legacy_project(g uuid,project_id uuid,cost numeric default 125,title text default 'QA legacy municipal project')
returns uuid language sql security invoker set search_path='' as $function$
 select public.save_municipal_project(g,project_id,'Отдел QA',title,'QA location',
  'Observed municipal problem with enough evidence detail','Classroom municipal competence',
  'A municipal solution with steps and responsible officials',cost,'Measurable improvement');
$function$;
do $fixture$
declare g uuid:=gen_random_uuid();other_game uuid:=gen_random_uuid();teacher_id uuid;creator_id uuid:=gen_random_uuid();viewer_id uuid:=gen_random_uuid();outsider_id uuid:=gen_random_uuid();
 observer_id uuid:=gen_random_uuid();archived_id uuid:=gen_random_uuid();suspended_id uuid:=gen_random_uuid();suspended_teacher_id uuid:=gen_random_uuid();removed_id uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();
begin
 select owner_id into teacher_id from public.games order by created_at limit 1;
 if teacher_id is null then raise exception 'QA requires a classroom owner';end if;
 insert into auth.users(id,aud,role) values(creator_id,'authenticated','authenticated'),(viewer_id,'authenticated','authenticated'),(outsider_id,'authenticated','authenticated'),
  (observer_id,'authenticated','authenticated'),(archived_id,'authenticated','authenticated'),(suspended_id,'authenticated','authenticated'),
  (suspended_teacher_id,'authenticated','authenticated'),(removed_id,'authenticated','authenticated'),(admin_id,'authenticated','authenticated');
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA municipal presentations','QA'||substr(replace(g::text,'-',''),1,12),teacher_id,'running',14,true),
       (other_game,'QA other municipality','QA'||substr(replace(other_game::text,'-',''),1,12),teacher_id,'running',14,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name)
 values(g,teacher_id,'QA teacher','teacher','Преподаватель','QA'),(other_game,teacher_id,'QA teacher','teacher','Преподаватель','QA'),
       (g,creator_id,'QA creator','student','Муниципальный служащий','QA'),(other_game,creator_id,'QA creator','student','Муниципальный служащий','QA'),
       (g,viewer_id,'QA viewer','student','Муниципальный служащий','QA'),
       (g,observer_id,'QA observer','observer','Наблюдатель','QA'),(g,archived_id,'QA archived','student','Муниципальный служащий','QA'),
       (g,suspended_id,'QA suspended student','student','Муниципальный служащий','QA'),
       (g,suspended_teacher_id,'QA suspended teacher','teacher','Преподаватель','QA'),(g,removed_id,'QA removed','student','Муниципальный служащий','QA');
 update public.game_members set roster_archived_at=now() where game_id=g and user_id=archived_id;
 insert into public.game_role_consequences(game_id,user_id,status,reason,set_by)
 values(g,suspended_id,'suspended','QA temporary suspension',teacher_id),(g,suspended_teacher_id,'suspended','QA temporary suspension',teacher_id);
 insert into public.platform_admins(user_id,granted_by) values(admin_id,teacher_id);
 -- Existing ownership alone must never re-authorize an inactive writer.
 insert into public.municipal_projects(game_id,problem_title,location_text,problem_description,legal_competence,proposed_solution,expected_effect,created_by,status)
 select g,'QA former author '||x.user_id,'QA location','Observed municipal problem with enough evidence detail','Classroom municipal competence',
  'A municipal solution with steps and responsible officials','Measurable improvement',x.user_id,'draft'
 from unnest(array[observer_id,archived_id,suspended_id,suspended_teacher_id,removed_id]) x(user_id);
 delete from public.game_members where game_id=g and user_id=removed_id;
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 values(g,14,'QA municipal stage','Учебная процедура','QA','open'),(other_game,14,'QA municipal stage','Учебная процедура','QA','open');
 perform set_config('qa.municipal_game',g::text,true);perform set_config('qa.municipal_other_game',other_game::text,true);
 perform set_config('qa.municipal_teacher',teacher_id::text,true);perform set_config('qa.municipal_creator',creator_id::text,true);
 perform set_config('qa.municipal_viewer',viewer_id::text,true);perform set_config('qa.municipal_outsider',outsider_id::text,true);
 perform set_config('qa.municipal_inactive_writers',array_to_json(array[observer_id,archived_id,suspended_id,suspended_teacher_id,removed_id])::text,true);
 perform set_config('qa.municipal_admin',admin_id::text,true);
end;
$fixture$;
set local role authenticated;
do $checks$
declare g uuid:=current_setting('qa.municipal_game')::uuid;other_game uuid:=current_setting('qa.municipal_other_game')::uuid;
 creator_id uuid:=current_setting('qa.municipal_creator')::uuid;project_id uuid;before_row jsonb;after_row jsonb;
 links jsonb:='[{"name":"  Обследование  ","url":" https://docs.google.com/presentation/d/fictional-deck/edit?usp=sharing#slide=id.g1 "},{"name":"Решение","url":"https://slides.google.com/presentation/d/second-deck/view"}]';
 bad_url text;invalid_links jsonb;blocked boolean;before_count integer;
begin
 perform set_config('request.jwt.claim.sub',creator_id::text,true);
 project_id:=pg_temp.save_link_project(g,null,links);
 perform set_config('qa.municipal_project',project_id::text,true);
 if not exists(select 1 from public.municipal_projects p where p.id=project_id and p.game_id=g and p.team_name='Отдел QA'
   and p.presentation_links='[{"name":"Обследование","url":"https://docs.google.com/presentation/d/fictional-deck/edit?usp=sharing#slide=id.g1"},{"name":"Решение","url":"https://slides.google.com/presentation/d/second-deck/view"}]'::jsonb)
 then raise exception 'FAIL one create preserves project and ordered, trimmed presentations';end if;
 perform pg_temp.save_link_project(g,project_id,'[{"name":"Новая версия","url":"https://docs.google.com/presentation/d/e/published-deck/pub?start=false"}]','Updated municipal project');
 if not exists(select 1 from public.municipal_projects where id=project_id and problem_title='Updated municipal project'
  and jsonb_array_length(presentation_links)=1 and presentation_links->0->>'name'='Новая версия')
 then raise exception 'FAIL update replaces links together with project';end if;

 perform public.save_municipal_project(g,project_id,'Отдел QA','Legacy municipal save','QA location',
  'Observed municipal problem with enough evidence detail','Classroom municipal competence',
  'A municipal solution with steps and responsible officials',125,'Measurable improvement');
 if not exists(select 1 from public.municipal_projects where id=project_id and problem_title='Legacy municipal save' and jsonb_array_length(presentation_links)=1)
 then raise exception 'FAIL legacy save compatibility preserves presentation links';end if;

 select to_jsonb(p) into before_row from public.municipal_projects p where p.id=project_id;
 foreach bad_url in array array[
  'javascript:alert(1)','http://docs.google.com/presentation/d/abc/edit','https://docs.google.com.evil.test/presentation/d/abc/edit',
  'https://evil.test@docs.google.com/presentation/d/abc/edit','https://docs.google.com@evil.test/presentation/d/abc/edit',
  'https://user:pass@docs.google.com/presentation/d/abc/edit','https://docs.google.com:443/presentation/d/abc/edit',
  'https://docs.google.com/document/d/abc/edit','https://slides.google.com/create','https://docs.google.com/presentation/d/abc/../../redirect',
  'https://docs.google.com/presentation/d/abc/edit'||chr(92)||'evil',E'https://docs.google.com/presentation/d/ab\nc/edit',
  'https://docs.google.com/presentation/d/abc/edit?x=<script>'
 ] loop
  blocked:=false;
  begin perform pg_temp.save_link_project(g,project_id,jsonb_build_array(jsonb_build_object('name','Invalid URL','url',bad_url)),'Must not save');
  exception when others then if sqlerrm not like 'Добавьте до 10 презентаций:%' then raise;end if;blocked:=true;end;
  if not blocked then raise exception 'FAIL unsafe URL accepted: %',bad_url;end if;
 end loop;
 select to_jsonb(p) into after_row from public.municipal_projects p where p.id=project_id;
 if before_row is distinct from after_row then raise exception 'FAIL rejected links changed project fields';end if;

 foreach invalid_links in array array[
  null::jsonb,'null'::jsonb,'{}'::jsonb,'[{}]'::jsonb,
  jsonb_build_array(jsonb_build_object('name',' ','url','https://docs.google.com/presentation/d/abc/edit')),
  jsonb_build_array(jsonb_build_object('name',repeat('x',121),'url','https://docs.google.com/presentation/d/abc/edit')),
  jsonb_build_array(jsonb_build_object('name','Slides','url','https://docs.google.com/presentation/d/abc/edit?x='||repeat('x',2048))),
  (select jsonb_agg(jsonb_build_object('name','Slides '||n,'url','https://docs.google.com/presentation/d/abc/edit')) from generate_series(1,11) n)
 ] loop
  select count(*) into before_count from public.municipal_projects where game_id=g;
  blocked:=false;begin perform pg_temp.save_link_project(g,null,invalid_links);
  exception when others then if sqlerrm not like 'Добавьте до 10 презентаций:%' then raise;end if;blocked:=true;end;
  if not blocked or (select count(*) from public.municipal_projects where game_id=g)<>before_count
  then raise exception 'FAIL invalid shape/name/count/length must reject without creating a project';end if;
 end loop;

 blocked:=false;begin perform pg_temp.save_link_project(other_game,project_id,'[]');
 exception when others then if sqlerrm<>'Project not found in this game' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'FAIL cross-game project update';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.municipal_viewer'),true);
 blocked:=false;begin perform pg_temp.save_link_project(g,project_id,'[]');
 exception when others then if sqlerrm<>'Project editing access required' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'FAIL non-editor member update';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.municipal_outsider'),true);
 blocked:=false;begin perform pg_temp.save_link_project(g,null,'[]');
 exception when others then if sqlerrm<>'Game access required' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'FAIL outsider project creation';end if;

 perform set_config('request.jwt.claim.sub',creator_id::text,true);
 perform pg_temp.save_link_project(g,project_id,'[]');
 if not exists(select 1 from public.municipal_projects where id=project_id and presentation_links='[]'::jsonb)
 then raise exception 'FAIL optional presentations can be removed';end if;
 if has_function_privilege('anon','public.save_municipal_project_with_presentations(uuid,uuid,text,text,text,text,text,text,numeric,text,jsonb)','EXECUTE')
  or has_function_privilege('service_role','public.save_municipal_project_with_presentations(uuid,uuid,text,text,text,text,text,text,numeric,text,jsonb)','EXECUTE')
  or not has_function_privilege('authenticated','public.save_municipal_project_with_presentations(uuid,uuid,text,text,text,text,text,text,numeric,text,jsonb)','EXECUTE')
 then raise exception 'FAIL wrapper must be authenticated-only';end if;
 if not exists(select 1 from pg_proc where oid='public.save_municipal_project_with_presentations(uuid,uuid,text,text,text,text,text,text,numeric,text,jsonb)'::regprocedure
  and prosecdef and 'search_path=""'=any(proconfig)) then raise exception 'FAIL fixed empty search_path';end if;
end;
$checks$;
reset role;
-- Keep snapshots outside RLS: removed/archived actors cannot inspect the classroom.
do $snapshot$
begin
 perform set_config('qa.municipal_before_security',(
  select jsonb_agg(to_jsonb(p) order by p.id)::text from public.municipal_projects p where p.game_id=current_setting('qa.municipal_game')::uuid
 ),true);
end;
$snapshot$;
set local role authenticated;
do $inactive_writers$
declare g uuid:=current_setting('qa.municipal_game')::uuid;uid uuid;owned_project uuid;endpoint integer;blocked boolean;
begin
 for uid in select value::uuid from jsonb_array_elements_text(current_setting('qa.municipal_inactive_writers')::jsonb) loop
  -- The generated owned-project IDs can be recovered before changing the actor.
  perform set_config('request.jwt.claim.sub',current_setting('qa.municipal_teacher'),true);
  select id into owned_project from public.municipal_projects where game_id=g and created_by=uid;
  if owned_project is null then raise exception 'FAIL inactive writer fixture needs an owned project';end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  for endpoint in 0..1 loop
   blocked:=false;
   begin
    if endpoint=0 then perform pg_temp.save_link_project(g,null,'[]');else perform pg_temp.save_legacy_project(g,null);end if;
   exception when others then if sqlerrm<>'Game access required' then raise;end if;blocked:=true;end;
   if not blocked then raise exception 'FAIL inactive writer creates project through endpoint %',endpoint;end if;
   blocked:=false;
   begin
    if endpoint=0 then perform pg_temp.save_link_project(g,owned_project,'[]','Must not save inactive draft');
    else perform pg_temp.save_legacy_project(g,owned_project,125,'Must not save inactive draft');end if;
   exception when others then if sqlerrm<>'Game access required' then raise;end if;blocked:=true;end;
   if not blocked then raise exception 'FAIL inactive existing owner updates project through endpoint %',endpoint;end if;
  end loop;
 end loop;
end;
$inactive_writers$;
do $finite_costs$
declare g uuid:=current_setting('qa.municipal_game')::uuid;project_id uuid:=current_setting('qa.municipal_project')::uuid;
 endpoint integer;bad_cost numeric;blocked boolean;cost_values numeric[]:=array['NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric,-1,1000000000000001];
begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.municipal_creator'),true);
 foreach bad_cost in array cost_values loop
  for endpoint in 0..1 loop
   blocked:=false;
   begin
    if endpoint=0 then perform pg_temp.save_link_project(g,null,'[]','Must not create invalid cost',bad_cost);
    else perform pg_temp.save_legacy_project(g,null,bad_cost,'Must not create invalid cost');end if;
   exception when others then if sqlerrm<>'Cost must be finite, nonnegative and not exceed 1000000000000000' then raise;end if;blocked:=true;end;
   if not blocked then raise exception 'FAIL invalid cost creates project through endpoint %: %',endpoint,bad_cost;end if;
   blocked:=false;
   begin
    if endpoint=0 then perform pg_temp.save_link_project(g,project_id,'[{"name":"Must not save","url":"https://docs.google.com/presentation/d/abc/edit"}]','Must not update invalid cost',bad_cost);
    else perform pg_temp.save_legacy_project(g,project_id,bad_cost,'Must not update invalid cost');end if;
   exception when others then if sqlerrm<>'Cost must be finite, nonnegative and not exceed 1000000000000000' then raise;end if;blocked:=true;end;
   if not blocked then raise exception 'FAIL invalid cost updates project through endpoint %: %',endpoint,bad_cost;end if;
  end loop;
 end loop;
end;
$finite_costs$;
reset role;
do $no_partial_writes$
begin
 if current_setting('qa.municipal_before_security')::jsonb is distinct from (
  select jsonb_agg(to_jsonb(p) order by p.id) from public.municipal_projects p where p.game_id=current_setting('qa.municipal_game')::uuid
 ) then raise exception 'FAIL rejected actors/costs produced partial project or presentation writes';end if;
end;
$no_partial_writes$;
set local role authenticated;
do $valid_costs_and_admin$
declare g uuid:=current_setting('qa.municipal_game')::uuid;project_id uuid;legacy_id uuid;bad_cost numeric;blocked boolean;
begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.municipal_creator'),true);
 project_id:=pg_temp.save_link_project(g,null,'[]','QA zero municipal cost',0);
 if not exists(select 1 from public.municipal_projects where id=project_id and estimated_cost=0) then raise exception 'FAIL zero cost remains valid';end if;
 legacy_id:=pg_temp.save_legacy_project(g,null,null,'QA legacy default zero cost');
 if not exists(select 1 from public.municipal_projects where id=legacy_id and estimated_cost=0) then raise exception 'FAIL legacy null cost still defaults to zero';end if;
 project_id:=pg_temp.save_link_project(g,null,'[]','QA maximum municipal cost',1000000000000000);
 if not exists(select 1 from public.municipal_projects where id=project_id and estimated_cost=1000000000000000) then raise exception 'FAIL upper boundary remains valid';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.municipal_admin'),true);
 project_id:=pg_temp.save_link_project(g,null,'[]','QA platform administrator without classroom membership',125);
 if not exists(select 1 from public.municipal_projects where id=project_id and created_by=current_setting('qa.municipal_admin')::uuid)
 then raise exception 'FAIL platform administrator membership exception';end if;
 foreach bad_cost in array array['NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric] loop
  blocked:=false;begin perform pg_temp.save_link_project(g,project_id,'[]','Must not save administrator invalid cost',bad_cost);
  exception when others then if sqlerrm<>'Cost must be finite, nonnegative and not exceed 1000000000000000' then raise;end if;blocked:=true;end;
  if not blocked then raise exception 'FAIL administrator bypassed finite-cost requirement';end if;
 end loop;
end;
$valid_costs_and_admin$;
reset role;
do $locked_setup$
declare project_id uuid:=current_setting('qa.municipal_project')::uuid;blocked boolean:=false;
begin
 begin update public.municipal_projects set presentation_links='[{"name":"Invalid","url":"javascript:alert(1)"}]' where id=project_id;
 exception when check_violation then blocked:=true;end;
 if not blocked then raise exception 'FAIL column CHECK protects direct writes';end if;
 update public.municipal_projects set status='submitted' where id=project_id;
end;
$locked_setup$;
set local role authenticated;
do $locked_check$
declare g uuid:=current_setting('qa.municipal_game')::uuid;project_id uuid:=current_setting('qa.municipal_project')::uuid;blocked boolean:=false;before_row jsonb;
begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.municipal_teacher'),true);
 select to_jsonb(p) into before_row from public.municipal_projects p where p.id=project_id;
 begin perform pg_temp.save_link_project(g,project_id,'[{"name":"Valid slides","url":"https://docs.google.com/presentation/d/abc/edit"}]','Must not update locked project');
 exception when others then if sqlerrm<>'Submitted project is locked' then raise;end if;blocked:=true;end;
 if not blocked or before_row is distinct from (select to_jsonb(p) from public.municipal_projects p where p.id=project_id)
 then raise exception 'FAIL submitted project remains locked even for teacher';end if;
end;
$locked_check$;
reset role;
update public.municipal_projects set status='adopted' where id=current_setting('qa.municipal_project')::uuid;
set local role authenticated;
do $adopted_check$
declare blocked boolean:=false;
begin
 begin perform pg_temp.save_link_project(current_setting('qa.municipal_game')::uuid,current_setting('qa.municipal_project')::uuid,'[]');
 exception when others then if sqlerrm<>'Submitted project is locked' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'FAIL adopted project remains locked';end if;
end;
$adopted_check$;
reset role;
select jsonb_build_object('atomic_create_update','PASS','ordered_named_links','PASS','legacy_compatibility','PASS','optional_links','PASS',
 'unsafe_urls','PASS','shape_name_count_length','PASS','no_partial_writes','PASS','same_game_binding','PASS','editor_and_member_gates','PASS',
 'submitted_adopted_lock','PASS','column_constraint','PASS','authenticated_only','PASS','fixed_search_path','PASS',
 'active_student_teacher_only','PASS','observer_archived_suspended_removed_blocked','PASS','both_endpoints_secured','PASS',
 'finite_nonnegative_bounded_cost','PASS','no_actor_cost_partial_writes','PASS','platform_admin_exception','PASS','legacy_null_cost_compatibility','PASS') checks;
rollback;
