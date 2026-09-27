-- Presidential veto, federal budget workflow and conciliation branches.

create or replace function private.formal_workflow(p_key text)
returns jsonb
language sql
immutable
set search_path=''
as $$
select case p_key
when 'bill' then '[
 {"code":"draft","label":"Черновик","owner":"author","action":"Внести в Государственную Думу"},
 {"code":"registered","label":"Зарегистрирован в ГД","owner":"gd_staff","action":"Направить в профильный комитет"},
 {"code":"committee","label":"Профильный комитет","owner":"committee","action":"Передать в Совет ГД"},
 {"code":"council","label":"Совет Государственной Думы","owner":"gd_council","action":"Назначить I чтение"},
 {"code":"reading1","label":"I чтение","owner":"gd","action":"Принять в I чтении"},
 {"code":"amendments","label":"Поправки и подготовка ко II чтению","owner":"committee","action":"Передать на II чтение"},
 {"code":"reading2","label":"II чтение","owner":"gd","action":"Принять во II чтении"},
 {"code":"reading3","label":"III чтение","owner":"gd","action":"Принять закон"},
 {"code":"sf","label":"Совет Федерации","owner":"sf","action":"Одобрить"},
 {"code":"president","label":"Президент Российской Федерации","owner":"president","action":"Подписать"},
 {"code":"published","label":"Подписан и опубликован","owner":"system","action":null}
]'::jsonb
when 'budget' then '[
 {"code":"draft","label":"Проект федерального бюджета","owner":"author","action":"Внести в Правительство"},
 {"code":"government","label":"Правительство / Минфин","owner":"government","action":"Внести проект в Государственную Думу"},
 {"code":"reading1","label":"I чтение бюджета","owner":"gd","action":"Принять основные характеристики"},
 {"code":"amendments","label":"Поправки ко II чтению","owner":"committee","action":"Передать на II чтение"},
 {"code":"reading2","label":"II чтение бюджета","owner":"gd","action":"Принять поправки"},
 {"code":"reading3","label":"III чтение бюджета","owner":"gd","action":"Принять бюджет в целом"},
 {"code":"sf","label":"Совет Федерации","owner":"sf","action":"Рассмотреть бюджет"},
 {"code":"president","label":"Президент Российской Федерации","owner":"president","action":"Подписать бюджет"},
 {"code":"published","label":"Подписан и опубликован","owner":"system","action":null}
]'::jsonb
when 'president_act' then '[
 {"code":"draft","label":"Проект акта Президента","owner":"author","action":"Передать на правовую подготовку"},
 {"code":"review","label":"Правовая подготовка","owner":"president","action":"Подписать Президентом"},
 {"code":"signed","label":"Подписан Президентом","owner":"president","action":"Направить на опубликование"},
 {"code":"published","label":"Официально опубликован","owner":"system","action":null}
]'::jsonb
when 'government_act' then '[
 {"code":"draft","label":"Проект акта Правительства","owner":"author","action":"Внести в Правительство"},
 {"code":"agenda","label":"В повестке Правительства","owner":"government","action":"Рассмотреть на заседании"},
 {"code":"adopted","label":"Принят Правительством","owner":"government","action":"Подписать и опубликовать"},
 {"code":"published","label":"Подписан и опубликован","owner":"system","action":null}
]'::jsonb
when 'gd_resolution' then '[
 {"code":"draft","label":"Проект постановления ГД","owner":"author","action":"Внести в Совет ГД"},
 {"code":"agenda","label":"В повестке Государственной Думы","owner":"gd_council","action":"Поставить на голосование"},
 {"code":"adopted","label":"Принято Государственной Думой","owner":"gd_staff","action":"Оформить и опубликовать"},
 {"code":"published","label":"Оформлено","owner":"system","action":null}
]'::jsonb
when 'sf_resolution' then '[
 {"code":"draft","label":"Проект постановления СФ","owner":"author","action":"Внести в Совет Федерации"},
 {"code":"agenda","label":"На рассмотрении Совета Федерации","owner":"sf","action":"Поставить на голосование"},
 {"code":"adopted","label":"Принято Советом Федерации","owner":"sf","action":"Оформить"},
 {"code":"published","label":"Оформлено","owner":"system","action":null}
]'::jsonb
when 'ministry_act' then '[
 {"code":"draft","label":"Проект ведомственного акта","owner":"author","action":"Передать на согласование"},
 {"code":"review","label":"Ведомственное согласование","owner":"ministry","action":"Подписать"},
 {"code":"signed","label":"Подписан министром","owner":"ministry","action":"Опубликовать"},
 {"code":"published","label":"Опубликован","owner":"system","action":null}
]'::jsonb
when 'municipal_act' then '[
 {"code":"draft","label":"Проект муниципального акта","owner":"author","action":"Внести на рассмотрение"},
 {"code":"meeting","label":"Рассмотрение муниципальным органом","owner":"municipality","action":"Принять"},
 {"code":"adopted","label":"Принят","owner":"municipality","action":"Оформить"},
 {"code":"published","label":"Оформлен","owner":"system","action":null}
]'::jsonb
else '[
 {"code":"draft","label":"Черновик","owner":"author","action":"Передать на рассмотрение"},
 {"code":"review","label":"На рассмотрении","owner":"teacher","action":"Принять"},
 {"code":"published","label":"Принят","owner":"system","action":null}
]'::jsonb end;
$$;

create or replace function public.veto_formal_document(p_document_id uuid,p_note text default null)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_status text;v_label text;v_owner text;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null then raise exception 'Document not found';end if;
 if d.current_owner_key<>'president' or d.status_code<>'president' then raise exception 'Document is not awaiting presidential decision';end if;
 if not (private.is_game_teacher(d.game_id) or private.matches_formal_owner(d.game_id,v_uid,'president',d.author_id)) then raise exception 'Presidential authority required';end if;
 if d.workflow_key='budget' then
  v_status:='budget_conciliation';v_label:='Согласительная комиссия после отклонения Президентом';v_owner:='committee';
 else
  v_status:='president_veto';v_label:='Отклонён Президентом Российской Федерации (вето)';v_owner:='gd_council';
 end if;
 update public.formal_documents set status_code=v_status,status_label=v_label,current_owner_key=v_owner,updated_at=now() where id=d.id;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,v_uid,case when d.workflow_key='budget' then 'Президент отклонил закон о бюджете: созывается согласительная комиссия' else 'Президент отклонил федеральный закон (вето)' end,d.status_code,v_status,d.current_owner_key,v_owner,p_note);
end;
$$;
revoke all on function public.veto_formal_document(uuid,text) from public,anon;
grant execute on function public.veto_formal_document(uuid,text) to authenticated;

create or replace function public.resolve_budget_conciliation(p_document_id uuid,p_action text,p_note text default null)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_step jsonb;v_next integer;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null or d.workflow_key<>'budget' or d.status_code<>'budget_conciliation' then raise exception 'Budget is not in conciliation';end if;
 if not (private.is_game_teacher(d.game_id) or private.vote_member_matches(d.game_id,v_uid,'gd') or private.vote_member_matches(d.game_id,v_uid,'government') or private.vote_member_matches(d.game_id,v_uid,'sf')) then raise exception 'Conciliation commission role required';end if;
 if p_action='agreed' then
  v_next:=2;v_step:=d.workflow_steps->v_next;
  update public.formal_documents set current_step=v_next,status_code=v_step->>'code',status_label='Повторное I чтение после согласительной комиссии',current_owner_key=v_step->>'owner',updated_at=now() where id=d.id;
 elsif p_action='government_revision' then
  v_next:=1;v_step:=d.workflow_steps->v_next;
  update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён Правительству на доработку',current_owner_key='government',updated_at=now() where id=d.id;
 else raise exception 'Unsupported conciliation action';end if;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 select d.id,d.game_id,v_uid,case when p_action='agreed' then 'Согласительная комиссия выработала согласованный вариант' else 'Бюджет возвращён Правительству на доработку' end,d.status_code,fd.status_code,d.current_owner_key,fd.current_owner_key,p_note from public.formal_documents fd where fd.id=d.id;
end;
$$;
revoke all on function public.resolve_budget_conciliation(uuid,text,text) from public,anon;
grant execute on function public.resolve_budget_conciliation(uuid,text,text) to authenticated;

create or replace function private.apply_formal_vote_transition(p_document uuid,p_transition text,p_actor uuid,p_vote uuid,p_note text)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare d public.formal_documents%rowtype;v_step jsonb;v_next integer;v_action text;
begin
 if p_document is null or p_transition='none' then return;end if;
 select * into d from public.formal_documents where id=p_document for update;
 if d.id is null then return;end if;
 if p_transition='advance' then
  if d.workflow_key='bill' and d.status_code='reading3' then
   v_next:=d.current_step+2;v_step:=d.workflow_steps->v_next;
   update public.formal_documents set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',current_owner_key=v_step->>'owner',updated_at=now() where id=d.id;
   v_action:='Закон принят ГД; Совет Федерации автоматически одобрил его по правилам игры; направлен Президенту';
  else
   v_next:=d.current_step+1;if v_next>=jsonb_array_length(d.workflow_steps) then return;end if;
   v_step:=d.workflow_steps->v_next;
   update public.formal_documents set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',current_owner_key=v_step->>'owner',updated_at=now() where id=d.id;
   v_action:='Документ продвинут по результатам голосования';
  end if;
 elsif p_transition='reject' then
  update public.formal_documents set status_code='rejected',status_label='Отклонён голосованием',current_owner_key='system',updated_at=now() where id=d.id;v_action:='Документ отклонён голосованием';
 elsif p_transition='return_author' then
  v_step:=d.workflow_steps->0;
  update public.formal_documents set current_step=0,status_code='revision',status_label='Возвращён автору по результатам голосования',current_owner_key='author',updated_at=now() where id=d.id;v_action:='Документ возвращён автору по результатам голосования';
 elsif p_transition='return_previous' then
  v_next:=greatest(0,d.current_step-1);v_step:=d.workflow_steps->v_next;
  update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён на предыдущую стадию',current_owner_key=v_step->>'owner',updated_at=now() where id=d.id;v_action:='Документ возвращён на предыдущую стадию по результатам голосования';
 else return;end if;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 select d.id,d.game_id,p_actor,v_action,d.status_code,fd.status_code,d.current_owner_key,fd.current_owner_key,'Голосование '||p_vote::text||coalesce(' · '||nullif(p_note,''),'') from public.formal_documents fd where fd.id=d.id;
end;
$$;

create or replace function public.create_formal_document(
 p_game_id uuid,p_stage_no integer,p_title text,p_doc_type text,p_subject_key text,p_subject_label text,
 p_body_text text,p_file_path text,p_file_name text,p_mime text,p_workflow_key text,p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare v_id uuid:=gen_random_uuid();v_uid uuid:=(select auth.uid());v_steps jsonb;v_prefix text;v_no bigint;v_registry text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 if not private.can_create_formal_subject(p_game_id,v_uid,p_subject_key) then raise exception 'Your game role cannot create a document for this subject';end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Document title is required';end if;
 v_steps:=private.formal_workflow(p_workflow_key);
 v_prefix:=case p_doc_type when 'fz_bill' then 'ЗП-ФЗ' when 'fkz_bill' then 'ЗП-ФКЗ' when 'federal_budget' then 'ФБ' when 'president_decree' then 'УК' when 'president_order' then 'РП' when 'government_resolution' then 'ПП' when 'government_order' then 'РПР' when 'gd_resolution' then 'ПГД' when 'sf_resolution' then 'ПСФ' when 'ministry_order' then 'ПР' when 'state_program' then 'ГП' when 'municipal_act' then 'МСУ' else 'НПА' end;
 v_no:=nextval('public.formal_registry_seq');v_registry:='ИГРА-'||v_prefix||'-'||lpad(v_no::text,4,'0');
 insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,source_file_path,source_file_name,source_mime_type,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
 values(v_id,p_game_id,p_stage_no,v_registry,trim(p_title),p_doc_type,p_subject_key,p_subject_label,v_uid,nullif(p_body_text,''),p_file_path,p_file_name,p_mime,p_workflow_key,v_steps,0,v_steps->0->>'code',v_steps->0->>'label',v_steps->0->>'owner',coalesce(p_metadata,'{}'::jsonb));
 insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note) values(v_id,p_game_id,v_uid,'Создан документ',v_steps->0->>'code',v_steps->0->>'owner','Черновик создан в системе');
 return v_id;
end;
$$;
revoke all on function public.create_formal_document(uuid,integer,text,text,text,text,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.create_formal_document(uuid,integer,text,text,text,text,text,text,text,text,text,jsonb) to authenticated;
