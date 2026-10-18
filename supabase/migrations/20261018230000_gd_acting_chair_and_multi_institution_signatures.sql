-- ГОС.ID. Реальное председательствование и персональные подписи на документах ГД и КСРФ.
-- Ранее опубликованные документы не считаются подписанными задним числом.
CREATE OR REPLACE FUNCTION private.gd_presiding_officer(p_game uuid,p_stage integer)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp
AS $fn$
DECLARE v_chair uuid;v_count integer;v_presiding uuid;
BEGIN
 SELECT a.user_id INTO v_chair FROM public.game_office_assignments a
 JOIN public.game_members gm ON gm.game_id=a.game_id AND gm.user_id=a.user_id
 WHERE a.game_id=p_game AND a.status='active'
   AND lower(btrim(a.role_title))='председатель государственной думы'
   AND gm.kind='student' AND gm.roster_archived_at IS NULL
 ORDER BY a.created_at DESC LIMIT 1;
 SELECT count(*) INTO v_count FROM public.institution_session_registrations
 WHERE game_id=p_game AND stage_no=p_stage AND institution_key='gd';
 IF v_count=0 THEN RETURN v_chair; END IF;
 IF v_chair IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.institution_session_registrations r
  WHERE r.game_id=p_game AND r.stage_no=p_stage AND r.institution_key='gd'
    AND r.user_id=v_chair AND private.gd_effective_present(p_game,v_chair,r.present_mandates)>0
 ) THEN RETURN v_chair; END IF;
 SELECT a.user_id INTO v_presiding
 FROM public.game_office_assignments a
 JOIN public.game_members gm ON gm.game_id=a.game_id AND gm.user_id=a.user_id
 JOIN public.institution_session_registrations r ON r.game_id=a.game_id
   AND r.user_id=a.user_id AND r.stage_no=p_stage AND r.institution_key='gd'
 WHERE a.game_id=p_game AND a.status='active'
   AND lower(a.role_title) LIKE 'заместитель председателя государственной думы%'
   AND gm.kind='student' AND gm.roster_archived_at IS NULL
   AND private.gd_effective_present(p_game,a.user_id,r.present_mandates)>0
 ORDER BY CASE WHEN a.role_title LIKE '%№1%' THEN 0
               WHEN a.role_title LIKE '%№2%' THEN 1 ELSE 2 END,
          a.created_at,a.user_id LIMIT 1;
 RETURN v_presiding;
END;$fn$;
REVOKE ALL ON FUNCTION private.gd_presiding_officer(uuid,integer) FROM PUBLIC,anon,authenticated;

-- Координация заседания ГД: Председатель при явке, иначе первый присутствующий заместитель.
-- Существующие особые полномочия этапа 4 до избрания Председателя сохраняются.
CREATE OR REPLACE FUNCTION private.can_coordinate_institution_meeting(
 p_game uuid,p_institution text,p_uid uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp
AS $fn$
DECLARE v_stage integer;
BEGIN
 IF p_uid IS NULL THEN RETURN false; END IF;
 IF private.is_game_teacher(p_game) THEN RETURN true; END IF;
 IF p_institution='ksrf' THEN RETURN private.party_led_by(p_game,p_uid) IS NOT NULL; END IF;
 IF p_institution='gd' THEN
  SELECT stage_no INTO v_stage FROM public.game_stages
   WHERE game_id=p_game AND status='open' AND stage_no>=4
   ORDER BY stage_no LIMIT 1;
  IF v_stage IS NULL THEN
   SELECT stage_no INTO v_stage FROM public.game_stages
    WHERE game_id=p_game AND stage_no>=4 AND status='completed'
    ORDER BY stage_no DESC LIMIT 1;
  END IF;
  IF v_stage IS NOT NULL AND private.gd_presiding_officer(p_game,v_stage)=p_uid
    AND private.role_is_available(p_game,p_uid) THEN RETURN true; END IF;
  -- Другая специальная роль совета может вести организационную работу,
  -- но не получает право личной подписи Председателя.
  RETURN private.role_is_available(p_game,p_uid) AND
   EXISTS(SELECT 1 FROM private.formal_user_roles(p_game,p_uid) r WHERE r LIKE '%совет%дум%');
 END IF;
 IF EXISTS(SELECT 1 FROM public.institution_units u
  WHERE u.game_id=p_game AND 'unit:'||u.id::text=p_institution AND u.head_user_id=p_uid)
 THEN RETURN true; END IF;
 RETURN EXISTS(
  SELECT 1 FROM public.game_office_assignments o
   WHERE o.game_id=p_game AND o.user_id=p_uid AND o.status='active'
     AND o.role_title ~* 'председател|руководител|глава|директор'
     AND private.role_matches_voting_body(o.role_title,p_institution)
 );
END;$fn$;
REVOKE ALL ON FUNCTION private.can_coordinate_institution_meeting(uuid,text,uuid) FROM PUBLIC,anon,authenticated;

-- Определение требуемых подписантов: для КСРФ — действующие лидеры зарегистрированных фракций;
-- для ГД — фактически председательствующий по регистрации на заседание.
CREATE OR REPLACE FUNCTION private.institution_document_signers(p_document uuid)
RETURNS TABLE(user_id uuid,office text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp
AS $fn$
DECLARE d public.formal_documents%rowtype;v_signer uuid;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document;
 IF d.id IS NULL OR d.status_code NOT IN ('published','adopted','signed') THEN RETURN; END IF;
 IF d.subject_key='ksrf' THEN
  RETURN QUERY SELECT DISTINCT p.leader_user_id,
    'Председатель фракции «'||p.name||'» (КСРФ)'::text
  FROM public.game_parties p
  JOIN public.game_members gm ON gm.game_id=p.game_id AND gm.user_id=p.leader_user_id
  WHERE p.game_id=d.game_id AND p.registration_status='registered'
    AND gm.kind='student' AND gm.roster_archived_at IS NULL
  ORDER BY 1,2;
 ELSIF d.subject_key='gd' THEN
  -- A signed GD act has exactly one authentic signatory. A later attendance
  -- change cannot replace the signature already attached to the act.
  SELECT s.signer_id INTO v_signer FROM public.formal_document_signatures s
   WHERE s.document_id=d.id
    AND s.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)
   ORDER BY s.signed_at,s.id LIMIT 1;
  IF v_signer IS NULL THEN v_signer:=private.gd_presiding_officer(d.game_id,d.stage_no); END IF;
  IF v_signer IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT v_signer,
   CASE WHEN EXISTS(SELECT 1 FROM public.game_office_assignments a
    WHERE a.game_id=d.game_id AND a.user_id=v_signer
      AND lower(btrim(a.role_title))='председатель государственной думы')
   THEN 'Председатель Государственной Думы Федерального Собрания Российской Федерации'::text
   ELSE 'Исполняющий обязанности Председателя Государственной Думы Федерального Собрания Российской Федерации'::text END;
 END IF;
END;$fn$;
REVOKE ALL ON FUNCTION private.institution_document_signers(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_institution_document_signers(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp
AS $fn$
DECLARE d public.formal_documents%rowtype;v_uid uuid:=auth.uid();v_needed jsonb;v_can boolean;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id;
 IF d.id IS NULL OR v_uid IS NULL OR NOT private.is_game_member(d.game_id)
 THEN RAISE EXCEPTION 'Документ недоступен' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'user_id',s.user_id,'office',s.office,
  'signed',EXISTS(SELECT 1 FROM public.formal_document_signatures x
    WHERE x.document_id=d.id AND x.signer_id=s.user_id
      AND x.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz))
 ) ORDER BY s.office,s.user_id),'[]'::jsonb) INTO v_needed
 FROM private.institution_document_signers(d.id) s;
 SELECT EXISTS(SELECT 1 FROM private.institution_document_signers(d.id) s
  WHERE s.user_id=v_uid
    AND NOT EXISTS(SELECT 1 FROM public.formal_document_signatures x
      WHERE x.document_id=d.id AND x.signer_id=v_uid
        AND x.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)))
 INTO v_can;
 RETURN jsonb_build_object('required',v_needed,'can_sign',v_can);
END;$fn$;
REVOKE ALL ON FUNCTION public.get_institution_document_signers(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_institution_document_signers(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sign_institution_document(p_document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp
AS $fn$
DECLARE d public.formal_documents%rowtype;v_uid uuid:=auth.uid();v_office text;v_signature text;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF d.id IS NULL OR v_uid IS NULL OR NOT private.is_game_member(d.game_id)
 THEN RAISE EXCEPTION 'Документ недоступен' USING ERRCODE='42501'; END IF;
 IF d.status_code NOT IN ('published','adopted','signed')
 THEN RAISE EXCEPTION 'Документ ещё не принят и не опубликован' USING ERRCODE='23514'; END IF;
 IF NOT private.role_is_available(d.game_id,v_uid)
 THEN RAISE EXCEPTION 'Полномочия подписанта недоступны' USING ERRCODE='42501'; END IF;
 SELECT s.office INTO v_office FROM private.institution_document_signers(d.id) s
 WHERE s.user_id=v_uid LIMIT 1;
 IF v_office IS NULL THEN RAISE EXCEPTION 'Подписание поручено другому уполномоченному лицу' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.formal_document_signatures s
   WHERE s.document_id=d.id
     AND (s.signer_id=v_uid OR d.subject_key='gd')
     AND s.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz))
 THEN RAISE EXCEPTION 'Эта редакция уже подписана уполномоченным лицом' USING ERRCODE='23505'; END IF;
 SELECT signature_path INTO v_signature FROM public.game_profiles
  WHERE game_id=d.game_id AND user_id=v_uid;
 IF nullif(v_signature,'') IS NULL
 THEN RAISE EXCEPTION 'Сначала сохраните изображение личной подписи в профиле' USING ERRCODE='23514'; END IF;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,
  from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,d.game_id,v_uid,'Подписан документ уполномоченным лицом',
  d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,v_office);
 -- Исторический триггер capture_formal_document_signature сохраняет персональный
 -- снимок изображения и подпись в журнале без изменения содержания документа.
END;$fn$;
REVOKE ALL ON FUNCTION public.sign_institution_document(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sign_institution_document(uuid) TO authenticated;

-- Сохранение подписей завершённых этапов без обхода блокировок редактирования.
CREATE OR REPLACE FUNCTION private.capture_formal_document_signature()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare sig text;person text;office text;snapshot jsonb;signed_time timestamptz:=clock_timestamp();
begin
 if new.action like 'Сохранена редакция %' then return new;end if;
 if new.action='Подписан документ уполномоченным лицом' then
  -- Separate immutable signature: no metadata UPDATE of a completed-stage document.
  -- The signer is authenticated and verified by sign_institution_document RPC.
  select p.signature_path into sig from public.game_profiles p
   where p.game_id=new.game_id and p.user_id=new.actor_id;
  if nullif(sig,'') is null then raise exception 'Личная подпись не загружена';end if;
  insert into public.formal_document_signatures(document_id,game_id,history_id,signer_id,signature_path,signed_at)
  values(new.document_id,new.game_id,new.id,new.actor_id,sig,signed_time)
  on conflict(history_id) do nothing;
  return new;
 end if;

 if new.actor_id is null then return new;end if;
 if coalesce(new.to_status,'')<>'signed' and coalesce(trim(new.action),'') !~* '^подпис'
  and coalesce(trim(new.note),'') !~* '^подписан(о|а)' then return new;end if;
 select gm.full_name,gm.role_title into person,office from public.game_members gm where gm.game_id=new.game_id and gm.user_id=new.actor_id;
 select coalesce((select a.role_title from public.game_office_assignments a where a.game_id=new.game_id and a.user_id=new.actor_id and a.status='active' and case new.from_owner when 'president' then lower(a.role_title) like '%президент%' when 'ministry' then lower(a.role_title) like '%министр%' when 'government' then lower(a.role_title) like '%правительств%' when 'municipality' then lower(a.role_title) like '%муницип%' when 'gd' then lower(a.role_title) like '%дум%' else false end order by a.created_at desc limit 1),office) into office;
 snapshot:=jsonb_build_object('signed_name',person,'signed_role',office,'signed_on',signed_time,'signed_by',new.actor_id);
 perform set_config('app.formal_signature_snapshot',snapshot::text,true);
 update public.formal_documents set metadata=coalesce(metadata,'{}'::jsonb)||snapshot where id=new.document_id;
 perform set_config('app.formal_signature_snapshot','{}',true);
 select p.signature_path into sig from public.game_profiles p where p.game_id=new.game_id and p.user_id=new.actor_id;
 if sig is not null then
  insert into public.formal_document_signatures(document_id,game_id,history_id,signer_id,signature_path,signed_at)
  values(new.document_id,new.game_id,new.id,new.actor_id,sig,signed_time) on conflict(history_id) do nothing;
 end if;
 return new;
end;$function$

