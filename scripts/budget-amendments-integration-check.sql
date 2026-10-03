-- All identities, ballots and economic changes are temporary and rolled back.
begin;
do $$declare g uuid:=gen_random_uuid();g2 uuid:=gen_random_uuid();t uuid;a uuid:=gen_random_uuid();m uuid:=gen_random_uuid();o uuid:=gen_random_uuid();p uuid:=gen_random_uuid();p2 uuid:=gen_random_uuid();begin
 select owner_id into t from games where game_code='8.414';if t is null then raise exception 'QA owner missing';end if;
 insert into auth.users(id,aud,role) values(a,'authenticated','authenticated'),(m,'authenticated','authenticated'),(o,'authenticated','authenticated');
 perform set_config('request.jwt.claim.sub',t::text,true);
 insert into games(id,title,game_code,owner_id,status,turn_open,current_round) values(g,'QA Budget amendments','QA'||substr(replace(g::text,'-',''),1,12),t,'running',true,13),(g2,'QA Foreign budget','QA'||substr(replace(g2::text,'-',''),1,12),t,'running',true,13);
 insert into game_members(game_id,user_id,full_name,kind,role_title,group_name) values(g,t,'QA teacher','teacher','Преподаватель','QA'),(g,a,'QA deputy','student','Депутат Государственной Думы','QA'),(g,m,'QA minister','student','Министр финансов','QA'),(g,o,'QA observer','observer','Наблюдатель','QA'),(g2,t,'QA teacher','teacher','Преподаватель','QA');
 insert into game_stages(game_id,stage_no,title,mode,summary,status) select g,stage_no,title,mode,summary,case when stage_no=13 then 'open' else 'locked' end from game_stages where game_id=(select id from games where game_code='8.414');
 insert into state_metrics(game_id,metric_key,label,value,unit,is_public,group_key,min_value,max_value,sort_order) select g,metric_key,label,case when metric_key in ('economy','public_trust') then 50 else value end,unit,is_public,group_key,min_value,max_value,sort_order from state_metrics where game_id=(select id from games where game_code='8.414') on conflict(game_id,metric_key) do nothing;
 insert into game_parties(id,game_id,name,mandates,ghost_loss_current,leader_user_id,registration_status) values(p,g,'QA faction',450,50,a,'registered'),(p2,g2,'QA other faction',0,0,t,'registered');
 update game_members set team='QA faction' where game_id=g and user_id=a;
 perform private.rebalance_party_mandates(p);
 perform set_config('qa.game',g::text,true);perform set_config('qa.foreign_game',g2::text,true);perform set_config('qa.teacher',t::text,true);perform set_config('qa.deputy',a::text,true);perform set_config('qa.minister',m::text,true);perform set_config('qa.observer',o::text,true);perform set_config('qa.party',p::text,true);perform set_config('qa.foreign_party',p2::text,true);
end$$;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;r jsonb;d jsonb;bad boolean;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.minister'),true);
 r:=get_budget_simulator(g);
 d:=jsonb_build_object('title','QA федеральный бюджет 2026','income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,'revenue_adjustments','{}'::jsonb,'financing',r#>'{state,last_financing}','terms','{"ofz_fixed":60,"ofz_float":60,"bank_credit":12,"external":60}'::jsonb,'transfer_ids','[]'::jsonb,'note','Пояснительная записка: сохраняем общие характеристики и проверяем приоритеты расходов.');
 r:=save_budget_simulator(g,null,d,null);perform set_config('qa.plan',r->>'id',true);perform set_config('qa.draft',d::text,true);
 perform set_config('request.jwt.claim.sub',current_setting('qa.observer'),true);
 r:=get_budget_amendments(g);if (r->>'can_open')::boolean or (r->>'can_apply')::boolean or jsonb_array_length(r->'party_ids')<>0 then raise exception 'FAIL observer permissions';end if;
 bad:=false;begin perform get_budget_amendments(current_setting('qa.foreign_game')::uuid);exception when others then if sqlerrm not like '%Нет доступа%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL foreign game';end if;
 bad:=false;begin perform submit_budget_amendment(current_setting('qa.plan')::uuid,1,null,'QA test','Обоснование перераспределения расходов на медицинскую помощь.','04','09',10000);exception when others then if sqlerrm not like '%Наблюдатель%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL observer submit';end if;
 if exists(select 1 from budget_faction_amendments where game_id<>g) then raise exception 'FAIL cross-game RLS';end if;
 bad:=false;begin update budget_faction_amendments set amount=1;exception when insufficient_privilege then bad:=true;end;if not bad then raise exception 'FAIL direct write grant';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.deputy'),true);
 r:=get_budget_amendments(g);if not (r->'party_ids' ? current_setting('qa.party')) or (r->>'can_apply')::boolean then raise exception 'FAIL faction access';end if;
 bad:=false;begin perform submit_budget_amendment(current_setting('qa.plan')::uuid,1,current_setting('qa.foreign_party')::uuid,'QA foreign faction','Обоснование перераспределения расходов на медицинскую помощь.','04','09',10000);exception when others then if sqlerrm not like '%фракцию этой игры%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL foreign party';end if;
 bad:=false;begin perform submit_budget_amendment(current_setting('qa.plan')::uuid,1,current_setting('qa.party')::uuid,'QA same sections','Обоснование перераспределения расходов на медицинскую помощь.','04','04',10000);exception when others then if sqlerrm not like '%два разных раздела%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL same sections';end if;
 bad:=false;begin perform submit_budget_amendment(current_setting('qa.plan')::uuid,1,current_setting('qa.party')::uuid,'QA debt service','Обоснование перераспределения расходов на медицинскую помощь.','13','09',10000);exception when others then if sqlerrm not like '%Обслуживание долга%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL debt service';end if;
 bad:=false;begin perform submit_budget_amendment(current_setting('qa.plan')::uuid,1,current_setting('qa.party')::uuid,'QA invalid amount','Обоснование перераспределения расходов на медицинскую помощь.','04','09','NaN');exception when others then if sqlerrm not like '%Укажите сумму%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL NaN';end if;
 perform set_config('qa.amendment',submit_budget_amendment(current_setting('qa.plan')::uuid,1,current_setting('qa.party')::uuid,'Медицина вместо части общих экономических расходов','Переносим 10 млрд рублей на медицинскую помощь. Проверяем снижение финансирования экономики и сохраняем общий объем расходов.','04','09',10000)::text,true);
 if submit_budget_amendment(current_setting('qa.plan')::uuid,1,current_setting('qa.party')::uuid,'Повторное нажатие','Переносим 10 млрд рублей на медицинскую помощь с сохранением общего объема расходов.','04','09',10000)::text<>current_setting('qa.amendment') then raise exception 'FAIL duplicate proposal';end if;
 bad:=false;begin perform open_budget_amendment_vote(current_setting('qa.amendment')::uuid);exception when others then if sqlerrm not like '%открывает преподаватель%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL deputy opens unlinked vote';end if;
 bad:=false;begin perform apply_budget_amendment(current_setting('qa.amendment')::uuid);exception when others then if sqlerrm not like '%бюджетная команда%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL deputy applies';end if;
 if (select revision from budget_simulator_plans where id=current_setting('qa.plan')::uuid)<>1 or (select last_plan_id from budget_simulator_state where game_id=g) is not null then raise exception 'FAIL submission changes budget';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.teacher'),true);
 perform set_config('qa.vote',open_budget_amendment_vote(current_setting('qa.amendment')::uuid)::text,true);
 if open_budget_amendment_vote(current_setting('qa.amendment')::uuid)::text<>current_setting('qa.vote') then raise exception 'FAIL duplicate vote';end if;
 r:=(select electorate_snapshot from game_votes where id=current_setting('qa.vote')::uuid);if (r->>'eligible')::numeric<>450 or (r->'weights'->>current_setting('qa.deputy'))::numeric<>400 then raise exception 'FAIL 450 mandates or GV %',r;end if;
 bad:=false;begin perform apply_budget_amendment(current_setting('qa.amendment')::uuid);exception when others then if sqlerrm not like '%Сначала завершите%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL apply before vote';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.deputy'),true);
 perform register_institution_session(g,'gd');perform cast_vote_allocation(current_setting('qa.vote')::uuid,300,80,20);
 perform set_config('request.jwt.claim.sub',current_setting('qa.teacher'),true);
 r:=close_procedural_vote(current_setting('qa.vote')::uuid,'Предварительное рассмотрение перераспределения.');if r->>'result'<>'passed' then raise exception 'FAIL preliminary vote %',r;end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.minister'),true);
 r:=apply_budget_amendment(current_setting('qa.amendment')::uuid);if (r->>'revision')::integer<>2 then raise exception 'FAIL apply revision';end if;
 r:=apply_budget_amendment(current_setting('qa.amendment')::uuid);if not (r->>'already_applied')::boolean or (r->>'revision')::integer<>2 then raise exception 'FAIL apply replay';end if;
 if (select count(*) from budget_simulator_ledger where game_id=g and source_key='amendment-apply:'||current_setting('qa.amendment'))<>1 then raise exception 'FAIL duplicate economic journal';end if;
 r:=(select calculation from budget_simulator_plans where id=current_setting('qa.plan')::uuid);if (r->>'expenditure')::numeric<>44069700 or (r->>'revenue')::numeric<>40283300 or (r->>'funding_gap')::numeric<>0 then raise exception 'FAIL reallocation changes totals %',r;end if;
 if (select (l->>'amount')::numeric from jsonb_array_elements(r->'expense_lines') l where l->>'key'='09')<>1914900 then raise exception 'FAIL healthcare allocation';end if;
 if (select last_plan_id from budget_simulator_state where game_id=g) is not null then raise exception 'FAIL preliminary vote enacts law';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.deputy'),true);
 perform set_config('qa.stale',submit_budget_amendment(current_setting('qa.plan')::uuid,2,current_setting('qa.party')::uuid,'Следующий приоритет','Обосновываем новый приоритет образования при сохранении объема федеральных расходов.','04','07',5000)::text,true);
 perform set_config('qa.withdraw',submit_budget_amendment(current_setting('qa.plan')::uuid,2,current_setting('qa.party')::uuid,'Отозванное предложение','Обосновываем новую культурную инициативу и затем отзываем предложение до голосования.','04','08',1000)::text,true);
 perform withdraw_budget_amendment(current_setting('qa.withdraw')::uuid);perform withdraw_budget_amendment(current_setting('qa.withdraw')::uuid);
 if (select status from budget_faction_amendments where id=current_setting('qa.withdraw')::uuid)<>'withdrawn' then raise exception 'FAIL withdraw';end if;
end$$;
reset role;
-- A changed economic assumption invalidates the comparison even without a draft edit.
update game_fiscal_policy set inflation=inflation+1 where game_id=current_setting('qa.game')::uuid;
set local role authenticated;
do $$declare r jsonb;bad boolean;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.teacher'),true);
 r:=get_budget_amendments(current_setting('qa.game')::uuid);if not exists(select 1 from jsonb_array_elements(r->'amendments') a where a->>'id'=current_setting('qa.stale') and (a->>'stale')::boolean) then raise exception 'FAIL fiscal staleness';end if;
 bad:=false;begin perform open_budget_amendment_vote(current_setting('qa.stale')::uuid);exception when others then if sqlerrm not like '%Изменились финансовые условия%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL fiscal stale vote';end if;
end$$;
reset role;
update game_fiscal_policy set inflation=inflation-1 where game_id=current_setting('qa.game')::uuid;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.game')::uuid;r jsonb;doc uuid;v uuid;code text;i integer;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.minister'),true);
 doc:=create_budget_simulator_document(current_setting('qa.plan')::uuid);
 if jsonb_array_length((select metadata->'budget_amendments' from formal_documents where id=doc))<>1 then raise exception 'FAIL NPA amendment annex';end if;
 if (select body_text from formal_documents where id=doc) not like '%ИСТОРИЯ ПОДГОТОВКИ: ПОПРАВКА QA faction%' then raise exception 'FAIL NPA reason';end if;
 if (select metadata#>>'{budget_snapshot,expense_lines,8,amount}' from formal_documents where id=doc)::numeric<>1914900 then raise exception 'FAIL NPA allocation';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.teacher'),true);
 -- The actual existing legal workflow, not an injected published flag.
 for i in 1..15 loop
  select status_code into code from formal_documents where id=doc;
  exit when code='published';
  if code in ('reading1','reading2','reading3') then
   v:=create_procedural_vote(g,'QA закон о бюджете: '||code,null,'mandate','gd','budget_'||code,'fraction',.5,'eligible_majority',.5,true,false,doc,'advance','reject');
   perform set_config('request.jwt.claim.sub',current_setting('qa.deputy'),true);
   perform cast_vote_allocation(v,400,0,0);
   perform set_config('request.jwt.claim.sub',current_setting('qa.teacher'),true);
   r:=close_procedural_vote(v,'Проект рассмотрен в установленном порядке.');if r->>'result'<>'passed' then raise exception 'FAIL legal vote % %',code,r;end if;
  else
   if code='budget_committee' then perform save_budget_preliminary_review(doc,true,true,true,'Комплект проверен. Заключение подготовлено и материалы направлены участникам предварительного рассмотрения.','accept','Проверка бюджетной процедуры в учебной тестовой группе.');end if;
   perform advance_formal_document(doc,'advance','Материалы проверены. Передаем по процедуре.');
  end if;
 end loop;
 if (select status_code from formal_documents where id=doc)<>'published' then raise exception 'FAIL workflow unfinished';end if;
 r:=get_budget_simulator(g);if r#>>'{state,last_plan_id}'<>current_setting('qa.plan') then raise exception 'FAIL legal publication not enacted';end if;
 if (select count(*) from game_votes where formal_document_id=doc and result_code='passed')<>3 then raise exception 'FAIL three readings';end if;
 if (select internal_debt from budget_simulator_state where game_id=g)<>37436200 then raise exception 'FAIL reallocation changes debt';end if;
end$$;
reset role;
select 'PASS: faction and observer access, RLS, GV, split mandate ballot, preliminary majority, reallocation conservation, replay guard, fiscal staleness, withdrawal, NPA annex and three real legal readings through publication; all fixtures rolled back' as result;
rollback;
