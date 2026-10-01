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


do $$declare g uuid:=current_setting('qa.game')::uuid;t uuid:=current_setting('qa.teacher')::uuid;a uuid:=current_setting('qa.a')::uuid;b uuid:=current_setting('qa.b')::uuid;p uuid;incident uuid;candidate uuid;s numeric;blocked boolean;v game_votes%rowtype;regional uuid;begin
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into game_parties(game_id,name,mandates,regions,leader_user_id) values(g,'QA фракция',100,8,a) returning id into p;
 update game_members set team='QA фракция' where game_id=g and user_id in (a,b);
 perform private.rebalance_party_mandates(p);
 incident:=public.record_deadline_consequence(g,2,p,null,'representation_loss',7,'QA нарушение срока');
 if (select sum(effective_mandates) from party_member_mandates where party_id=p)<>93 or (select sum(representation_loss) from party_member_mandates where party_id=p)<>7 then raise exception 'FAIL representation loss';end if;
 perform public.apply_party_ghost_loss(p,25);
 if (select sum(effective_mandates) from party_member_mandates where party_id=p)<>68 or (select sum(ghost_loss) from party_member_mandates where party_id=p)<>25 then raise exception 'FAIL GV and sanction composition';end if;
 perform public.revert_deadline_consequence(incident);
 if (select sum(effective_mandates) from party_member_mandates where party_id=p)<>75 then raise exception 'FAIL mandate restoration';end if;
 blocked:=false;begin perform public.record_deadline_consequence(g,2,p,null,'representation_loss',1.5,'QA invalid fraction');exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL fractional seats';end if;
 insert into presidential_candidates(game_id,party_id,display_name,nomination_type,registration_status,rating_penalty,created_by) values(g,p,'QA кандидат','fictional','registered',3,t) returning id into candidate;
 insert into presidential_election_settings(game_id,poll_enabled,updated_by) values(g,false,t) on conflict(game_id) do update set poll_enabled=false;
 s:=public.set_presidential_scorecard(candidate,1,80,80,80,null,null);if s<>77 then raise exception 'FAIL initial candidate score';end if;
 incident:=public.record_deadline_consequence(g,6,p,null,'presidential_rating_loss',11,'QA rating deadline');
 select computed_pct into s from presidential_scorecards where candidate_id=candidate and round_no=1;if s<>66 then raise exception 'FAIL deadline in candidate score';end if;
 perform public.revert_deadline_consequence(incident);
 select computed_pct into s from presidential_scorecards where candidate_id=candidate and round_no=1;if s<>77 then raise exception 'FAIL candidate restoration';end if;

 -- A penalty larger than the award clips to zero and restores the exact baseline.
 incident:=public.record_deadline_consequence(g,3,p,null,'regional_seat_loss',20,'QA regional deadline');
 if (select regions from game_parties where id=p)<>0 or (select regional_seats_awarded from game_parties where id=p)<>8 then raise exception 'FAIL regional clip';end if;
 perform public.revert_deadline_consequence(incident);perform public.revert_deadline_consequence(incident);
 if (select regions from game_parties where id=p)<>8 then raise exception 'FAIL regional baseline restored';end if;
 -- A later election writes gross allocation; the retained sanction is applied once.
 incident:=public.record_deadline_consequence(g,3,p,null,'regional_seat_loss',4,'QA regional new result');
 regional:=public.propose_regional_election_rule(g,'proportional','QA proportional');
 update regional_election_rules set status='adopted' where id=regional;
 perform public.execute_regional_allocation(regional);
 if (select sum(regions) from regional_allocations where rule_id=regional)<>89 or (select regions from game_parties where id=p)<>85 then raise exception 'FAIL regional election sanction';end if;
 perform public.revert_deadline_consequence(incident);if (select regions from game_parties where id=p)<>89 then raise exception 'FAIL regional 89 restoration';end if;
 -- Closed scores are historical; future sanctions do not alter the old winner.
 update presidential_election_settings set status='finished' where game_id=g;
 incident:=public.record_deadline_consequence(g,6,p,null,'presidential_rating_loss',5,'QA after election');
 if (select computed_pct from presidential_scorecards where candidate_id=candidate and round_no=1)<>77 then raise exception 'FAIL final score rewritten';end if;
 perform public.revert_deadline_consequence(incident);
 -- Sanctions cannot rewrite the electorate of an open mandate vote.
 insert into game_votes(game_id,stage_no,title,body,voting_mode,status,created_by,institution_key,procedure_key)
 values(g,2,'QA frozen electorate','QA','mandate','open',t,'gd','generic') returning * into v;
 if private.vote_total_eligible_weight(v)<>450 then raise exception 'FAIL statutory total 450';end if;
 blocked:=false;begin perform public.record_deadline_consequence(g,2,p,null,'representation_loss',5,'QA frozen check');exception when others then blocked:=true;end;if not blocked then raise exception 'FAIL open vote electorate changed';end if;
 perform set_config('qa.party',p::text,true);
end$$;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;a uuid:=current_setting('qa.a')::uuid;blocked boolean:=false;begin
 perform set_config('request.jwt.claim.sub',a::text,true);
 begin perform public.record_deadline_consequence(g,2,current_setting('qa.party')::uuid,null,'representation_loss',1,'QA client forgery');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL student sanction forge';end if;
end$$;
reset role;
select jsonb_build_object('representation','PASS','separate_GV','PASS','restoration','PASS','integer_seats','PASS','candidate_rating','PASS','regional_clip_restore','PASS','regional_result','PASS','closed_election_immutable','PASS','quorum450','PASS','electorate_frozen','PASS','student_guard','PASS') checks;
rollback;
