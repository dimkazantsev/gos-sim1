-- Fictional identities/classrooms only. Run after the migration; complete rollback.
begin;
-- Fingerprints were read from the existing live definitions before this feature.
-- The isolated migration must leave both legacy functions byte-for-byte intact.
do $$begin
 if md5(pg_get_functiondef('public.create_procedural_vote(uuid,text,text,text,text,text,text,numeric,text,numeric,boolean,boolean,uuid,text,text)'::regprocedure))<>'65bb28bb7fd7f0343e99ac7ce0b23e10'
  or md5(pg_get_functiondef('public.close_procedural_vote(uuid,text)'::regprocedure))<>'59534c38fb95055b541c5d45ae508e7d'
  then raise exception 'FAIL legacy voting definitions changed';end if;
end;$$;
do $$declare g uuid:=gen_random_uuid();other_game uuid:=gen_random_uuid();t uuid:=gen_random_uuid();other_teacher uuid:=gen_random_uuid();member_teacher uuid:=gen_random_uuid();admin_user uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();committee uuid:=gen_random_uuid();observer uuid:=gen_random_uuid();party uuid:=gen_random_uuid();unit uuid:=gen_random_uuid();d uuid:=gen_random_uuid();fkz_bill uuid:=gen_random_uuid();zero_bill uuid:=gen_random_uuid();foreign_bill uuid:=gen_random_uuid();steps jsonb;begin
 insert into auth.users(id,aud,role) values(t,'authenticated','authenticated'),(other_teacher,'authenticated','authenticated'),(member_teacher,'authenticated','authenticated'),(admin_user,'authenticated','authenticated'),(a,'authenticated','authenticated'),(b,'authenticated','authenticated'),(committee,'authenticated','authenticated'),(observer,'authenticated','authenticated');
 insert into public.platform_admins(user_id,granted_by) values(admin_user,t);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open)
 values(g,'QA bill amendments','QA'||substr(replace(g::text,'-',''),1,12),t,'running',12,true),(other_game,'QA foreign amendments','QA'||substr(replace(other_game::text,'-',''),1,12),other_teacher,'running',12,true);
 insert into public.game_stages(game_id,stage_no,title,mode,summary,status)
 select fixture.game_id,n,'QA stage '||n,'Учебная процедура','QA',case when n=12 then 'open' else 'locked' end from (values(g),(other_game))fixture(game_id),generate_series(1,16)n;
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,team)
 values(g,t,'QA teacher','teacher','Преподаватель',null),(other_game,other_teacher,'QA foreign teacher','teacher','Преподаватель',null),
 (g,member_teacher,'QA classroom teacher','teacher','Преподаватель',null),
 (g,a,'QA deputy chair','student','Депутат Государственной Думы · Председатель Государственной Думы','QA amendment party'),
 (g,b,'QA deputy','student','Депутат Государственной Думы','QA amendment party'),
 (g,committee,'QA committee member','student','Участник профильного комитета',null),(g,observer,'QA observer','observer','Наблюдатель',null);
 insert into public.game_parties(id,game_id,name,mandates,leader_user_id) values(party,g,'QA amendment party',450,a);
 insert into public.institution_units(id,game_id,unit_kind,unit_key,title,head_user_id) values(unit,g,'committee','qa-bill-committee','QA committee',committee);
 steps:=private.formal_workflow('bill');
 insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key)
 values(d,g,12,'QA-BILL-AMEND','QA amendment bill','fz_bill','gd_deputy','Депутат ГД',a,E'Статья 1. Срок составляет десять дней.\nСтатья 2. Отчёт предоставляется ежеквартально.','bill',steps,(select ordinality::integer-1 from jsonb_array_elements(steps)with ordinality s where s.value->>'code'='reading2'),'reading2','II чтение','gd'),
 (fkz_bill,g,12,'QA-FKZ-AMEND','QA FKZ amendment bill','fkz_bill','gd_deputy','Депутат ГД',a,'Статья 1. Срок составляет десять дней.','bill',steps,(select ordinality::integer-1 from jsonb_array_elements(steps)with ordinality s where s.value->>'code'='reading2'),'reading2','II чтение','gd'),
 (zero_bill,g,12,'QA-BILL-ZERO','QA bill without amendments','fz_bill','gd_deputy','Депутат ГД',a,'Законопроект без поправок.','bill',steps,(select ordinality::integer-1 from jsonb_array_elements(steps)with ordinality s where s.value->>'code'='reading2'),'reading2','II чтение','gd'),
 (foreign_bill,other_game,12,'QA-BILL-FOREIGN','QA foreign bill','fz_bill','gd_deputy','Депутат ГД',other_teacher,'Чужой законопроект.','bill',steps,(select ordinality::integer-1 from jsonb_array_elements(steps)with ordinality s where s.value->>'code'='reading2'),'reading2','II чтение','gd');
 insert into public.bill_submission_profiles(document_id,game_id,committee_key) values(d,g,'qa-bill-committee'),(fkz_bill,g,'qa-bill-committee');
 perform set_config('qa.bill_fkz',fkz_bill::text,true);
 perform set_config('qa.bill_member_teacher',member_teacher::text,true);perform set_config('qa.bill_admin',admin_user::text,true);
 perform set_config('qa.bill_game',g::text,true);perform set_config('qa.bill_teacher',t::text,true);perform set_config('qa.bill_other_teacher',other_teacher::text,true);perform set_config('qa.bill_a',a::text,true);perform set_config('qa.bill_b',b::text,true);perform set_config('qa.bill_committee',committee::text,true);perform set_config('qa.bill_observer',observer::text,true);perform set_config('qa.bill_party',party::text,true);perform set_config('qa.bill_document',d::text,true);perform set_config('qa.bill_zero',zero_bill::text,true);perform set_config('qa.bill_foreign',foreign_bill::text,true);
end;$$;
set local role authenticated;
do $$declare g uuid:=current_setting('qa.bill_game')::uuid;t uuid:=current_setting('qa.bill_teacher')::uuid;a uuid:=current_setting('qa.bill_a')::uuid;b uuid:=current_setting('qa.bill_b')::uuid;begin
 perform set_config('request.jwt.claim.sub',t::text,true);
 perform public.set_student_mandates(current_setting('qa.bill_party')::uuid,jsonb_build_object(a::text,225,b::text,225));
 perform set_config('request.jwt.claim.sub',a::text,true);perform public.register_institution_session(g,'gd');
 perform set_config('request.jwt.claim.sub',b::text,true);perform public.register_institution_session(g,'gd');
end;$$;
-- FKZ amendments require at least 300 of all 450 mandates, even with quorum:
-- 226 and 299 are rejected; exactly 300 passes without a rounding-induced 301.
do $$declare g uuid:=current_setting('qa.bill_game')::uuid;a uuid:=current_setting('qa.bill_a')::uuid;b uuid:=current_setting('qa.bill_b')::uuid;c uuid:=current_setting('qa.bill_committee')::uuid;d uuid:=current_setting('qa.bill_fkz')::uuid;support integer;amendment uuid;v uuid;result jsonb;expected text;begin
 foreach support in array array[226,299,300] loop
  perform set_config('request.jwt.claim.sub',a::text,true);
  amendment:=public.submit_bill_amendment(d,'gd_deputy','десять дней','двадцать дней','QA exact FKZ threshold: '||support||' votes.',null);
  perform set_config('request.jwt.claim.sub',c::text,true);v:=public.open_bill_amendment_vote(d,array[amendment]);
  if (select majority_kind from public.game_votes where id=v)<>'eligible_fraction'
   or (select majority_value from public.game_votes where id=v) is distinct from 2.0/3 then raise exception 'FAIL FKZ protocol threshold at % votes',support;end if;
  perform set_config('request.jwt.claim.sub',a::text,true);perform public.register_institution_session(g,'gd');perform public.cast_vote_allocation(v,225,0,0);
  perform set_config('request.jwt.claim.sub',b::text,true);perform public.register_institution_session(g,'gd');perform public.cast_vote_allocation(v,support-225,450-support,0);
  perform set_config('request.jwt.claim.sub',c::text,true);result:=public.close_bill_amendment_vote(v,'QA exact FKZ threshold');
  expected:=case when support=300 then 'passed' else 'rejected' end;
  if result->>'result' is distinct from expected or (result->>'quorum')::boolean is distinct from true
   or (result->>'yes')::numeric<>support or (result->>'eligible')::numeric<>450 or (result->>'present')::numeric<>450 or (result->>'needed')::numeric<>226
   then raise exception 'FAIL FKZ % votes with registered quorum: %',support,result;end if;
  if (select status from public.bill_amendments where id=amendment) is distinct from (case when support=300 then 'accepted' else 'rejected' end)
   or (select status_code from public.formal_documents where id=d)<>'reading2'
   or ((select body_text from public.formal_documents where id=d) like '%двадцать дней%') is distinct from (support=300)
   then raise exception 'FAIL FKZ amendment application or whole-bill advance at % votes',support;end if;
 end loop;
end;$$;
reset role;
select 'PASS FKZ: unchanged legacy definitions, registered 450 electorate, 226/299 reject and exact 300 accept, no whole-bill advance' as result;
rollback;
