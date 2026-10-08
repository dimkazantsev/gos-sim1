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
do $$declare g uuid:=current_setting('qa.bill_game')::uuid;t uuid:=current_setting('qa.bill_teacher')::uuid;a uuid:=current_setting('qa.bill_a')::uuid;b uuid:=current_setting('qa.bill_b')::uuid;c uuid:=current_setting('qa.bill_committee')::uuid;d uuid:=current_setting('qa.bill_document')::uuid;fkz uuid:=current_setting('qa.bill_fkz')::uuid;amendment uuid;overlap uuid;second uuid;third uuid;v uuid;result jsonb;bad boolean;body text;begin
 perform set_config('request.jwt.claim.sub',t::text,true);
 perform public.set_student_mandates(current_setting('qa.bill_party')::uuid,jsonb_build_object(a::text,225,b::text,225));
 bad:=false;begin perform public.create_civic_vote(g,'QA invented amendment pack',null,'mandate','gd','bill_amendments','fraction',.5,'eligible_majority',.5,true,false,null,'none','none',null);
  exception when others then if sqlerrm not like '%проверенного пакета%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL generic creator invented an amendment pack';end if;
 -- An FKZ's two-thirds majority still requires registered quorum.
 perform set_config('request.jwt.claim.sub',a::text,true);
 amendment:=public.submit_bill_amendment(fkz,'gd_deputy','десять дней','двадцать дней','QA FKZ without registered quorum.',null);
 perform set_config('request.jwt.claim.sub',c::text,true);v:=public.open_bill_amendment_vote(fkz,array[amendment]);result:=public.close_bill_amendment_vote(v,'QA FKZ no registration');
 if result->>'result'<>'no_quorum' or (result->>'quorum')::boolean or (result->>'eligible')::numeric<>450 or (result->>'needed')::numeric<>226
  or (select status from public.bill_amendments where id=amendment)<>'submitted' or (select body_text from public.formal_documents where id=fkz) like '%двадцать%' then raise exception 'FAIL FKZ no-quorum reset';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);perform public.withdraw_bill_amendment(amendment);
 perform set_config('request.jwt.claim.sub',t::text,true);
 bad:=false;begin perform public.submit_bill_amendment(d,'ks','десять дней','двадцать дней','QA rationale for court.',null);exception when others then if sqlerrm not like '%ведения%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL missing court competence';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 bad:=false;begin perform public.submit_bill_amendment(d,'gd_deputy','несуществующая цитата','новый текст','QA rationale text.',null);exception when others then if sqlerrm not like '%однозначно%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL nonexistent quote';end if;
 bad:=false;begin perform public.submit_bill_amendment(d,'gd_deputy','Статья','Новая статья','QA rationale text.',null);exception when others then if sqlerrm not like '%однозначно%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL ambiguous quote';end if;
 amendment:=public.submit_bill_amendment(d,'gd_deputy','десять дней','двадцать дней','QA reason for changing deadline.',null);
 if (select body_text from public.formal_documents where id=d) like '%двадцать%' then raise exception 'FAIL submit changed document';end if;
 bad:=false;begin perform public.create_civic_vote(g,'QA premature second reading',null,'mandate','gd','bill_reading2','fraction',.5,'eligible_majority',.5,true,false,d,'advance','reject',null);exception when others then if sqlerrm not like '%рассмотрения всех поправок%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL pending amendment whole vote';end if;
 bad:=false;begin perform public.advance_formal_document(d,'return','QA return');exception when others then if sqlerrm not like '%все поправки%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL pending amendment transition';end if;
 bad:=false;begin perform public.open_bill_amendment_vote(d,array[amendment,amendment]);exception when others then if sqlerrm not like '%разных поправок%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL duplicate pack IDs';end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 overlap:=public.submit_bill_amendment(d,'gd_deputy','Срок составляет десять дней','Срок составляет тридцать дней','QA overlapping alternative.',null);
 bad:=false;begin perform public.withdraw_bill_amendment(amendment);exception when others then if sqlerrm not like '%автор%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL withdraw foreign author';end if;
 perform set_config('request.jwt.claim.sub',c::text,true);
 bad:=false;begin perform public.open_bill_amendment_vote(d,array[amendment,overlap]);exception when others then if sqlerrm not like '%перекрывают%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL overlapping pack';end if;
 perform set_config('request.jwt.claim.sub',b::text,true);perform public.withdraw_bill_amendment(overlap);
 perform set_config('request.jwt.claim.sub',c::text,true);v:=public.open_bill_amendment_vote(d,array[amendment]);
 if (select formal_document_id from public.game_votes where id=v) is not null or (select institution_key from public.game_votes where id=v)<>'gd' or (select electorate_snapshot->>'eligible' from public.game_votes where id=v)<>'450'
  or (select majority_kind from public.game_votes where id=v)<>'eligible_majority' or (select majority_value from public.game_votes where id=v)<>0.5 then raise exception 'FAIL dedicated FZ vote link, fixed electorate or strict half threshold';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);bad:=false;begin perform public.withdraw_bill_amendment(amendment);exception when others then if sqlerrm not like '%до голосования%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL withdraw during vote';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);bad:=false;begin perform public.update_formal_draft(d,'QA amendment bill','Попытка изменить зафиксированный текст','{"edit_note":"QA frozen text"}');exception when others then if sqlerrm not like '%зафиксирован%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL edit during pack vote';end if;
 perform set_config('request.jwt.claim.sub',c::text,true);result:=public.close_bill_amendment_vote(v,'QA no registration');
 if result->>'result'<>'no_quorum' or (select status from public.bill_amendments where id=amendment)<>'submitted' or (select status_code from public.formal_documents where id=d)<>'reading2' then raise exception 'FAIL no quorum does not reset amendment';end if;
 v:=public.open_bill_amendment_vote(d,array[amendment]);
 perform set_config('request.jwt.claim.sub',a::text,true);perform public.register_institution_session(g,'gd');perform public.cast_vote_allocation(v,225,0,0);
 perform set_config('request.jwt.claim.sub',b::text,true);perform public.register_institution_session(g,'gd');perform public.cast_vote_allocation(v,0,225,0);
 perform set_config('request.jwt.claim.sub',c::text,true);result:=public.close_bill_amendment_vote(v,'QA negative result');
 if result->>'result'<>'rejected' or (select status from public.bill_amendments where id=amendment)<>'rejected' or (select body_text from public.formal_documents where id=d) like '%двадцать%' then raise exception 'FAIL negative vote changes text';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);second:=public.submit_bill_amendment(d,'gd_deputy','десять дней','двадцать дней','QA accepted deadline change.',null);
 perform set_config('request.jwt.claim.sub',b::text,true);third:=public.submit_bill_amendment(d,'gd_deputy','ежеквартально','ежемесячно','QA accepted reporting change.',null);
 perform set_config('request.jwt.claim.sub',c::text,true);v:=public.open_bill_amendment_vote(d,array[third,second]);
 perform set_config('request.jwt.claim.sub',a::text,true);perform public.cast_vote_allocation(v,225,0,0);
 perform set_config('request.jwt.claim.sub',b::text,true);perform public.cast_vote_allocation(v,225,0,0);
 perform set_config('request.jwt.claim.sub',c::text,true);result:=public.close_bill_amendment_vote(v,'QA accepted pack');
 select body_text into body from public.formal_documents where id=d;
 if result->>'result'<>'passed' or body not like '%двадцать дней%' or body not like '%ежемесячно%' or (select status_code from public.formal_documents where id=d)<>'reading2' or (select count(*) from public.bill_amendments where id in(second,third) and status='accepted')<>2 then raise exception 'FAIL atomic accepted pack or unintended bill advance';end if;
 if not exists(select 1 from public.bill_amendment_packs where vote_id=v and source_body_text like '%десять дней%' and result_body_text=body) or not exists(select 1 from public.formal_document_revisions where document_id=d and body_text like '%десять дней%') then raise exception 'FAIL audit snapshots';end if;
 -- Repeated close is harmless and does not apply the text or revision twice.
 perform public.close_bill_amendment_vote(v,'QA repeated close');if (select (metadata->>'revision')::integer from public.formal_documents where id=d)<>2 then raise exception 'FAIL repeated close reapplies pack';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);amendment:=public.submit_bill_amendment(d,'gd_deputy','двадцать дней','сорок дней','QA amendment that becomes stale.',null);
 perform set_config('request.jwt.claim.sub',t::text,true);perform public.update_formal_draft(d,'QA amendment bill',replace(body,'ежемесячно','каждый месяц'),'{"edit_note":"QA ordinary revision"}');
 perform set_config('request.jwt.claim.sub',c::text,true);bad:=false;begin perform public.open_bill_amendment_vote(d,array[amendment]);exception when others then if sqlerrm not like '%Текст изменился%' then raise;end if;bad:=true;end;if not bad then raise exception 'FAIL stale source accepted';end if;
 perform public.reject_bill_amendment(amendment,'QA source text changed; new submission required.');
 perform set_config('request.jwt.claim.sub',a::text,true);
 v:=public.create_civic_vote(g,'QA completed second reading',null,'mandate','gd','bill_reading2','fraction',.5,'eligible_majority',.5,true,false,d,'advance','reject',null);
 perform public.cast_vote_allocation(v,225,0,0);perform set_config('request.jwt.claim.sub',b::text,true);perform public.cast_vote_allocation(v,225,0,0);perform set_config('request.jwt.claim.sub',a::text,true);perform public.close_procedural_vote(v,'QA whole reading');
 if (select status_code from public.formal_documents where id=d)<>'reading3' then raise exception 'FAIL subsequent whole bill route';end if;
 v:=public.create_civic_vote(g,'QA zero amendment route',null,'mandate','gd','bill_reading2','fraction',.5,'eligible_majority',.5,true,false,current_setting('qa.bill_zero')::uuid,'advance','reject',null);
 if v is null then raise exception 'FAIL zero amendment route blocked';end if;
 bad:=false;begin perform public.close_bill_amendment_vote(v,'QA unrelated legacy vote');exception when others then if sqlerrm not like '%не связано с пакетом%' then raise;end if;bad:=true;end;
 if not bad or (select status from public.game_votes where id=v)<>'open' then raise exception 'FAIL amendment closer changed unrelated legacy vote';end if;
 perform public.close_procedural_vote(v,'QA close zero amendment fixture');
 bad:=false;begin update public.bill_amendments set old_text='Direct write';exception when insufficient_privilege then bad:=true;end;if not bad then raise exception 'FAIL direct amendment write';end if;
 perform set_config('qa.bill_test_vote',v::text,true);
end;$$;
reset role;
select 'PASS bill workflow: unchanged legacy definitions, pack guards, quoted text, overlaps, quorum, rejection, accepted snapshots, stale revision, whole reading and zero-amendment route' as result;
rollback;
