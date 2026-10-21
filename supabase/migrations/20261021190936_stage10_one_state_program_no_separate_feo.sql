-- Stage 10: match programme documents to the Work form and allow one ready programme.
DO $migration$
DECLARE body text; old_text text;
BEGIN
 body := pg_get_functiondef('private.stage_required_final_documents(uuid,integer)'::regprocedure);
 old_text := '(10,''financial_economic'',''Финансово-экономическое обоснование'',''other'',''government''),';
 IF position(old_text in body)=0 THEN RAISE EXCEPTION 'Expected Stage 10 FEO requirement is absent'; END IF;
 body := replace(body,old_text,'');
 body := replace(body,'x.template_key IN (''state_program'',''financial_economic'')','x.template_key = ''state_program''');
 EXECUTE body;
 body := pg_get_functiondef('private.stage_readiness_json(uuid,integer)'::regprocedure);
 old_text := 'if c2<5 then b:=b||jsonb_build_array(''Создано менее пяти государственных программ — по одной для каждого игрового министерства''); end if;';
 IF position(old_text in body)=0 THEN RAISE EXCEPTION 'Expected Stage 10 five-programme blocker is absent'; END IF;
 body := replace(body,old_text,'if c2<1 then b:=b||jsonb_build_array(''Не создано ни одной государственной программы''); end if;');
 old_text := 'if c3>0 then b:=b||jsonb_build_array(''Есть государственные программы, не прошедшие этап разработки и предварительного согласования''); end if;';
 IF position(old_text in body)=0 THEN RAISE EXCEPTION 'Expected Stage 10 unfinished-programme blocker is absent'; END IF;
 body := replace(body,old_text,
 'if c3>0 then w:=w||jsonb_build_array(''Есть государственные программы, не прошедшие этап разработки и предварительного согласования''); end if;' ||
 chr(10) || '  if c2>0 and not exists (select 1 from public.state_programs where game_id=p_game and status in (''ready'',''government_vote'',''adopted'')) then b:=b||jsonb_build_array(''Ни одна государственная программа не готова к рассмотрению Правительством''); end if;');
 EXECUTE body;
END;
$migration$;