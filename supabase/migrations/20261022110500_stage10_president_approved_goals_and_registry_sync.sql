-- ГОС.ID · Этап 10: Президент утверждает 5–6 целей в послании.
-- Использует действующие presidential_priorities, без второй конкурирующей модели целей.
-- Черновики госпрограмм автоматически регистрируются в том же реестре, что вкладка «Документы».
CREATE OR REPLACE FUNCTION public.set_presidential_address_goals(p_address_id uuid,p_goals text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp AS $fn$
DECLARE a public.presidential_addresses%ROWTYPE;
 v_uid uuid:=auth.uid();v_goal text;v_no integer:=0;
 v_allowed text[]:=ARRAY[
 'Сохранение населения, укрепление здоровья и повышение благополучия людей, поддержка семьи',
 'Реализация потенциала каждого человека, развитие его талантов, воспитание патриотичной и социально ответственной личности',
 'Комфортная и безопасная среда для жизни',
 'Экологическое благополучие',
 'Устойчивая и динамичная экономика',
 'Технологическое лидерство',
 'Цифровая трансформация государственного и муниципального управления, экономики и социальной сферы'];
BEGIN
 SELECT * INTO a FROM public.presidential_addresses WHERE id=p_address_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Послание не найдено';END IF;
 IF v_uid IS NULL OR NOT private.can_manage_presidential_policy(a.game_id,v_uid) THEN RAISE EXCEPTION 'Утверждать цели вправе Президент';END IF;
 IF a.status<>'draft' THEN RAISE EXCEPTION 'Опубликованное послание нельзя изменять';END IF;
 IF coalesce(array_length(p_goals,1),0) NOT BETWEEN 5 AND 6 THEN RAISE EXCEPTION 'Выберите 5 или 6 национальных целей';END IF;
 IF EXISTS (SELECT 1 FROM unnest(p_goals) AS goal WHERE goal IS NULL OR NOT goal=ANY(v_allowed))
 OR (SELECT count(DISTINCT goal) FROM unnest(p_goals) AS goal)<>array_length(p_goals,1) THEN
  RAISE EXCEPTION 'Цели должны быть различными и входить в перечень национальных целей';
 END IF;
 -- Для незавершённых старых посланий не удаляем произвольные приоритеты без согласия владельца.
 IF EXISTS (SELECT 1 FROM public.presidential_priorities p WHERE p.address_id=a.id
   AND (p.national_goal IS NULL OR p.title IS DISTINCT FROM p.national_goal OR p.description IS NOT NULL))
 THEN RAISE EXCEPTION 'В послании уже есть отдельные приоритеты. Сначала согласуйте их сохранение';END IF;
 DELETE FROM public.presidential_priorities WHERE address_id=a.id;
 FOREACH v_goal IN ARRAY p_goals LOOP
   v_no:=v_no+1;
   INSERT INTO public.presidential_priorities(address_id,game_id,priority_no,title,national_goal)
   VALUES (a.id,a.game_id,v_no,v_goal,v_goal);
 END LOOP;
 UPDATE public.presidential_addresses SET updated_at=now() WHERE id=a.id;
END $fn$;
REVOKE ALL ON FUNCTION public.set_presidential_address_goals(uuid,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_presidential_address_goals(uuid,text[]) TO authenticated;

-- Синхронизация опубликованного послания со вкладкой «Документы» без повторных публикаций.
CREATE UNIQUE INDEX IF NOT EXISTS formal_presidential_address_source_uq
ON public.formal_documents(game_id,(metadata->>'presidential_address_id'))
WHERE metadata ? 'presidential_address_id' AND stage_no=10;

CREATE OR REPLACE FUNCTION private.sync_presidential_address_registry(p_address_id uuid,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp AS $fn$
DECLARE a public.presidential_addresses%ROWTYPE;v_steps jsonb;v_list text;v_doc_id uuid;
BEGIN
 SELECT * INTO a FROM public.presidential_addresses WHERE id=p_address_id;
 IF a.id IS NULL OR a.status<>'published' THEN RAISE EXCEPTION 'Для реестра требуется опубликованное послание';END IF;
 IF EXISTS(SELECT 1 FROM public.formal_documents WHERE game_id=a.game_id AND stage_no=10
  AND metadata->>'presidential_address_id'=a.id::text) THEN RETURN;END IF;
 SELECT string_agg(priority_no::text||'. '||national_goal,E'\n' ORDER BY priority_no)
 INTO v_list FROM public.presidential_priorities WHERE address_id=a.id;
 v_steps:=private.formal_workflow('generic');
 v_doc_id:=gen_random_uuid();
 INSERT INTO public.formal_documents(
  id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,
  workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
 ) VALUES(
  v_doc_id,a.game_id,10,'ГОС.ID-НПА-'||lpad(nextval('public.formal_registry_seq')::text,4,'0'),
  a.title,'other','president','Президент Российской Федерации',p_actor,
  a.body_text||E'\n\nУтверждённые национальные цели:\n'||coalesce(v_list,''),
  'generic',v_steps,jsonb_array_length(v_steps)-1,'published','Опубликовано','system',
  jsonb_build_object('document_kind','presidential_address','presidential_address_id',a.id,
    'auto_synced',true,'approved_by',p_actor,'approved_goals',coalesce(v_list,''))
 );
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
 VALUES(v_doc_id,a.game_id,p_actor,'Зарегистрировано послание Президента','draft','published',
  'Послание и 5–6 целей опубликованы Президентом; источник — раздел «Работа».');
END $fn$;
REVOKE ALL ON FUNCTION private.sync_presidential_address_registry(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.publish_presidential_address(p_address_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp AS $fn$
DECLARE a public.presidential_addresses%ROWTYPE;v_uid uuid:=auth.uid();v_count integer;
BEGIN
 SELECT * INTO a FROM public.presidential_addresses WHERE id=p_address_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Послание не найдено';END IF;
 IF v_uid IS NULL OR NOT private.can_manage_presidential_policy(a.game_id,v_uid) THEN RAISE EXCEPTION 'Публикация доступна Президенту';END IF;
 IF a.status<>'draft' THEN RAISE EXCEPTION 'Послание уже опубликовано';END IF;
 SELECT count(*) INTO v_count FROM public.presidential_priorities
 WHERE address_id=a.id AND national_goal IS NOT NULL AND title=national_goal;
 IF v_count NOT BETWEEN 5 AND 6 OR
  (SELECT count(*) FROM public.presidential_priorities WHERE address_id=a.id)<>v_count
 THEN RAISE EXCEPTION 'Президент должен утвердить 5 или 6 целей до публикации послания';END IF;
 UPDATE public.presidential_addresses SET status='published',published_at=now(),updated_at=now() WHERE id=a.id;
 INSERT INTO public.game_events(game_id,round_no,category,severity,title,body,created_by)
 VALUES(a.game_id,10,'Послание Президента','notice','Опубликовано послание Президента Федеральному Собранию',a.title,v_uid);
 -- Послание и официальный список целей доступны в том же Реестре НПА.
 PERFORM private.sync_presidential_address_registry(a.id,v_uid);
END $fn$;
REVOKE ALL ON FUNCTION public.publish_presidential_address(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publish_presidential_address(uuid) TO authenticated;

-- Один документ на одну программу. Никаких дополнительных подписок и повторных записей при обновлении.
CREATE UNIQUE INDEX IF NOT EXISTS formal_stage10_program_source_uq
ON public.formal_documents(game_id,(metadata->>'state_program_id'))
WHERE doc_type='state_program' AND stage_no=10 AND metadata ? 'state_program_id';

CREATE OR REPLACE FUNCTION private.sync_state_program_registry(p_program_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp AS $fn$
DECLARE p public.state_programs%ROWTYPE;d public.formal_documents%ROWTYPE;
 v_uid uuid:=auth.uid();v_title text;v_body text;v_goals text;v_components text;v_expenses text;v_steps jsonb;
 v_id uuid;v_rev integer;v_meta jsonb;
BEGIN
 SELECT * INTO p FROM public.state_programs WHERE id=p_program_id;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Программа не найдена';END IF;
 IF v_uid IS NULL OR NOT private.can_edit_state_program(p.id,v_uid) THEN RAISE EXCEPTION 'Нет доступа к редактированию программы';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('state-program-formal:'||p.id::text,0));
 SELECT * INTO d FROM public.formal_documents
 WHERE game_id=p.game_id AND stage_no=10 AND doc_type='state_program'
 AND metadata->>'state_program_id'=p.id::text FOR UPDATE;
 v_title:='Государственная программа «'||p.title||'»';
 SELECT string_agg('• '||goal_text||' — '||indicator_name,E'\n' ORDER BY created_at,id)
 INTO v_goals FROM public.state_program_goals WHERE program_id=p.id;
 SELECT string_agg('• '||title||': '||goal_text,E'\n' ORDER BY direction_no,created_at,id)
 INTO v_components FROM public.state_program_components WHERE program_id=p.id;
 SELECT string_agg('• '||budget_year::text||': '||indicator_name||' — '||amount::text||' руб. ('||justification||')',E'\n' ORDER BY position,id)
 INTO v_expenses FROM public.state_program_expenses WHERE program_id=p.id;
 v_body:='ПАСПОРТ ГОСУДАРСТВЕННОЙ ПРОГРАММЫ'||E'\n'||
 'Наименование: '||p.title||E'\n'||
 'Ответственный исполнитель: '||p.responsible_ministry||E'\n'||
 'Ответственный министр: '||coalesce((SELECT full_name FROM public.game_members WHERE game_id=p.game_id AND user_id=p.responsible_minister_id LIMIT 1),'Не назначен')||E'\n'||
 'Куратор: '||coalesce((SELECT full_name FROM public.game_members WHERE game_id=p.game_id AND user_id=p.curator_id LIMIT 1),'Не назначен')||E'\n'||
 'Участники: '||coalesce(p.participants,'Не определены')||E'\n'||
 'Национальная цель: '||coalesce(p.national_goal,'Не выбрана')||E'\n'||
 'Срок реализации: '||coalesce(p.start_date::text,'Не указан')||' — '||coalesce(p.end_date::text,'Не указан')||E'\n'||
 'Ожидаемые результаты: '||coalesce(p.expected_results,'Не определены')||E'\n\n'||
 'Цели и показатели:'||E'\n'||coalesce(v_goals,'Ещё не заполнены')||E'\n\n'||
 'Мероприятия:'||E'\n'||coalesce(v_components,'Ещё не заполнены')||E'\n\n'||
 'Финансово-экономическое обоснование:'||E'\n'||
 coalesce(v_expenses,'Ещё не заполнено')||E'\n\n'||
 'Общий объём финансирования: '||p.total_budget::text||' руб.';
 v_meta:=jsonb_build_object('document_kind','stage10_state_program','state_program_id',p.id,
   'source','state_program_editor','auto_synced',true);
 IF d.id IS NULL THEN
   v_steps:=private.formal_workflow('government_act');
   v_id:=gen_random_uuid();
   INSERT INTO public.formal_documents(
     id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
     body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata
   ) VALUES(
     v_id,p.game_id,10,'ГОС.ID-ГП-'||lpad(nextval('public.formal_registry_seq')::text,4,'0'),
     v_title,'state_program','ministry',p.responsible_ministry,p.created_by,
     v_body,'government_act',v_steps,0,v_steps->0->>'code',v_steps->0->>'label',
     v_steps->0->>'owner',v_meta
   );
   INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,to_status,note)
   VALUES(v_id,p.game_id,v_uid,'Синхронизирована государственная программа','draft',
    'Черновик автоматически зарегистрирован из раздела «Работа».');
 ELSIF d.status_code NOT IN ('draft','revision')
   AND (d.title IS DISTINCT FROM v_title OR d.body_text IS DISTINCT FROM v_body) THEN
   RAISE EXCEPTION 'Документ государственной программы уже передан на рассмотрение; верните его на доработку перед редактированием программы';
 ELSIF d.metadata->>'auto_synced'='true' AND d.status_code IN ('draft','revision')
   AND (d.title IS DISTINCT FROM v_title OR d.body_text IS DISTINCT FROM v_body) THEN
   -- Все прежние версии сохраняются. Если документ передан на рассмотрение, не переписываем его.
   SELECT coalesce(max(revision),0)+1 INTO v_rev FROM public.formal_document_revisions WHERE document_id=d.id;
   INSERT INTO public.formal_document_revisions(game_id,document_id,revision,title,body_text,metadata,editor_id)
   VALUES(p.game_id,d.id,v_rev,d.title,d.body_text,d.metadata,v_uid);
   UPDATE public.formal_documents SET title=v_title,body_text=v_body,subject_label=p.responsible_ministry,
     metadata=d.metadata||v_meta,updated_at=now() WHERE id=d.id;
   INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,note)
   VALUES(d.id,p.game_id,v_uid,'Обновлена версия государственной программы',d.status_code,d.status_code,
     'Новая версия получена из раздела «Работа»; предыдущая сохранена.');
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION private.sync_state_program_registry(uuid) FROM PUBLIC,anon,authenticated;

-- Встраиваем синхронизацию строго после сохранения всех строк программы;
-- гарантированно одна транзакция, без триггера на каждую бюджетную строку.
DO $patch$
DECLARE v_sql text;v_needle text:='perform private.replace_state_program_rows(v_program_id,p_payload);';
BEGIN
 v_sql:=pg_get_functiondef('public.save_state_program_draft(uuid,uuid,jsonb,boolean)'::regprocedure);
 IF position('private.sync_state_program_registry' IN v_sql)>0 THEN RETURN;END IF;
 IF position(v_needle IN v_sql)=0 THEN
   RAISE EXCEPTION 'Изменилась функция сохранения программ. Автоматическое применение небезопасно';
 END IF;
 v_sql:=replace(v_sql,v_needle,
   v_needle||E'\n perform private.sync_state_program_registry(v_program_id);');
 -- Подтверждение требует официально утверждённой Президентом цели;
 -- черновик по-прежнему разрешено сохранять до послания.
 v_needle:='if p_confirm then perform public.advance_state_program(v_program_id,''submit_minister'');end if;';
 IF position(v_needle IN v_sql)=0 THEN RAISE EXCEPTION 'Нет ожидаемого блока подтверждения программы';END IF;
 v_sql:=replace(v_sql,v_needle,
   E'if p_confirm and not exists (select 1 from public.presidential_priorities pr join public.presidential_addresses a on a.id=pr.address_id where pr.game_id=p_game_id and a.status=''published'' and pr.national_goal=p_payload->>''national_goal'') then raise exception ''Для направления программы выберите цель, утверждённую Президентом в опубликованном послании'';end if;\n'
   ||v_needle);
 EXECUTE v_sql;
END $patch$;

-- Состояния послания и программы должны своевременно поступать участникам иных устройств.
-- Публикация ограничена четырьмя связанными таблицами, без широких подписок на другие разделы.
DO $realtime$
DECLARE v_table text;
BEGIN
 FOREACH v_table IN ARRAY ARRAY['presidential_addresses','presidential_priorities','state_programs'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables
     WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=v_table)
   THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
   END IF;
 END LOOP;
END $realtime$;
