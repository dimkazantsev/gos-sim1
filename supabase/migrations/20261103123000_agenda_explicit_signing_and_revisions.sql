-- ГОС.ID: an agenda remains a draft until every required official signs its current text.
-- Do not use profile facsimiles as proof of consent; preserve all existing documents and audit histories.

CREATE OR REPLACE FUNCTION private.agenda_normalized_body(p_body text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT regexp_replace(
   replace(replace(replace(replace(replace(replace(coalesce(p_body,''),
    'Статус заседания: Подготовка','Статус заседания: [состояние]'),
    'Статус заседания: Открыто','Статус заседания: [состояние]'),
    'Статус заседания: Завершено','Статус заседания: [состояние]'),
    'Статус: Проект','Статус: [состояние]'),
    'Статус: Утверждена','Статус: [состояние]'),
    'Статус: Заседание завершено','Статус: [состояние]'),
    'Текущая стадия НПА: [^[:cntrl:]]*','Текущая стадия НПА: [состояние]','g')
$fn$;

CREATE OR REPLACE FUNCTION private.agenda_required_signers(p_document uuid)
RETURNS TABLE(user_id uuid,office text) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path='' AS $fn$
DECLARE d public.formal_documents%rowtype; v_body text; v_chair uuid;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document;
 IF d.id IS NULL OR d.doc_type<>'meeting_agenda' THEN RETURN; END IF;
 v_body:=coalesce(nullif(d.metadata->>'institution_key',''),d.subject_key);
 IF v_body='ksrf' THEN
  RETURN QUERY SELECT DISTINCT p.leader_user_id,
   ('Председатель фракции «'||p.name||'» (КСРФ)')::text
   FROM public.game_parties p JOIN public.game_members gm
    ON gm.game_id=p.game_id AND gm.user_id=p.leader_user_id
   WHERE p.game_id=d.game_id AND p.registration_status='registered'
    AND gm.kind='student' AND gm.roster_archived_at IS NULL
    AND private.role_is_available(d.game_id,p.leader_user_id);
  RETURN;
 END IF;
 IF v_body='gd' THEN
  v_chair:=private.gd_presiding_officer(d.game_id,d.stage_no);
  IF v_chair IS NOT NULL AND private.role_is_available(d.game_id,v_chair) THEN
   RETURN QUERY SELECT v_chair,'Председательствующий на заседании Государственной Думы'::text;
   RETURN;
  END IF;
  -- At the constitutive sitting the registered party chairs act before Duma leadership exists.
  IF d.stage_no=4 THEN
   RETURN QUERY SELECT DISTINCT p.leader_user_id,
    ('Председатель фракции «'||p.name||'» (ГД, этап 4)')::text
   FROM public.game_parties p JOIN public.game_members gm
    ON gm.game_id=p.game_id AND gm.user_id=p.leader_user_id
   WHERE p.game_id=d.game_id AND p.registration_status='registered'
    AND gm.kind='student' AND gm.roster_archived_at IS NULL
    AND private.role_is_available(d.game_id,p.leader_user_id);
  END IF;
  RETURN;
 END IF;
 IF v_body='government' THEN
  SELECT s.chair_user_id INTO v_chair FROM public.government_sessions s
   WHERE s.game_id=d.game_id AND s.agenda_document_id=d.id
    ORDER BY s.created_at DESC LIMIT 1;
  IF v_chair IS NULL THEN
   SELECT a.user_id INTO v_chair FROM public.game_office_assignments a
    WHERE a.game_id=d.game_id AND a.status='active'
     AND lower(btrim(a.role_title)) LIKE 'председатель правительств%'
    ORDER BY a.created_at DESC LIMIT 1;
  END IF;
  IF v_chair IS NOT NULL AND private.role_is_available(d.game_id,v_chair) THEN
   RETURN QUERY SELECT v_chair,'Председатель Правительства Российской Федерации'::text;
  END IF;
  RETURN;
 END IF;
 IF v_body LIKE 'unit:%' THEN
  SELECT u.head_user_id INTO v_chair FROM public.institution_units u
   WHERE u.game_id=d.game_id AND 'unit:'||u.id::text=v_body LIMIT 1;
 END IF;
 IF v_chair IS NULL THEN
  SELECT a.user_id INTO v_chair FROM public.game_office_assignments a
  WHERE a.game_id=d.game_id AND a.status='active'
   AND private.role_matches_voting_body(a.role_title,v_body)
   AND a.role_title ~* '(председател|руководител|глава|директор)'
   AND private.can_coordinate_stage_meeting(d.game_id,d.stage_no,v_body,a.user_id)
  ORDER BY CASE WHEN lower(a.role_title) LIKE 'заместител%' THEN 1 ELSE 0 END,
           a.created_at DESC LIMIT 1;
 END IF;
 IF v_chair IS NOT NULL AND private.role_is_available(d.game_id,v_chair) THEN
  RETURN QUERY SELECT v_chair,('Председательствующий: '||v_body)::text;
 END IF;
END
$fn$;
REVOKE ALL ON FUNCTION private.agenda_required_signers(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.agenda_all_signed(p_document uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT count(*)>0 AND bool_and(EXISTS(
  SELECT 1 FROM public.formal_document_signatures sig
  WHERE sig.document_id=d.id AND sig.game_id=d.game_id
   AND sig.signer_id=s.user_id
   AND sig.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)
 )) FROM public.formal_documents d
 CROSS JOIN LATERAL private.agenda_required_signers(d.id) s
 WHERE d.id=p_document AND d.doc_type='meeting_agenda'
$fn$;
REVOKE ALL ON FUNCTION private.agenda_all_signed(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.agenda_document_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_changed boolean:=false;
BEGIN
 IF NEW.doc_type<>'meeting_agenda' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  v_changed:=private.agenda_normalized_body(NEW.body_text)
               IS DISTINCT FROM private.agenda_normalized_body(OLD.body_text)
   OR NEW.title IS DISTINCT FROM OLD.title
   OR nullif(NEW.metadata->>'revision_changed_at','') IS DISTINCT FROM nullif(OLD.metadata->>'revision_changed_at','');
  IF v_changed AND nullif(NEW.metadata->>'revision_changed_at','')
                        IS NOT DISTINCT FROM nullif(OLD.metadata->>'revision_changed_at','') THEN
   NEW.metadata:=coalesce(NEW.metadata,'{}'::jsonb)||
      jsonb_build_object('revision_changed_at',clock_timestamp());
  END IF;
 END IF;
 IF v_changed OR NEW.status_code IN ('published','adopted','signed')
                   AND NOT private.agenda_all_signed(NEW.id) THEN
  NEW.status_code:='draft';
  NEW.status_label:='Ожидает личных подписей';
  NEW.current_owner_key:=coalesce(nullif(NEW.subject_key,''),'author');
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.agenda_document_revision_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_agenda_document_revision_guard ON public.formal_documents;
CREATE TRIGGER trg_agenda_document_revision_guard BEFORE INSERT OR UPDATE
ON public.formal_documents FOR EACH ROW WHEN (NEW.doc_type='meeting_agenda') EXECUTE FUNCTION private.agenda_document_revision_guard();

CREATE OR REPLACE FUNCTION private.agenda_revision_unapprove() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.doc_type='meeting_agenda'
  AND (private.agenda_normalized_body(NEW.body_text) IS DISTINCT FROM private.agenda_normalized_body(OLD.body_text)
  OR NEW.title IS DISTINCT FROM OLD.title
  OR NEW.metadata->>'revision_changed_at' IS DISTINCT FROM OLD.metadata->>'revision_changed_at') THEN
  UPDATE public.institution_meeting_records
    SET agenda_approved_at=NULL,agenda_approved_by=NULL,updated_at=now()
    WHERE agenda_document_id=NEW.id;
  UPDATE public.government_sessions SET agenda_approved_at=NULL
    WHERE agenda_document_id=NEW.id AND status='draft' AND agenda_approved_at IS NOT NULL;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.agenda_revision_unapprove() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_agenda_revision_unapprove ON public.formal_documents;
CREATE TRIGGER trg_agenda_revision_unapprove AFTER UPDATE OF body_text,metadata,title
ON public.formal_documents FOR EACH ROW WHEN (NEW.doc_type='meeting_agenda') EXECUTE FUNCTION private.agenda_revision_unapprove();

CREATE OR REPLACE FUNCTION private.meeting_record_approval_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.agenda_document_id IS NOT NULL
  AND NEW.agenda_approved_at IS NOT NULL
  AND NOT private.agenda_all_signed(NEW.agenda_document_id) THEN
  NEW.agenda_approved_at:=NULL;
  NEW.agenda_approved_by:=NULL;
 END IF;
 IF TG_OP='UPDATE' AND NEW.agenda_document_id IS DISTINCT FROM OLD.agenda_document_id THEN
  NEW.agenda_approved_at:=NULL;
  NEW.agenda_approved_by:=NULL;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.meeting_record_approval_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_meeting_record_approval_guard ON public.institution_meeting_records;
CREATE TRIGGER trg_meeting_record_approval_guard BEFORE INSERT OR UPDATE
ON public.institution_meeting_records FOR EACH ROW EXECUTE FUNCTION private.meeting_record_approval_guard();

CREATE OR REPLACE FUNCTION public.sign_institution_meeting_agenda(p_document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE d public.formal_documents%rowtype; uid uuid:=auth.uid(); v_office text;
 v_sig text; v_signed boolean; v_institution text;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF d.id IS NULL OR uid IS NULL OR NOT private.is_game_member(d.game_id)
 THEN RAISE EXCEPTION 'Документ недоступен' USING ERRCODE='42501'; END IF;
 IF d.doc_type<>'meeting_agenda' OR d.status_code IN('rejected','superseded','withdrawn')
 THEN RAISE EXCEPTION 'Документ не является действующей повесткой' USING ERRCODE='23514'; END IF;
 IF NOT private.role_is_available(d.game_id,uid)
 THEN RAISE EXCEPTION 'Нет действующих полномочий для подписания' USING ERRCODE='42501'; END IF;
 SELECT s.office INTO v_office FROM private.agenda_required_signers(d.id) s
  WHERE s.user_id=uid LIMIT 1;
 IF v_office IS NULL THEN
  RAISE EXCEPTION 'Подписывать эту повестку вправе другое уполномоченное лицо' USING ERRCODE='42501';
 END IF;
 v_institution:=coalesce(nullif(d.metadata->>'institution_key',''),d.subject_key);
 IF NOT (v_institution='ksrf' AND d.stage_no IN (2,3))
  AND NOT EXISTS (SELECT 1 FROM public.game_stages s WHERE s.game_id=d.game_id
    AND s.stage_no=d.stage_no AND s.status='open') THEN
  RAISE EXCEPTION 'Этап завершён или ещё не открыт' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.duma_sessions s WHERE s.agenda_document_id=d.id AND s.status='closed')
 OR EXISTS(SELECT 1 FROM public.government_sessions s WHERE s.agenda_document_id=d.id AND s.status='closed') THEN
  RAISE EXCEPTION 'Нельзя подписать повестку завершённого заседания' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.formal_document_signatures sig WHERE sig.document_id=d.id
  AND sig.signer_id=uid
  AND sig.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)) THEN
  RAISE EXCEPTION 'Вы уже подписали текущую редакцию повестки' USING ERRCODE='23505';
 END IF;
 SELECT p.signature_path INTO v_sig FROM public.game_profiles p WHERE p.game_id=d.game_id AND p.user_id=uid;
 IF nullif(v_sig,'') IS NULL OR v_sig NOT LIKE d.game_id::text||'/profiles/'||uid::text||'/signature-%'
 THEN RAISE EXCEPTION 'Сначала сохраните личную подпись в своём профиле' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='game-assets' AND o.name=v_sig)
 THEN RAISE EXCEPTION 'Файл личной подписи отсутствует в хранилище' USING ERRCODE='23514'; END IF;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,
   from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,d.game_id,uid,'Подписан документ уполномоченным лицом',
   d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,v_office);
 v_signed:=private.agenda_all_signed(d.id);
 IF v_signed THEN
  PERFORM set_config('app.gos_meeting_document_scope',
    d.game_id::text||':'||d.stage_no||':'||v_institution||':agenda',true);
  UPDATE public.formal_documents SET status_code='published',
   status_label='Повестка подписана всеми уполномоченными лицами',
   current_owner_key='system',updated_at=now() WHERE id=d.id;
  UPDATE public.institution_meeting_records SET agenda_approved_by=uid,
    agenda_approved_at=now(),updated_at=now() WHERE agenda_document_id=d.id;
  UPDATE public.government_sessions SET agenda_approved_at=coalesce(agenda_approved_at,now())
   WHERE agenda_document_id=d.id AND status='draft';
 ELSE
  UPDATE public.institution_meeting_records SET updated_at=now() WHERE agenda_document_id=d.id;
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.sign_institution_meeting_agenda(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sign_institution_meeting_agenda(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_and_optionally_sign_agenda(
 p_game_id uuid,p_stage_no integer,p_institution text,p_body text,
 p_sign boolean DEFAULT false,p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_current public.institution_meeting_records%rowtype; v_doc uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_member(p_game_id)
 THEN RAISE EXCEPTION 'Нет доступа к игре' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_current FROM public.institution_meeting_records
  WHERE game_id=p_game_id AND stage_no=p_stage_no AND institution_key=p_institution FOR UPDATE;
 IF v_current.game_id IS NOT NULL AND v_current.updated_at IS DISTINCT FROM p_expected_updated_at
 THEN RAISE EXCEPTION 'Повестка изменена другим участником. Обновите её перед сохранением' USING ERRCODE='40001'; END IF;
 IF v_current.game_id IS NULL AND p_expected_updated_at IS NOT NULL
 THEN RAISE EXCEPTION 'Повестка обновлена. Повторите действие' USING ERRCODE='40001'; END IF;
 SELECT public.save_institution_meeting_document(p_game_id,p_stage_no,p_institution,'agenda',p_body,NULL)
 INTO v_doc;
 IF p_sign THEN PERFORM public.sign_institution_meeting_agenda(v_doc); END IF;
 RETURN v_doc;
END $fn$;
REVOKE ALL ON FUNCTION public.save_and_optionally_sign_agenda(uuid,integer,text,text,boolean,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_and_optionally_sign_agenda(uuid,integer,text,text,boolean,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_institution_document_signers(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE d public.formal_documents%rowtype; uid uuid:=auth.uid(); needed jsonb; can_sign boolean;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id;
 IF d.id IS NULL OR uid IS NULL OR NOT private.is_game_member(d.game_id)
 THEN RAISE EXCEPTION 'Документ недоступен' USING ERRCODE='42501'; END IF;
 IF d.doc_type='meeting_agenda' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'user_id',s.user_id,'office',s.office,
    'facsimile_path',NULL,
    'signed',EXISTS(SELECT 1 FROM public.formal_document_signatures f
      WHERE f.document_id=d.id AND f.signer_id=s.user_id
       AND f.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz))
   ) ORDER BY s.office,s.user_id),'[]'::jsonb)
   INTO needed FROM private.agenda_required_signers(d.id) s;
  SELECT EXISTS(SELECT 1 FROM private.agenda_required_signers(d.id) s
    WHERE s.user_id=uid AND private.role_is_available(d.game_id,uid)
      AND NOT EXISTS(SELECT 1 FROM public.formal_document_signatures f
       WHERE f.document_id=d.id AND f.signer_id=uid
        AND f.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)))
   INTO can_sign;
  RETURN jsonb_build_object('required',needed,'can_sign',can_sign,'approved',private.agenda_all_signed(d.id));
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'user_id',s.user_id,'office',s.office,
  'facsimile_path',(SELECT f.signature_path FROM public.formal_meeting_facsimiles f
    WHERE f.document_id=d.id AND f.signer_id=s.user_id),
  'signed',EXISTS(SELECT 1 FROM public.formal_document_signatures x
    WHERE x.document_id=d.id AND x.signer_id=s.user_id
     AND x.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz))
 ) ORDER BY s.office,s.user_id),'[]'::jsonb) INTO needed
 FROM (
  SELECT r.user_id,r.office FROM private.institution_document_signers(d.id) r
    WHERE d.doc_type<>'minutes'
  UNION
  SELECT r.user_id,r.office FROM private.meeting_facsimile_signers(d.id) r
    WHERE d.doc_type='minutes'
 ) s;
 SELECT EXISTS(SELECT 1 FROM private.institution_document_signers(d.id) s
   WHERE s.user_id=uid AND NOT EXISTS(SELECT 1 FROM public.formal_document_signatures x
   WHERE x.document_id=d.id AND x.signer_id=uid
    AND x.signed_at>=coalesce(nullif(d.metadata->>'revision_changed_at','')::timestamptz,'-infinity'::timestamptz)))
 INTO can_sign;
 RETURN jsonb_build_object('required',needed,'can_sign',can_sign);
END $fn$;
REVOKE ALL ON FUNCTION public.get_institution_document_signers(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_institution_document_signers(uuid) TO authenticated;

-- Old approve links an automatic Duma/Government agenda if necessary,
-- but no longer substitutes a coordinator click for consent of all signers.
CREATE OR REPLACE FUNCTION public.approve_institution_meeting_agenda(
 p_game_id uuid,p_stage_no integer,p_institution text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_doc uuid;v_body text;v_author uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_member(p_game_id)
 THEN RAISE EXCEPTION 'Нет доступа к игре' USING ERRCODE='42501'; END IF;
 SELECT agenda_document_id INTO v_doc FROM public.institution_meeting_records
  WHERE game_id=p_game_id AND stage_no=p_stage_no AND institution_key=p_institution;
 IF v_doc IS NULL THEN
  IF p_institution='gd' AND p_stage_no=12 THEN
   SELECT d.id,d.body_text,s.created_by INTO v_doc,v_body,v_author
    FROM public.duma_sessions s JOIN public.formal_documents d ON d.id=s.agenda_document_id
    WHERE s.game_id=p_game_id AND s.stage_no=12
    ORDER BY s.session_no DESC LIMIT 1;
  ELSIF p_institution='government' AND p_stage_no=11 THEN
   SELECT d.id,d.body_text,s.created_by INTO v_doc,v_body,v_author
    FROM public.government_sessions s JOIN public.formal_documents d ON d.id=s.agenda_document_id
    WHERE s.game_id=p_game_id AND s.stage_no=11
    ORDER BY s.session_no DESC LIMIT 1;
  END IF;
  IF v_doc IS NOT NULL THEN
   INSERT INTO public.institution_meeting_records(game_id,stage_no,institution_key,
     agenda_document_id,agenda_body,agenda_prepared_by)
   VALUES(p_game_id,p_stage_no,p_institution,v_doc,v_body,v_author)
   ON CONFLICT(game_id,stage_no,institution_key) DO UPDATE SET
     agenda_document_id=excluded.agenda_document_id,
     agenda_body=excluded.agenda_body,
     agenda_prepared_by=excluded.agenda_prepared_by,updated_at=now();
  END IF;
 END IF;
 IF v_doc IS NULL THEN
  RAISE EXCEPTION 'Сначала подготовьте повестку заседания' USING ERRCODE='23514';
 END IF;
 PERFORM public.sign_institution_meeting_agenda(v_doc);
END $fn$;
REVOKE ALL ON FUNCTION public.approve_institution_meeting_agenda(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_institution_meeting_agenda(uuid,integer,text) TO authenticated;

-- Preserve all minutes behavior. Saving an agenda never gives the preparer an automatic signature.

CREATE OR REPLACE FUNCTION public.save_institution_meeting_document(p_game_id uuid, p_stage_no integer, p_institution text, p_kind text, p_body text, p_delegate_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare uid uuid:=auth.uid();m public.institution_meeting_records%rowtype;
 v_manager boolean;v_doc uuid;v_subject text;v_steps jsonb;v_title text;v_reg text;
 v_org text;v_org_gen text;
begin
 if uid is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 if p_stage_no not between 1 and 16 or not exists(
   select 1 from public.game_stages where game_id=p_game_id and stage_no=p_stage_no
 ) then raise exception 'Этап не найден';end if;
 if p_kind not in ('agenda','minutes') then raise exception 'Неизвестный вид документа';end if;
 if p_kind='agenda' and p_institution='gd' and p_stage_no=12 then
  raise exception 'Повестка ГД Этапа 12 формируется автоматически из пакетов законопроектов. Утвердите её в разделе регистрации, корректировки заседания выполняйте отдельно.' using errcode='23514';
 end if;
 if length(btrim(coalesce(p_body,'')))<30 then raise exception 'Заполните содержание документа (не менее 30 символов)';end if;
 if p_institution not in ('ksrf','gd','government','municipality','sf','committee','region','cec','ks','vs','central_bank','accounts')
 and not exists(select 1 from public.institution_units where game_id=p_game_id and 'unit:'||id::text=p_institution)
 then raise exception 'Орган не найден';end if;
 v_manager:=private.can_coordinate_stage_meeting(p_game_id,p_stage_no,p_institution,uid);
 insert into public.institution_meeting_records(game_id,stage_no,institution_key)
 values(p_game_id,p_stage_no,p_institution) on conflict do nothing;
 select * into m from public.institution_meeting_records
 where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution for update;
 if not v_manager and m.delegate_user_id is distinct from uid then
  raise exception 'Повестку и протокол готовит председатель или назначенный им участник';end if;
 if not v_manager and p_delegate_user_id is not null then
  raise exception 'Поручить подготовку вправе председатель';end if;
 if p_delegate_user_id is not null and not private.vote_member_has_office(p_game_id,p_delegate_user_id,p_institution) then
  raise exception 'Исполнитель должен иметь действующее назначение в этом органе';end if;
 -- The guard will accept meeting documents even before stage work opens.
 -- Authorization above remains mandatory; other documents cannot use this scope.
 perform set_config('app.gos_meeting_document_scope',
   p_game_id::text||':'||p_stage_no||':'||p_institution||':'||p_kind,true);
 -- Institution names are official document requisites. Stage number remains
 -- in metadata for routing but must never appear in the public title.
 v_org:=case p_institution
  when 'ksrf' then 'КСРФ'
  when 'gd' then 'Государственная Дума Федерального Собрания Российской Федерации'
  when 'government' then 'Правительство Российской Федерации'
  when 'sf' then 'Совет Федерации Федерального Собрания Российской Федерации'
  when 'municipality' then 'Орган местного самоуправления'
  when 'region' then 'Законодательный орган субъекта Российской Федерации'
  when 'committee' then 'Комитет Государственной Думы'
  when 'cec' then 'Центральная избирательная комиссия Российской Федерации'
  when 'ks' then 'Конституционный Суд Российской Федерации'
  when 'vs' then 'Верховный Суд Российской Федерации'
  when 'central_bank' then 'Совет директоров Банка России'
  when 'accounts' then 'Коллегия Счётной палаты Российской Федерации'
  else (select u.title from public.institution_units u
    where u.game_id=p_game_id and 'unit:'||u.id::text=p_institution limit 1)
 end;
 if v_org is null then raise exception 'Официальное наименование органа не найдено';end if;
 v_org_gen:=case p_institution
  when 'ksrf' then 'КСРФ'
  when 'gd' then 'Государственной Думы Федерального Собрания Российской Федерации'
  when 'government' then 'Правительства Российской Федерации'
  when 'sf' then 'Совета Федерации Федерального Собрания Российской Федерации'
  when 'municipality' then 'органа местного самоуправления'
  when 'region' then 'законодательного органа субъекта Российской Федерации'
  when 'committee' then 'комитета Государственной Думы'
  when 'cec' then 'Центральной избирательной комиссии Российской Федерации'
  when 'ks' then 'Конституционного Суда Российской Федерации'
  when 'vs' then 'Верховного Суда Российской Федерации'
  when 'central_bank' then 'Совета директоров Банка России'
  when 'accounts' then 'Коллегии Счётной палаты Российской Федерации'
  else null
 end;
 if p_kind='agenda' then
  -- Historic registrations created before agenda enforcement must not
  -- permanently block the FIRST agenda document. Once an agenda exists,
  -- preserve the existing freeze on edits after the first registration.
  if m.agenda_document_id is not null and exists(
    select 1 from public.institution_session_registrations
    where game_id=p_game_id and stage_no=p_stage_no
      and institution_key=p_institution
  ) then
   raise exception 'После начала регистрации повестку менять нельзя';end if;
  v_doc:=m.agenda_document_id;
  v_title:=case when v_org_gen is null then 'Повестка заседания «'||v_org||'»' else 'Повестка заседания '||v_org_gen end;
 else
  if not exists(select 1 from public.institution_session_registrations where game_id=p_game_id
    and stage_no=p_stage_no and institution_key=p_institution) then
   raise exception 'Протокол оформляется после регистрации участников заседания';end if;
  if exists(select 1 from public.game_votes where game_id=p_game_id and stage_no=p_stage_no
    and institution_key=p_institution and status='open') then
   raise exception 'Сначала завершите все голосования заседания';end if;
  v_doc:=m.minutes_document_id;
  v_title:=case when v_org_gen is null then 'Протокол заседания «'||v_org||'»' else 'Протокол заседания '||v_org_gen end;
 end if;
 v_subject:=case when p_institution='government' then 'government'
                 when p_institution like 'unit:%' then 'gd' else p_institution end;
 if v_doc is null then
  v_doc:=gen_random_uuid();
  v_reg:='ГОС.ID-ЗАС-'||lpad(nextval('public.formal_registry_seq')::text,6,'0');
  v_steps:=private.formal_workflow(case when p_institution='government' then 'government_act' else 'gd_resolution' end);
  insert into public.formal_documents(id,game_id,stage_no,registry_no,title,doc_type,
   subject_key,subject_label,author_id,body_text,workflow_key,workflow_steps,
   current_step,status_code,status_label,current_owner_key,metadata)
  values(v_doc,p_game_id,p_stage_no,v_reg,v_title,
    case when p_kind='agenda' then 'meeting_agenda' else 'minutes' end,
    v_subject,v_org,uid,btrim(p_body),
    case when p_institution='government' then 'government_act' else 'gd_resolution' end,
    v_steps,0,'draft',
    case when p_kind='agenda' then 'Проект повестки' else 'Протокол подготовлен' end,
    v_subject,jsonb_build_object('document_kind','institution_meeting_'||p_kind,
      'institution_key',p_institution,'stage_no',p_stage_no));
 else
  update public.formal_documents set body_text=btrim(p_body),updated_at=now()
  where id=v_doc and game_id=p_game_id;
 end if;
 if p_kind='agenda' then
  update public.institution_meeting_records set agenda_document_id=v_doc,
   agenda_body=btrim(p_body),agenda_prepared_by=uid,
   agenda_approved_by=case when m.agenda_body is distinct from btrim(p_body) then null else m.agenda_approved_by end,
   agenda_approved_at=case when m.agenda_body is distinct from btrim(p_body) then null else m.agenda_approved_at end,
   delegate_user_id=coalesce(p_delegate_user_id,delegate_user_id),updated_at=now()
   where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution;
  -- Agenda publication is reserved for individually verified signatures.
 else
  update public.institution_meeting_records set minutes_document_id=v_doc,
   minutes_body=btrim(p_body),minutes_prepared_by=uid,minutes_saved_at=now(),
   minutes_approved_by=case when v_manager then uid else null end,
   minutes_approved_at=case when v_manager then now() else null end,updated_at=now() where game_id=p_game_id and stage_no=p_stage_no and institution_key=p_institution;
  update public.formal_documents set status_code=case when v_manager then 'published' else 'draft' end,
   status_label=case when v_manager then 'Протокол утверждён' else 'Проект протокола' end,
   current_owner_key=case when v_manager then 'system' else v_subject end,updated_at=now() where id=v_doc;
 end if;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 values(v_doc,p_game_id,uid,case when p_kind='agenda' then 'Подготовлена повестка заседания' else 'Составлен протокол заседания' end,
  case when p_kind='agenda' or not v_manager then 'draft' else 'published' end,
  case when p_kind='agenda' then v_subject when v_manager then 'system' else v_subject end,'Этап '||p_stage_no||', орган '||p_institution);
 return v_doc;
end;$function$;

CREATE OR REPLACE FUNCTION private.attach_published_meeting_facsimiles(p_document uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
 -- Agenda signature images appear only after an explicit authenticated action.
 IF EXISTS(SELECT 1 FROM public.formal_documents WHERE id=p_document AND doc_type='meeting_agenda') THEN RETURN; END IF;
 INSERT INTO public.formal_meeting_facsimiles(document_id,game_id,signer_id,office,signature_path)
 SELECT d.id,d.game_id,s.user_id,s.office,p.signature_path
 FROM public.formal_documents d
 JOIN LATERAL private.meeting_facsimile_signers(d.id) s ON true
 JOIN public.game_profiles p ON p.game_id=d.game_id AND p.user_id=s.user_id
 JOIN public.game_members gm ON gm.game_id=p.game_id AND gm.user_id=p.user_id
 WHERE d.id=p_document AND d.doc_type IN('meeting_agenda','minutes')
  AND d.status_code IN('published','adopted','signed')
  AND gm.roster_archived_at IS NULL AND nullif(p.signature_path,'') IS NOT NULL
  AND p.signature_path LIKE d.game_id::text||'/profiles/'||s.user_id::text||'/signature-%.png'
 ON CONFLICT(document_id,signer_id) DO NOTHING;
END $function$;

-- Prevent an automatic session from opening with an unsigned agenda.
CREATE OR REPLACE FUNCTION private.agenda_session_open_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.status='open' AND OLD.status IS DISTINCT FROM 'open' AND
   ((TG_TABLE_NAME='duma_sessions' AND NEW.stage_no=12) OR
    (TG_TABLE_NAME='government_sessions' AND NEW.stage_no=11)) THEN
  IF NEW.agenda_document_id IS NULL OR NOT private.agenda_all_signed(NEW.agenda_document_id) THEN
   RAISE EXCEPTION 'Сначала соберите личные подписи всех уполномоченных лиц под повесткой'
    USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.agenda_session_open_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_government_session_agenda_signatures ON public.government_sessions;
CREATE TRIGGER trg_government_session_agenda_signatures BEFORE UPDATE OF status
ON public.government_sessions FOR EACH ROW EXECUTE FUNCTION private.agenda_session_open_guard();
DROP TRIGGER IF EXISTS trg_duma_session_agenda_signatures ON public.duma_sessions;
CREATE TRIGGER trg_duma_session_agenda_signatures BEFORE UPDATE OF status
ON public.duma_sessions FOR EACH ROW EXECUTE FUNCTION private.agenda_session_open_guard();

-- One existing KSRF agenda was marked approved based only on profile facsimiles.
-- Recalculate legacy markers without removing documents, history or saved signature images.
UPDATE public.institution_meeting_records m SET agenda_approved_at=NULL,
 agenda_approved_by=NULL,updated_at=now()
WHERE m.agenda_document_id IS NOT NULL AND m.agenda_approved_at IS NOT NULL
 AND NOT private.agenda_all_signed(m.agenda_document_id);
UPDATE public.formal_documents d SET status_code='draft',
 status_label='Ожидает личных подписей',current_owner_key=d.subject_key,updated_at=now()
WHERE d.doc_type='meeting_agenda' AND d.status_code IN('published','signed','adopted')
 AND NOT private.agenda_all_signed(d.id);
