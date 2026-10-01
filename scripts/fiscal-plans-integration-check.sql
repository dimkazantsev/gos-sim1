-- Isolated classroom, authenticated RPC checks, complete rollback, no real IDs in source.
begin;
do $$declare g uuid:=gen_random_uuid();admin uuid;a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();begin
 select owner_id into admin from public.games where game_code='8.414';
 -- Two temporary identities avoid inheriting platform-admin rights. Both are
 -- rolled back; real users, logins and classroom roles are never changed.
 if admin is null then raise exception 'QA requires an existing classroom owner';end if;
 insert into auth.users(id,aud,role) values(a,'authenticated','authenticated'),(b,'authenticated','authenticated');
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.games(id,title,game_code,owner_id,status,turn_open) values(g,'QA fiscal integration','QA'||substr(replace(g::text,'-',''),1,12),admin,'running',true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name) values(g,admin,'QA преподаватель','teacher','Преподаватель','QA'),(g,a,'QA участник А','student','Депутат Государственной Думы','QA'),(g,b,'QA участник Б','student','Министр финансов','QA');
 insert into game_stages(game_id,stage_no,title,mode,summary,status) select g,stage_no,title,mode,summary,case when stage_no=1 then 'open' else 'locked' end from game_stages where game_id=(select id from games where game_code='8.414');
 insert into state_metrics(game_id,metric_key,label,value,unit,is_public,group_key,min_value,max_value,sort_order) select g,metric_key,label,value,unit,is_public,group_key,min_value,max_value,sort_order from state_metrics where game_id=(select id from games where game_code='8.414') on conflict(game_id,metric_key) do nothing;
 perform set_config('qa.game',g::text,true);perform set_config('qa.teacher',admin::text,true);perform set_config('qa.a',a::text,true);perform set_config('qa.b',b::text,true);
end$$;

do $$declare g uuid:=current_setting('qa.game')::uuid;t uuid:=current_setting('qa.teacher')::uuid;s uuid;pr uuid;d uuid;begin
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into state_programs(game_id,title,responsible_ministry,total_budget,status,created_by) values(g,'QA доступные школы','Министерство образования',7000,'adopted',t) returning id into pr;
 insert into budget_scenarios(game_id,title,budget_year,source_note,gdp,revenue,expenditure,debt_start,financing,status,created_by) values(g,'QA федеральный бюджет',2027,'Учебные миллионы рублей',100000,12000,15000,1000,500,'final',t) returning id into s;
 insert into budget_program_allocations(game_id,scenario_id,program_id,amount,created_by) values(g,s,pr,7000,t);
 d:=public.create_budget_document_from_scenario(s);
 perform set_config('qa.scenario',s::text,true);perform set_config('qa.document',d::text,true);
end$$;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;a uuid:=current_setting('qa.a')::uuid;r jsonb;blocked boolean;begin
 perform set_config('request.jwt.claim.sub',a::text,true);r:=public.get_fiscal_legal_plans(g);
 if jsonb_array_length(r->'plans')<>1 or jsonb_array_length(r->'programs')<>1 then raise exception 'FAIL shared scenario/program view';end if;
 if r#>>'{plans,0,legal_status}'<>'ready' then raise exception 'FAIL draft NPA treated as enacted';end if;
 if (r#>>'{plans,0,allocations,0,amount}')::numeric<>7000 or (r#>>'{plans,0,expenditure}')::numeric<>15000 then raise exception 'FAIL allocation double counted';end if;
 if r#>>'{plans,0,document_id}'<>current_setting('qa.document') then raise exception 'FAIL NPA bridge';end if;
 blocked:=false;begin perform public.get_fiscal_legal_plans(gen_random_uuid());exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL foreign game';end if;
end$$;
reset role;
update formal_documents set status_code='published',status_label='Опубликован' where id=current_setting('qa.document')::uuid;
set local role authenticated;
do $$declare r jsonb;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.a'),true);r:=public.get_fiscal_legal_plans(current_setting('qa.game')::uuid);
 if r#>>'{plans,0,legal_status}'<>'published' then raise exception 'FAIL published law not reflected';end if;
 if r#>>'{plans,0,source_note}'<>'Учебные миллионы рублей' then raise exception 'FAIL unit provenance';end if;
end$$;
reset role;
update formal_documents set metadata=metadata||'{"budget_scenario_id":"00000000-0000-0000-0000-000000000000"}'::jsonb where id=current_setting('qa.document')::uuid;
set local role authenticated;
do $$declare r jsonb;begin r:=public.get_fiscal_legal_plans(current_setting('qa.game')::uuid);if r#>>'{plans,0,legal_status}'='published' then raise exception 'FAIL wrong structured scenario adopted';end if;end$$;
reset role;
select jsonb_build_object('shared_scenario_programs','PASS','draft_not_enacted','PASS','published_law_reflected','PASS','NPA_link','PASS','program_allocation_not_double_counted','PASS','unit_provenance','PASS','foreign_game_blocked','PASS','structured_source_verified','PASS') checks;
rollback;
