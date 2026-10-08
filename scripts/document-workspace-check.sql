-- Isolated game and fictional student identities; real authenticated RPCs.
-- Requires an existing classroom owner. Every fixture is rolled back.
begin;
do $$ declare g uuid:=gen_random_uuid();p uuid:=gen_random_uuid();admin uuid;a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();begin
 select owner_id into admin from public.games order by created_at limit 1;
 if admin is null then raise exception 'QA requires an existing classroom owner';end if;
 insert into auth.users(id,aud,role) values(a,'authenticated','authenticated'),(b,'authenticated','authenticated');
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open) values(g,'QA civic procedures','QA'||substr(replace(g::text,'-',''),1,10),admin,'running',11,true);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name) values(g,admin,'Проверка преподавателя','teacher','Преподаватель',null);
 insert into public.game_parties(id,game_id,name,mandates,leader_user_id) values(p,g,'QA civic party',450,a);
 insert into public.game_members(game_id,user_id,full_name,kind,role_title,group_name,team) values(g,a,'Проверка А','student','Депутат Государственной Думы','QA','QA civic party'),(g,b,'Проверка Б','student','Депутат Государственной Думы','QA','QA civic party');
 perform set_config('qa.civic_game',g::text,true);perform set_config('qa.civic_party',p::text,true);
 perform set_config('qa.teacher_id',admin::text,true);perform set_config('qa.student_a_id',a::text,true);perform set_config('qa.student_b_id',b::text,true);
end;$$;

do $$ declare g uuid:=current_setting('qa.civic_game')::uuid;a uuid:=current_setting('qa.student_a_id')::uuid;d uuid:=gen_random_uuid();r uuid:=gen_random_uuid();begin
 insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 values(g,a,'Президент Российской Федерации','active',current_setting('qa.teacher_id')::uuid,current_setting('qa.teacher_id')::uuid,'Учебное совмещение',true);
 insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key)
 values(d,g,12,'QA-SIGN','Учебный указ','president_decree','president','Президент Российской Федерации',a,'Первый текст','president_act','[{"code":"president","label":"На подписании","owner":"president","action":"Подписать указ"},{"code":"signed","label":"Подписан","owner":"system"}]',0,'president','На подписании','president'),
 (r,g,12,'QA-VOTE','Учебный закон','fz_bill','gd_deputy','Депутат Государственной Думы',a,'Текст чтения','bill','[{"code":"reading1","label":"I чтение","owner":"gd","action":"Принять в I чтении"},{"code":"reading2","label":"II чтение","owner":"gd"}]',0,'reading1','I чтение','gd');
 perform set_config('qa.sign_doc',d::text,true);perform set_config('qa.vote_doc',r::text,true);
end;$$;
set local role authenticated;
do $$ declare g uuid:=current_setting('qa.civic_game')::uuid;d uuid:=current_setting('qa.sign_doc')::uuid;r uuid:=current_setting('qa.vote_doc')::uuid;a uuid:=current_setting('qa.student_a_id')::uuid;b uuid:=current_setting('qa.student_b_id')::uuid;t uuid:=current_setting('qa.teacher_id')::uuid;blocked boolean;n integer;signed_before text;number_before text;begin
 perform set_config('request.jwt.claim.sub',a::text,true);
 if not (public.get_formal_document_tools(d)->>'can_manage')::boolean then raise exception 'FAIL additional office ignored';end if;
 if not exists(select 1 from jsonb_array_elements_text(public.get_formal_subjects(g)) k where k='president') then raise exception 'FAIL additional document subject missing';end if;
 perform public.create_formal_document(g,12,'Указ по дополнительной должности','president_decree','president','Президент Российской Федерации','Текст указа',null,null,null,'president_act','{}');
 select metadata->>'act_number' into number_before from public.formal_documents where id=d;
 perform public.update_formal_draft(d,'Уточнённый указ','Второй текст','{"act_number":"forged","signed_name":"forged"}');
 if (select metadata->>'act_number' from public.formal_documents where id=d) is distinct from number_before then raise exception 'FAIL document number forged';end if;
 if (select metadata->>'signed_name' from public.formal_documents where id=d) is not null then raise exception 'FAIL signature forged';end if;
 if not exists(select 1 from public.formal_document_revisions where document_id=d and revision=1 and body_text='Первый текст') then raise exception 'FAIL revision missing';end if;
 blocked:=false;begin perform public.update_formal_draft(d,'Старая редакция','Конфликтующий текст','{"expected_revision":1}');exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL stale editor overwrites revision';end if;
 n:=public.send_formal_document(d,'person',b,'Ознакомьтесь с текстом',false);
 if n<>1 or (select status_code from public.formal_documents where id=d)<>'president' then raise exception 'FAIL copy delivery changed workflow';end if;
 blocked:=false;begin perform public.advance_formal_document(r,'advance',null);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL vote bypass allowed';end if;
 perform public.sign_formal_document(d,'Подписано в соответствии с полномочиями');
 if (select status_code from public.formal_documents where id=d)<>'signed' or (select metadata->>'signed_role' from public.formal_documents where id=d)<>'Президент Российской Федерации' then raise exception 'FAIL actual additional office signature';end if;
 select metadata->>'signed_on' into signed_before from public.formal_documents where id=d;
 perform set_config('request.jwt.claim.sub',b::text,true);
 if not exists(select 1 from public.formal_document_deliveries where document_id=d and recipient_id=b) then raise exception 'FAIL recipient inbox visibility';end if;
 blocked:=false;begin perform public.update_formal_draft(d,'Чужой текст','Изменение',null);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL foreign edit allowed';end if;
 blocked:=false;begin perform public.sign_formal_document(d,null);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL foreign signature allowed';end if;
 perform set_config('request.jwt.claim.sub',t::text,true);
 perform public.update_formal_draft(d,'Редакция преподавателя','Третий текст','{"edit_note":"Поправка"}');
 if (select metadata->>'signed_on' from public.formal_documents where id=d) is distinct from signed_before then raise exception 'FAIL editing silently signs revision';end if;
 if not (public.get_formal_document_tools(d)->>'can_sign')::boolean then raise exception 'FAIL amended document cannot sign';end if;
 perform public.sign_formal_document(d,'Подписана новая редакция');
 if (select (metadata->>'signed_on')::timestamptz < (metadata->>'revision_changed_at')::timestamptz from public.formal_documents where id=d) then raise exception 'FAIL signature timestamp before revision';end if;
 blocked:=false;begin perform public.send_formal_document(d,'person',gen_random_uuid(),null,false);exception when others then blocked:=true;end;
 if not blocked then raise exception 'FAIL foreign recipient accepted';end if;
end;$$;
select jsonb_build_object('additional_office','PASS','assigned_document_subject','PASS','concurrent_revision_guard','PASS','revision_archive','PASS','protected_number_and_signature','PASS','copy_delivery','PASS','mandatory_vote_guard','PASS','foreign_edit_and_sign','PASS','teacher_amendment','PASS','revision_signing','PASS','recipient_guard','PASS') as checks;
rollback;
