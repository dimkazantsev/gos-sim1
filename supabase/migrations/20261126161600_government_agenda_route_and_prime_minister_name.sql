-- Canonical meeting route: preserve the existing server-side signing gate.
-- Collective agenda approval is rendered from the linked vote, not inferred from publication.
DO $patch$
DECLARE v_def text;
 v_old constant text:='v_kind IN (''institution_meeting_agenda'',''duma_session_agenda'')';
 v_new constant text:='v_kind IN (''institution_meeting_agenda'',''duma_session_agenda'',''government_session_agenda'')';
 v_capture constant text:='snapshot:=jsonb_build_object(''signed_name'',person,''signed_role'',office,''signed_on'',signed_time,''signed_by'',new.actor_id);';
 v_identity constant text:='  -- For Ministry of Justice replies the signature office comes from the issuing';
BEGIN
 v_def:=pg_get_functiondef('private.normalize_institution_meeting_document_route()'::regprocedure);
 IF strpos(v_def,v_new)=0 THEN
  IF strpos(v_def,v_old)=0 THEN RAISE EXCEPTION 'Meeting route source changed';END IF;
  v_def:=replace(v_def,v_old,v_new);
  v_def:=replace(v_def,'''Повестка утверждена'';','CASE WHEN v_kind=''government_session_agenda'' THEN ''Повестка подписана'' ELSE ''Повестка утверждена'' END;');
  EXECUTE v_def;
 END IF;
 -- Store the actual appointed role name at signing time, without substituting
 -- a different participant or changing the signature image.
 v_def:=pg_get_functiondef('private.capture_formal_document_signature()'::regprocedure);
 IF strpos(v_def,'-- Prime minister appointment name at signing')=0 THEN
  IF strpos(v_def,v_capture)=0 THEN RAISE EXCEPTION 'Signature snapshot source changed';END IF;
  EXECUTE replace(v_def,v_capture,
  ' -- Prime minister appointment name at signing'||E'\n'||
  ' if office ~* ''^председатель[[:space:]]+правительства([[:space:]]|$)'' then'||E'\n'||
  '  select coalesce((select nullif(btrim(n.candidate_name),'''') from public.government_nominations n where n.game_id=new.game_id and n.candidate_user_id=new.actor_id and n.office_key=''prime_minister'' and n.appointed_at<=signed_time order by n.appointed_at desc,n.created_at desc limit 1),person) into person;'||E'\n'||
  ' end if;'||E'\n '||v_capture);
 END IF;
 -- Historical snapshot repair is driven by existing verified signature rows,
 -- matching actor, appointment date and office, not by client-supplied names.
 v_def:=pg_get_functiondef('private.prepare_formal_identity()'::regprocedure);
 IF strpos(v_def,'-- Correct verified prime minister snapshots')=0 THEN
  IF strpos(v_def,v_identity)=0 THEN RAISE EXCEPTION 'Document identity source changed';END IF;
  EXECUTE replace(v_def,v_identity,
  '  -- Correct verified prime minister snapshots'||E'\n'||
  '  if new.metadata->>''signed_role'' ~* ''^председатель[[:space:]]+правительства([[:space:]]|$)'' and new.metadata ? ''signed_by'' and new.metadata ? ''signed_on'' and exists(select 1 from public.formal_document_signatures f where f.document_id=new.id and f.game_id=new.game_id and f.signer_id::text=new.metadata->>''signed_by'') then'||E'\n'||
  '   select coalesce((select nullif(btrim(n.candidate_name),'''') from public.government_nominations n where n.game_id=new.game_id and n.candidate_user_id::text=new.metadata->>''signed_by'' and n.office_key=''prime_minister'' and n.appointed_at<=(new.metadata->>''signed_on'')::timestamptz order by n.appointed_at desc,n.created_at desc limit 1),new.metadata->>''signed_name'') into v_issuer;'||E'\n'||
  '   if v_issuer is not null then new.metadata:=jsonb_set(new.metadata,''{signed_name}'',to_jsonb(v_issuer),true);end if;'||E'\n'||
  '  end if;'||E'\n'||v_identity);
 END IF;
END $patch$;
DO $repair$
DECLARE d record; n integer:=0;
BEGIN
 -- Only active games, existing linked agendas, valid signatures and exact session scope.
 FOR d IN SELECT f.id,s.id session_id FROM public.formal_documents f
 JOIN public.government_sessions s ON s.agenda_document_id=f.id AND s.game_id=f.game_id
 JOIN public.games g ON g.id=f.game_id
 WHERE g.status='running' AND f.doc_type='meeting_agenda'
 AND f.metadata->>'document_kind'='government_session_agenda'
 AND f.status_code IN ('draft','published')
 AND (f.status_code='draft' OR private.agenda_approved_or_signed(f.id))
 AND (jsonb_array_length(f.workflow_steps)<>2 OR f.current_step<>CASE WHEN f.status_code='published' THEN 1 ELSE 0 END)
 LOOP
  PERFORM set_config('app.gos_government_agenda_session',d.session_id::text,true);
  UPDATE public.formal_documents SET workflow_steps=workflow_steps,current_step=current_step WHERE id=d.id;
  PERFORM set_config('app.gos_government_agenda_session','',true);
  n:=n+1;
 END LOOP;
 -- Correct only an existing signed name supported by a personal signature.
 UPDATE public.formal_documents f SET metadata=f.metadata
 FROM public.games g WHERE g.id=f.game_id AND g.status='running'
 AND f.doc_type NOT IN ('meeting_agenda','minutes')
 AND f.metadata->>'signed_role' ~* '^председатель[[:space:]]+правительства([[:space:]]|$)'
 AND EXISTS(SELECT 1 FROM public.formal_document_signatures sig WHERE sig.document_id=f.id AND sig.game_id=f.game_id AND sig.signer_id::text=f.metadata->>'signed_by')
 AND f.metadata->>'signed_name' IS DISTINCT FROM (SELECT n.candidate_name FROM public.government_nominations n WHERE n.game_id=f.game_id AND n.candidate_user_id::text=f.metadata->>'signed_by' AND n.office_key='prime_minister' AND n.appointed_at<=(f.metadata->>'signed_on')::timestamptz ORDER BY n.appointed_at DESC,n.created_at DESC LIMIT 1)
 AND EXISTS(SELECT 1 FROM public.government_nominations n WHERE n.game_id=f.game_id AND n.candidate_user_id::text=f.metadata->>'signed_by' AND n.office_key='prime_minister' AND n.appointed_at<=(f.metadata->>'signed_on')::timestamptz);
END $repair$;
