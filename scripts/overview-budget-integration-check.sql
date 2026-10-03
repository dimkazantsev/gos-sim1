-- Real RPCs and access policies in temporary classrooms; every write is rolled back.
begin;
do $$declare g uuid:=gen_random_uuid();foreign_game uuid:=gen_random_uuid();owner uuid;t uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();archived uuid:=gen_random_uuid();observer uuid:=gen_random_uuid();begin
 select owner_id into owner from games where game_code='8.414';if owner is null then raise exception 'QA owner missing';end if;
 insert into auth.users(id,aud,role) values(t,'authenticated','authenticated'),(a,'authenticated','authenticated'),(b,'authenticated','authenticated'),(archived,'authenticated','authenticated'),(observer,'authenticated','authenticated');
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into games(id,title,game_code,owner_id,status,turn_open) values(g,'QA Overview and income','QA'||substr(replace(g::text,'-',''),1,12),owner,'running',true),(foreign_game,'QA Foreign scope','QA'||substr(replace(foreign_game::text,'-',''),1,12),owner,'running',true);
 insert into game_members(game_id,user_id,full_name,kind,role_title,group_name) values(g,t,'QA teacher','teacher','Преподаватель','QA'),(g,a,'QA minister','student','Министр финансов','QA'),(g,b,'QA student','student','Депутат Государственной Думы','QA'),(g,archived,'QA archived','student','Депутат Государственной Думы','QA'),(foreign_game,archived,'QA foreign','student','Депутат Государственной Думы','QA'),(g,observer,'QA observer','observer','Наблюдатель','QA');
 update game_members set roster_archived_at=clock_timestamp() where game_id=g and user_id=archived;
 insert into game_stages(game_id,stage_no,title,mode,summary,status) select g,stage_no,title,mode,summary,case when stage_no=13 then 'open' else 'locked' end from game_stages where game_id=(select id from games where game_code='8.414');
 update game_stages set deadline=clock_timestamp()-interval '1 hour' where game_id=g and stage_no=13;
 insert into state_metrics(game_id,metric_key,label,value,unit,is_public,group_key,min_value,max_value,sort_order) select g,metric_key,label,case when metric_key in ('economy','public_trust') then 50 when metric_key='budget' then 742 else value end,unit,is_public,group_key,min_value,max_value,sort_order from state_metrics where game_id=(select id from games where game_code='8.414') on conflict(game_id,metric_key) do nothing;
 perform set_config('qa.game',g::text,true);perform set_config('qa.foreign',foreign_game::text,true);perform set_config('qa.teacher',t::text,true);perform set_config('qa.a',a::text,true);perform set_config('qa.b',b::text,true);perform set_config('qa.archived',archived::text,true);perform set_config('qa.observer',observer::text,true);
end$$;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;r jsonb;s jsonb;blocked boolean;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.observer'),true);r:=public.get_budget_pulse(g);
 if (r#>>'{calculation,revenue}')::numeric<>40283300 or (select value from state_metrics where game_id=g and metric_key='budget')<>742 then raise exception 'FAIL observer forecast / read-only guard';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.a'),true);
 r:=public.get_budget_pulse(g);
 if r->>'mode'<>'baseline' or (r#>>'{calculation,revenue}')::numeric<>40283300 or (r#>>'{calculation,expenditure}')::numeric<>44069700 then raise exception 'FAIL shared baseline: %',r;end if;
 if (select value from state_metrics where game_id=g and metric_key='budget')<>40283300 or (select unit from state_metrics where game_id=g and metric_key='budget')<>'млн ₽' then raise exception 'FAIL stored metric income';end if;
 if jsonb_array_length(r->'history')<>1 or (r#>>'{history,0,delta}')::numeric<>0 or (select revenue_adjustment from budget_simulator_state where game_id=g)<>0 then raise exception 'FAIL adoption produces artificial impact';end if;
 s:=public.get_budget_pulse(g);if jsonb_array_length(s->'history')<>1 then raise exception 'FAIL pulse appends unchanged history';end if;
 blocked:=false;begin perform public.get_teacher_overview(g);exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL student reads teacher overview';end if;
 blocked:=false;begin perform public.get_budget_pulse(current_setting('qa.foreign')::uuid);exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL foreign budget pulse';end if;
 blocked:=false;begin insert into budget_income_history(game_id,value,expenditure,mode,note) values(g,1,1,'draft','Forgery');exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL forged income history';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.teacher'),true);
 perform public.set_state_metric((select id from state_metrics where game_id=g and metric_key='budget'),40285800,'QA correction +2500 million');
 r:=public.get_budget_pulse(g);
 if (r#>>'{calculation,revenue}')::numeric<>40285800 or (select revenue_adjustment from budget_simulator_state where game_id=g)<>2500 then raise exception 'FAIL correction not in calculator';end if;
 if jsonb_array_length(r->'history')<>2 or (r#>>'{history,1,delta}')::numeric<>2500 then raise exception 'FAIL income history after correction';end if;
 perform public.get_budget_pulse(g);if (select revenue_adjustment from budget_simulator_state where game_id=g)<>2500 then raise exception 'FAIL correction counted twice';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.b'),true);s:=public.get_budget_pulse(g);if s->'calculation' is distinct from r->'calculation' then raise exception 'FAIL student and teacher shared values differ';end if;
end$$;
reset role;
do $$declare g uuid:=current_setting('qa.game')::uuid;b jsonb;d jsonb;begin
 select data into b from private.budget_baseline where year=2026;
 d:=jsonb_build_object('title','QA общий прогноз','income_changes','{"turnover":5}'::jsonb,'spending_changes','{}'::jsonb,'revenue_adjustments','{}'::jsonb,'financing',b->'financing','terms','{"ofz_fixed":60,"ofz_float":60,"bank_credit":12,"external":60}'::jsonb,'transfer_ids','[]'::jsonb,'note','Обоснование учебного общего прогноза доходов для проверки синхронизации.');
 perform set_config('qa.draft',d::text,true);
 -- More activity than the client feed limit proves aggregation is not a loaded-array count.
 insert into game_activity(game_id,actor_id,event_type,label,created_at) select g,current_setting('qa.a')::uuid,'qa','QA recent action',clock_timestamp()-interval '1 minute' from generate_series(1,125);
 insert into game_activity(game_id,actor_id,event_type,label,created_at) select g,current_setting('qa.archived')::uuid,'qa','QA archived action',clock_timestamp()-interval '1 minute' from generate_series(1,40);
 insert into game_activity(game_id,actor_id,event_type,label,created_at) select current_setting('qa.foreign')::uuid,current_setting('qa.archived')::uuid,'qa','QA foreign action',clock_timestamp()-interval '1 minute' from generate_series(1,30);
 insert into game_presence(game_id,user_id,current_view,last_seen_at) values(g,current_setting('qa.a')::uuid,'budget',clock_timestamp()),(g,current_setting('qa.b')::uuid,'stages',clock_timestamp()-interval '5 minutes'),(g,current_setting('qa.archived')::uuid,'budget',clock_timestamp()) on conflict(game_id,user_id) do update set last_seen_at=excluded.last_seen_at;
end$$;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;r jsonb;s jsonb;plan uuid;blocked boolean;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.a'),true);
 r:=public.save_budget_simulator(g,null,current_setting('qa.draft')::jsonb,null);plan:=(r->>'id')::uuid;perform set_config('qa.plan',plan::text,true);
 r:=public.get_budget_pulse(g);if r->>'plan_id'<>plan::text or r->>'mode'<>'draft' then raise exception 'FAIL saved draft selection';end if;
 perform set_config('qa.saved_pulse',r::text,true);
 perform set_config('request.jwt.claim.sub',current_setting('qa.teacher'),true);
 s:=public.get_teacher_overview(g);
 if (s->>'students')::integer<>2 or (s->>'online')::integer<>2 or (s->>'stages_overdue')::integer<>1 or (s->>'actions_day')::integer<125 then raise exception 'FAIL current roster/full telemetry: %',s;end if;
 if (s->>'actions_day')::integer<>(select count(*) from game_activity a join game_members m on m.game_id=a.game_id and m.user_id=a.actor_id where a.game_id=g and m.kind='student' and m.roster_archived_at is null and a.created_at between clock_timestamp()-interval '24 hours' and clock_timestamp()) then raise exception 'FAIL activity aggregation';end if;
 blocked:=false;begin perform public.get_teacher_overview(current_setting('qa.foreign')::uuid);exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL teacher reads unrelated game';end if;
end$$;
reset role;
do $$declare g uuid:=current_setting('qa.game')::uuid;r jsonb:=current_setting('qa.saved_pulse')::jsonb;c jsonb;begin
 c:=private.calculate_budget_simulator(g,current_setting('qa.draft')::jsonb);
 if r->'calculation' is distinct from c or (select value from state_metrics where game_id=g and metric_key='budget')<>(c->>'revenue')::numeric then raise exception 'FAIL server calculator and shared metric differ';end if;
 if (select count(*) from budget_income_history where game_id=g)<>3 then raise exception 'FAIL shared history revisions';end if;
end$$;
set local role anon;
do $$declare blocked boolean:=false;begin begin perform public.get_budget_pulse(current_setting('qa.game')::uuid);exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL anonymous budget';end if;end$$;
reset role;
select jsonb_build_object('baseline_income_and_expense','PASS','shared_metric_and_calculator','PASS','manual_correction_bridge','PASS','no_double_counting','PASS','saved_draft_selection','PASS','current_roster_only','PASS','full_activity_not_feed_limit','PASS','teacher_scope','PASS','student_scope','PASS','history_forgery_denied','PASS','anonymous_denied','PASS','observer_read_only_forecast','PASS') checks;
rollback;
