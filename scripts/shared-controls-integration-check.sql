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
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;teacher uuid:=current_setting('qa.teacher')::uuid;a uuid:=current_setting('qa.a')::uuid;b uuid:=current_setting('qa.b')::uuid;blocked boolean;data jsonb;c uuid;n integer;begin
 data:=public.get_fiscal_context(g);if (data->'policy'->>'federal_expenditure')::numeric<=0 or not (data->>'can_change_rate')::boolean then raise exception 'FAIL initial shared forecast';end if;
 perform public.ensure_social_channels(g);perform public.ensure_social_channels(g);
 if (select count(*) from chat_channels where game_id=g and kind='public')<>2 then raise exception 'FAIL duplicate public channels';end if;
 if jsonb_array_length(public.get_teacher_achievements(g))<>100 then raise exception 'FAIL full teacher award catalogue';end if;
 perform public.set_achievement_visibility(g,'medal-001',true);
 if jsonb_array_length(public.get_game_achievements(g,a))<>59 then raise exception 'FAIL hiding unearned award';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 blocked:=false;begin perform public.get_teacher_achievements(g);exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL student saw secret definitions';end if;
 blocked:=false;begin perform public.set_achievement_visibility(g,'medal-002',true);exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL student changed visibility';end if;
 blocked:=false;begin perform public.set_fiscal_policy(g,'{"key_rate":12}','Заявление без полномочий');exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL deputy changed key rate';end if;
 blocked:=false;begin perform public.get_fiscal_context(gen_random_uuid());exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL foreign budget access';end if;
 select id into c from chat_channels where game_id=g and name='Вне игры';
 select count(*) into n from political_posts where game_id=g;
 insert into chat_messages(game_id,channel_id,author_id,kind,text) values(g,c,a,'text','Разговор после занятия #президент_gpyasu');
 if (select count(*) from political_posts where game_id=g)<>n then raise exception 'FAIL out-of-game chat leaked into politics';end if;
 select id into c from chat_channels where game_id=g and name='Публичная политика';
 insert into chat_messages(game_id,channel_id,author_id,kind,text) values(g,c,a,'text','Публичная позиция по решению #президент_gpyasu');
 if (select count(*) from political_posts where game_id=g)<>n+1 then raise exception 'FAIL public chat lost process integration';end if;
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 c:=public.appoint_game_office(g,b,'Председатель Банка России','Проверка полномочий денежно-кредитной политики',true);
 perform set_config('request.jwt.claim.sub',b::text,true);perform public.select_game_office(c);
 perform public.set_fiscal_policy(g,'{"key_rate":12}','Снижение стоимости кредита в учебном сценарии');
 data:=public.get_fiscal_context(g);if (data->'policy'->>'key_rate')::numeric<>12 then raise exception 'FAIL rate not shared';end if;
 blocked:=false;begin perform public.set_fiscal_policy(g,'{"fx_rate":120}','Изменение основы модели без преподавателя');exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL student changed initial macro parameters';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);data:=public.get_fiscal_context(g);if (data->'policy'->>'key_rate')::numeric<>12 then raise exception 'FAIL cross-account sync';end if;
 perform set_config('request.jwt.claim.sub',teacher::text,true);
 perform public.set_fiscal_policy(g,'{"fx_rate":90,"federal_expenditure":12000,"municipal_expenditure":3500}','Параметры сценария для учебной аудитории');
 perform public.set_achievement_visibility(g,'medal-001',false);
 if jsonb_array_length(public.get_game_achievements(g,a))<>60 then raise exception 'FAIL visibility restoration';end if;
 perform set_config('qa.controls_passed','14',true);
end$$;
reset role;
select current_setting('qa.controls_passed')||' shared-budget, chat and achievement access checks passed; all changes rolled back' result;
rollback;
