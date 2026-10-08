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
-- Standalone authority setup: the positive cases quote the saved twenty-day
-- revision, not a body obtained from another script. Keep original revisions.
do $$declare g uuid:=current_setting('qa.bill_game')::uuid;t uuid:=current_setting('qa.bill_teacher')::uuid;a uuid:=current_setting('qa.bill_a')::uuid;b uuid:=current_setting('qa.bill_b')::uuid;d uuid:=current_setting('qa.bill_document')::uuid;fkz uuid:=current_setting('qa.bill_fkz')::uuid;amendment uuid;begin
 perform set_config('request.jwt.claim.sub',t::text,true);
 perform public.set_student_mandates(current_setting('qa.bill_party')::uuid,jsonb_build_object(a::text,225,b::text,225));
 perform public.update_formal_draft(fkz,'QA FKZ amendment bill','Статья 1. Срок составляет двадцать дней.','{"edit_note":"QA independent authority revision"}');
 perform public.update_formal_draft(d,'QA amendment bill',E'Статья 1. Срок составляет двадцать дней.\nСтатья 2. Отчёт предоставляется ежеквартально.','{"edit_note":"QA independent audit revision"}');
 if not exists(select 1 from public.formal_document_revisions where document_id=fkz and body_text like '%десять дней%')
  or not exists(select 1 from public.formal_document_revisions where document_id=d and body_text like '%десять дней%') then raise exception 'FAIL independent authority revision snapshots';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);perform public.register_institution_session(g,'gd');
 amendment:=public.submit_bill_amendment(d,'gd_deputy','двадцать дней','сорок дней','QA retained amendment history for delete guards.',null);
 perform public.withdraw_bill_amendment(amendment);
 perform set_config('request.jwt.claim.sub',b::text,true);perform public.register_institution_session(g,'gd');
end;$$;
-- A teacher membership authorizes this classroom; global admin authority does
-- not depend on classroom membership. Both still use the amendment RPCs.
do $$declare d uuid:=current_setting('qa.bill_fkz')::uuid;amendment uuid;v uuid;r jsonb;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.bill_member_teacher'),true);r:=public.get_bill_amendments(d);
 if (r->>'can_manage')::boolean is distinct from true or (r->>'can_submit')::boolean is distinct from true then raise exception 'FAIL target classroom teacher powers';end if;
 amendment:=public.submit_bill_amendment(d,'gd_deputy','двадцать дней','сорок дней','QA classroom teacher proposal.',null);perform public.withdraw_bill_amendment(amendment);
 perform set_config('request.jwt.claim.sub',current_setting('qa.bill_admin'),true);
 if exists(select 1 from public.game_members where game_id=current_setting('qa.bill_game')::uuid and user_id=auth.uid()) then raise exception 'FAIL admin fixture unexpectedly has membership';end if;
 r:=public.get_bill_amendments(d);if (r->>'can_manage')::boolean is distinct from true or (r->>'can_submit')::boolean is distinct from true then raise exception 'FAIL admin without membership powers';end if;
 amendment:=public.submit_bill_amendment(d,'gd_deputy','двадцать дней','сорок дней','QA global administrator proposal.',null);
 v:=public.open_bill_amendment_vote(d,array[amendment]);r:=public.close_bill_amendment_vote(v,'QA global admin close without membership');
 if r->>'result'<>'rejected' or (r->>'quorum')::boolean is distinct from true
  or not exists(select 1 from jsonb_array_elements(public.get_bill_amendments(d)->'amendments') entry where entry->>'id'=amendment::text and entry->>'status'='rejected')
  then raise exception 'FAIL admin without membership mutation';end if;
end;$$;
-- Active read-only observer; outsider teacher does not inherit cross-game rights.
do $$declare d uuid:=current_setting('qa.bill_document')::uuid;bad boolean;r jsonb;begin
 perform set_config('request.jwt.claim.sub',current_setting('qa.bill_observer'),true);r:=public.get_bill_amendments(d);
 if (r->>'can_manage')::boolean or (r->>'can_submit')::boolean or jsonb_array_length(r->'subjects')<>0 then raise exception 'FAIL observer powers';end if;
 bad:=false;begin perform public.submit_bill_amendment(d,'gd_deputy','двадцать дней','пятьдесят дней','QA observer request.',null);exception when others then if sqlerrm not like '%полномочий%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL observer submit';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.bill_other_teacher'),true);
 if exists(select 1 from public.bill_amendments) then raise exception 'FAIL cross-game amendment RLS';end if;
 bad:=false;begin perform public.get_bill_amendments(d);exception when others then if sqlerrm not like '%Нет доступа%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL outsider teacher read';end if;
end;$$;
reset role;
do $$declare d uuid:=current_setting('qa.bill_document')::uuid;amendment uuid;bad boolean;begin
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,roster_archived_at)
 values(current_setting('qa.bill_game')::uuid,current_setting('qa.bill_admin')::uuid,'QA archived global admin','teacher','Преподаватель',now());
 perform set_config('request.jwt.claim.sub',current_setting('qa.bill_admin'),true);
 amendment:=public.submit_bill_amendment(current_setting('qa.bill_fkz')::uuid,'gd_deputy','двадцать дней','сорок дней','QA global authority survives roster archival.',null);
 perform public.withdraw_bill_amendment(amendment);
 update public.game_members set roster_archived_at=now() where game_id=current_setting('qa.bill_game')::uuid and user_id=current_setting('qa.bill_b')::uuid;
 perform set_config('request.jwt.claim.sub',current_setting('qa.bill_b'),true);
 bad:=false;begin perform public.submit_bill_amendment(d,'gd_deputy','двадцать дней','пятьдесят дней','QA archived member request.',null);exception when others then if sqlerrm not like '%полномочий%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL archived member submit';end if;
 if has_function_privilege('anon','public.open_bill_amendment_vote(uuid,uuid[])','EXECUTE') or has_function_privilege('anon','public.close_bill_amendment_vote(uuid,text)','EXECUTE') or has_function_privilege('authenticated','private.can_manage_bill_amendments(uuid,uuid)','EXECUTE')
  or has_function_privilege('authenticated','private.lock_bill_amendment_actor(uuid,uuid)','EXECUTE') or has_function_privilege('anon','private.lock_bill_amendment_actor(uuid,uuid)','EXECUTE') or has_table_privilege('authenticated','public.bill_amendment_packs','INSERT') then raise exception 'FAIL privileged helper or write grant';end if;
 perform set_config('request.jwt.claim.sub',current_setting('qa.bill_teacher'),true);
 bad:=false;begin delete from public.formal_documents where id=d;exception when others then if sqlerrm not like '%историей поправок%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL bill audit delete guard';end if;
 bad:=false;begin delete from public.bill_amendments where document_id=d;exception when others then if sqlerrm not like '%История поправок%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL amendment audit delete guard';end if;
 delete from public.games where id=current_setting('qa.bill_game')::uuid;
 if exists(select 1 from public.bill_amendments where document_id=d) or exists(select 1 from public.bill_amendment_packs where document_id=d) or exists(select 1 from public.formal_documents where id=d) then raise exception 'FAIL whole game cascade';end if;
end;$$;
select 'PASS bill authority: unchanged legacy definitions, teacher/admin scope, observer/outsider/archive denial, revision snapshots, immutable audit deletion and whole-game cascade' as result;
rollback;
