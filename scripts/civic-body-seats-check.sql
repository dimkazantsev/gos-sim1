-- Isolated game, real authenticated RPCs, complete rollback. No student data persists.
begin;
do $ declare g uuid:=gen_random_uuid();p uuid:=gen_random_uuid();admin uuid;a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();begin
 select owner_id into admin from public.games order by created_at limit 1;
 if admin is null then raise exception 'QA requires an existing classroom owner';end if;
 insert into auth.users(id,aud,role) values(a,'authenticated','authenticated'),(b,'authenticated','authenticated');
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open) values(g,'QA civic procedures','QA'||substr(replace(g::text,'-',''),1,10),admin,'running',11,true);
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 select g,s.stage_no,'QA stage '||s.stage_no,'Учебная процедура','QA',
  case when s.stage_no=(select current_round from public.games where id=g)then 'open' else 'locked' end
 from generate_series(1,16)as s(stage_no);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name) values(g,admin,'Проверка преподавателя','teacher','Преподаватель',null);
 insert into public.game_parties(id,game_id,name,mandates,leader_user_id) values(p,g,'QA civic party',450,a);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name,team) values(g,a,'Проверка А','student','Депутат Государственной Думы','QA','QA civic party'),(g,b,'Проверка Б','student','Депутат Государственной Думы','QA','QA civic party');
 perform set_config('qa.civic_game',g::text,true);perform set_config('qa.civic_party',p::text,true);
 perform set_config('qa.civic_teacher',admin::text,true);perform set_config('qa.civic_a',a::text,true);perform set_config('qa.civic_b',b::text,true);
end;$$;
set local role authenticated;
do $ declare g uuid:=current_setting('qa.civic_game')::uuid;admin uuid:=current_setting('qa.civic_teacher')::uuid;a uuid:=current_setting('qa.civic_a')::uuid;b uuid:=current_setting('qa.civic_b')::uuid;body uuid;v uuid;result jsonb;blocked boolean:=false;begin
 body:=public.save_civic_voting_body(g,'QA комиссия',5,array[a,b],null,null);
 v:=public.create_civic_vote(g,'QA установленный состав',null,'member','unit:'||body::text,'registered_session','fraction',.5,'present_majority',.5,true,false,null,'none','none','QA');
 if (select (electorate_snapshot->>'eligible')::integer from public.game_votes where id=v)<>5 then raise exception 'FAIL fixed body size';end if;
 begin perform public.save_civic_voting_body(g,'QA комиссия',6,array[a],null,body);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL open vote roster change';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);perform public.register_institution_session(g,'unit:'||body::text);perform public.cast_vote_allocation(v,1,0,0);
 perform set_config('request.jwt.claim.sub',b::text,true);perform public.register_institution_session(g,'unit:'||body::text);perform public.cast_vote_allocation(v,1,0,0);
 perform set_config('request.jwt.claim.sub',admin::text,true);result:=public.close_procedural_vote(v);
 if result->>'result'<>'no_quorum' or (result->>'needed')::integer<>3 then raise exception 'FAIL vacant seats quorum: %',result;end if;
 perform public.save_civic_voting_body(g,'QA комиссия',3,array[a],null,body);
end;$$;
select 'PASS: numeric body seats, vacancies quorum and immutable open roster' result;
rollback;