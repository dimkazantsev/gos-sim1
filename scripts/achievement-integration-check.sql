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
do $$declare g uuid:=current_setting('qa.game')::uuid;a uuid:=current_setting('qa.a')::uuid;admin uuid:=current_setting('qa.teacher')::uuid;b uuid:=current_setting('qa.b')::uuid;r jsonb;d uuid;o uuid;n integer;before_count integer;blocked boolean;seen text[]:='{}';next_notice jsonb;begin
 perform set_config('request.jwt.claim.sub',a::text,true);
 r:=public.get_game_achievements(g);if jsonb_array_length(r)<>60 or exists(select 1 from jsonb_array_elements(r) x where (x->>'hidden')::boolean) then raise exception 'FAIL hidden conditions exposed before earning';end if;
 blocked:=false;begin insert into game_achievements(game_id,user_id,achievement_id) values(g,a,'medal-099');exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL client forged achievement';end if;
 blocked:=false;begin perform private.achievement_facts(g,a);exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL client invoked protected facts';end if;
 d:=public.create_formal_document(g,1,'QA законопроект','fz_bill','gd_deputy','Депутат Государственной Думы','Статья 1. Учебный текст документа.',null,null,null,'bill','{}');
 perform set_config('request.jwt.claim.sub',admin::text,true);o:=public.appoint_game_office(g,a,'Глава муниципального образования','QA lawful document role',true);
 perform set_config('request.jwt.claim.sub',a::text,true);perform public.select_game_office(o);
 d:=public.create_formal_document(g,1,'QA муниципальный акт','municipal_act','municipality','Муниципальный орган','Решение по вопросу местного значения.',null,null,null,'municipal_act','{}');
 n:=public.evaluate_game_achievements(g);if n<3 then raise exception 'FAIL action evidence did not award medals: %',n;end if;
 select count(*) into before_count from game_achievements where game_id=g and user_id=a;
 if public.evaluate_game_achievements(g)<>0 or before_count<>(select count(*) from game_achievements where game_id=g and user_id=a) then raise exception 'FAIL repeated award';end if;
 r:=public.get_game_achievements(g);if not exists(select 1 from jsonb_array_elements(r) x where (x->>'hidden')::boolean and x->>'earned_at' is not null) then raise exception 'FAIL earned hidden medal stays invisible';end if;
 loop next_notice:=public.claim_achievement_notification(g);exit when next_notice is null;if next_notice->>'id'=any(seen) then raise exception 'FAIL repeated notification';end if;seen:=array_append(seen,next_notice->>'id');end loop;
 if cardinality(seen)<>before_count or public.claim_achievement_notification(g) is not null then raise exception 'FAIL notification claim count';end if;
 insert into game_presence(game_id,user_id,current_view,last_seen_at) values(g,a,'budget','9999-12-31') on conflict(game_id,user_id) do update set last_seen_at=excluded.last_seen_at;
 perform set_config('request.jwt.claim.sub',b::text,true);
 r:=public.get_game_achievements(g,b);if jsonb_array_length(r)<>60 then raise exception 'FAIL another student receives unearned hidden medals';end if;
 blocked:=false;begin perform public.get_game_achievements((select id from games where game_code='8.414'),a);exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL foreign achievement access';end if;
 perform set_config('request.jwt.claim.sub',admin::text,true);if public.evaluate_game_achievements(g)<>0 or public.claim_achievement_notification(g) is not null then raise exception 'FAIL teacher auto-awarded';end if;
end$$;
reset role;
do $$declare g uuid:=current_setting('qa.game')::uuid;a uuid:=current_setting('qa.a')::uuid;begin
 if (select last_seen_at from game_presence where game_id=g and user_id=a)>clock_timestamp()+interval '1 second' then raise exception 'FAIL client controls presence time';end if;
 update private.achievement_presence set last_tick=clock_timestamp()-interval '30 seconds' where game_id=g and user_id=a;
 perform set_config('request.jwt.claim.sub',a::text,true);update game_presence set last_seen_at='9999-12-31' where game_id=g and user_id=a;
 if (select seconds from private.achievement_presence where game_id=g and user_id=a) not between 29 and 32 then raise exception 'FAIL contiguous presence seconds';end if;
 update private.achievement_presence set last_tick=clock_timestamp()-interval '3 hours' where game_id=g and user_id=a;update game_presence set last_seen_at='9999-12-31' where game_id=g and user_id=a;
 if (select seconds from private.achievement_presence where game_id=g and user_id=a)>33 then raise exception 'FAIL idle hours counted';end if;
end$$;
set local role anon;
do $$declare blocked boolean:=false;begin begin perform public.get_game_achievements(current_setting('qa.game')::uuid);exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL anonymous medal access';end if;end$$;
reset role;
select jsonb_build_object('public_60_hidden_40','PASS','authoritative_conditions','PASS','earned_hidden_visible','PASS','client_forgery_denied','PASS','repeat_award_denied','PASS','notification_once','PASS','teacher_not_awarded','PASS','foreign_game_denied','PASS','server_presence_clock','PASS','idle_gap_excluded','PASS','anonymous_denied','PASS') checks;
rollback;
