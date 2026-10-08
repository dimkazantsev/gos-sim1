-- Fictional programs and accounts only; every write is rolled back.
begin;
do $setup$
declare g uuid:=gen_random_uuid();t uuid:=gen_random_uuid();a uuid:=gen_random_uuid();p jsonb;
begin
 insert into auth.users(id,aud,role) values(t,'authenticated','authenticated'),(a,'authenticated','authenticated');
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA component goals','QA'||substr(replace(g::text,'-',''),1,12),t,'running',11,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title)
 values(g,t,'QA teacher','teacher','Преподаватель'),(g,a,'QA author','student','Министр развития');
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 select g,n,'QA '||n,'QA','QA',case when n in(10,11) then 'open' else 'locked' end from generate_series(1,16)n;
 p:=jsonb_build_object('title','QA linked goals program','responsible_ministry','QA ministry','responsible_minister_id',a,
 'national_goal','QA national goal','participants','QA ministry and administration','start_date','2026-01-01','end_date','2026-12-31','expected_results','QA measurable result',
 'goals','[{"goal_text":"QA accessible service","indicator_name":"QA availability","unit":"%","baseline_value":"10","target_value":"90","target_year":"2026"},{"goal_text":"QA qualified staff","indicator_name":"QA availability","unit":"persons","baseline_value":"0","target_value":"20","target_year":"2026"}]'::jsonb,
 'components','[{"direction_no":1,"direction_title":"QA infrastructure","component_kind":"project","title":"QA clinics","goal_text":"QA build two clinics","start_date":"2026-01-01","end_date":"2026-12-31","goal_no":1},{"direction_no":2,"direction_title":"QA staff","component_kind":"target_program","title":"QA training","goal_text":"QA train staff","start_date":"2026-01-01","end_date":"2026-12-31","goal_no":2},{"direction_no":3,"direction_title":"QA service","component_kind":"measure","title":"QA schedule","goal_text":"QA extend service hours","start_date":"2026-01-01","end_date":"2026-12-31","goal_no":1}]'::jsonb,
 'expenses','[{"component_no":1,"indicator_name":"QA clinic equipment","justification":"QA exact cent allocation","budget_year":2026,"amount":"123.45"},{"component_no":2,"indicator_name":"QA training","justification":"QA second cent allocation","budget_year":2026,"amount":"76.55"}]'::jsonb);
 perform set_config('qa.goal_game',g::text,true);perform set_config('qa.goal_teacher',t::text,true);perform set_config('qa.goal_author',a::text,true);perform set_config('qa.goal_payload',p::text,true);
end;$setup$;
set local role authenticated;
do $checks$
declare g uuid:=current_setting('qa.goal_game')::uuid;p jsonb:=current_setting('qa.goal_payload')::jsonb;
 v_program_id uuid;foreign_program uuid;goal_id uuid;before_rows jsonb;bad jsonb;value text;blocked boolean;
begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.goal_author'),true);
 v_program_id:=public.save_state_program_draft(g,null,p,false);
 if (select count(*) from public.state_program_components c join public.state_program_goals v on v.id=c.target_goal_id and v.program_id=c.program_id and v.game_id=c.game_id where c.program_id=v_program_id)<>3 then raise exception 'FAIL persisted references';end if;
 if not exists(select 1 from public.state_program_components c join public.state_program_goals v on v.id=c.target_goal_id where c.program_id=v_program_id and c.title='QA training' and v.goal_text='QA qualified staff') then raise exception 'FAIL goal number maps to real ID, even with duplicate indicator labels';end if;
 goal_id:=(select target_goal_id from public.state_program_components where program_id=v_program_id and title='QA training');
 perform public.save_state_program_draft(g,v_program_id,p,false);
 if exists(select 1 from public.state_program_goals where id=goal_id) or (select count(*) from public.state_program_components where program_id=v_program_id and target_goal_id is not null)<>3 then raise exception 'FAIL atomic resave and new references';end if;
 if (select total_budget from public.state_programs where state_programs.id=v_program_id)<>200 or (select sum(amount) from public.state_program_expenses where program_id=v_program_id)<>200 then raise exception 'FAIL funding regression';end if;
 select jsonb_agg(to_jsonb(c) order by c.id) into before_rows from public.state_program_components c where program_id=v_program_id;
 foreach value in array array['0','-1','3','bad'] loop
  bad:=jsonb_set(p,'{components,0,goal_no}',to_jsonb(value));blocked:=false;
  begin perform public.save_state_program_draft(g,v_program_id,bad,false);exception when sqlstate 'P0001' or invalid_text_representation then blocked:=true;end;
  if not blocked or (select jsonb_agg(to_jsonb(c) order by c.id) from public.state_program_components c where program_id=v_program_id) is distinct from before_rows then raise exception 'FAIL invalid goal % or partial write',value;end if;
 end loop;
 goal_id:=(select target_goal_id from public.state_program_components where program_id=v_program_id and title='QA training');
 blocked:=false;begin perform public.delete_state_program_item('goal',goal_id);exception when foreign_key_violation then blocked:=true;end;
 if not blocked then raise exception 'FAIL deletion loses a referenced goal';end if;
 foreign_program:=public.save_state_program_draft(g,null,p,false);
 perform set_config('qa.goal_program',v_program_id::text,true);perform set_config('qa.foreign_program',foreign_program::text,true);
 -- Old clients may omit links; existing saved and signed programs stay readable.
 bad:=jsonb_set(p,'{components,0,goal_no}','null');
 perform public.save_state_program_draft(g,foreign_program,bad,false);
 if not exists(select 1 from public.state_program_components where program_id=foreign_program and title='QA clinics' and target_goal_id is null) then raise exception 'FAIL nullable legacy compatibility';end if;
 -- Linked goals survive the existing minister/PM signature and publication route.
 perform public.advance_state_program(v_program_id,'submit_minister');
 perform public.advance_state_program(v_program_id,'minister_approve');
 perform set_config('request.jwt.claim.sub',current_setting('qa.goal_teacher'),true);
 perform public.advance_state_program(v_program_id,'pm_ready');
 if not exists(select 1 from public.state_programs where id=v_program_id and signed_at is not null and publication_post_id is not null)
  or (select count(*) from public.state_program_components where program_id=v_program_id and target_goal_id is not null)<>3 then raise exception 'FAIL signing and publication with linked goals';end if;
 blocked:=false;begin perform public.save_state_program_draft(g,v_program_id,p,false);exception when sqlstate 'P0001' then blocked:=true;end;
 if not blocked then raise exception 'FAIL signed links can be rewritten';end if;
end;$checks$;
reset role;
do $scope$
declare v_program_id uuid:=current_setting('qa.goal_program')::uuid;foreign_program uuid:=current_setting('qa.foreign_program')::uuid;goal_id uuid;blocked boolean:=false;
begin
 goal_id:=(select v.id from public.state_program_goals v where program_id=v_program_id limit 1);
 begin update public.state_program_components set target_goal_id=goal_id where program_id=foreign_program;exception when foreign_key_violation then blocked:=true;end;
 if not blocked then raise exception 'FAIL cross-program goal reference';end if;
 if has_table_privilege('authenticated','public.state_program_components','UPDATE') or has_function_privilege('authenticated','private.replace_state_program_rows(uuid,jsonb)','EXECUTE') then raise exception 'FAIL unguarded write';end if;
 -- A whole-game cascade must remain possible despite references between children.
 delete from public.games where games.id=current_setting('qa.goal_game')::uuid;
 if exists(select 1 from public.state_program_components where program_id=v_program_id) then raise exception 'FAIL whole-game cascade';end if;
end;$scope$;
select 'PASS: persisted goals, duplicate labels, atomic resave, invalid-reference rollback, protected removal, foreign-program rejection, legacy null, guarded writes, whole-game cascade and exact funding' as result;
rollback;
