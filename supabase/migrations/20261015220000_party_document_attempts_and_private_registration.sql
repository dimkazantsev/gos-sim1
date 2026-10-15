-- ГОС.ID · immutable party document attempts, private until certificate issued.
-- Existing files/rows are preserved. Revisions are numbered per party and kind.
ALTER TABLE public.party_documents ADD COLUMN IF NOT EXISTS version_number integer;
WITH numbered AS (
  SELECT id,row_number() over(partition by party_id,doc_kind order by created_at,id)::integer AS version_number
  FROM public.party_documents
)
UPDATE public.party_documents d SET version_number=n.version_number
FROM numbered n WHERE d.id=n.id AND d.version_number IS NULL;
ALTER TABLE public.party_documents ALTER COLUMN version_number SET NOT NULL;
ALTER TABLE public.party_documents ADD CONSTRAINT party_documents_positive_version CHECK(version_number>0);
CREATE UNIQUE INDEX IF NOT EXISTS party_documents_kind_version_unique
 ON public.party_documents(party_id,doc_kind,version_number);

CREATE OR REPLACE FUNCTION private.assign_party_document_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_party public.game_parties%ROWTYPE;
BEGIN
 SELECT * INTO v_party FROM public.game_parties WHERE id=new.party_id FOR UPDATE;
 IF v_party.id IS NULL OR v_party.game_id<>new.game_id THEN
  RAISE EXCEPTION 'Party/game mismatch' USING errcode='42501';
 END IF;
 IF v_party.registration_status='registered' THEN
  RAISE EXCEPTION 'Партия уже зарегистрирована. Регистрационный пакет закрыт.' USING errcode='42501';
 END IF;
 IF new.storage_path NOT LIKE (new.game_id::text||'/parties/'||new.party_id::text||'/docs/%') THEN
  RAISE EXCEPTION 'Недопустимое расположение документа партии' USING errcode='42501';
 END IF;
 -- Never trust student-supplied status, version or review note.
 new.version_number:=coalesce((SELECT max(d.version_number) FROM public.party_documents d
  WHERE d.party_id=new.party_id AND d.doc_kind=new.doc_kind),0)+1;
 new.status:='submitted';
 new.note:=NULL;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION private.assign_party_document_version() FROM public,anon,authenticated;
DROP TRIGGER IF EXISTS assign_party_document_version ON public.party_documents;
CREATE TRIGGER assign_party_document_version BEFORE INSERT ON public.party_documents
 FOR EACH ROW EXECUTE FUNCTION private.assign_party_document_version();

CREATE OR REPLACE FUNCTION private.guard_party_document_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF old.party_id<>new.party_id OR old.game_id<>new.game_id OR old.doc_kind<>new.doc_kind
 OR old.version_number<>new.version_number OR old.storage_path<>new.storage_path
 OR old.uploaded_by<>new.uploaded_by THEN
  RAISE EXCEPTION 'История попыток и содержимое документа неизменяемы' USING errcode='42501';
 END IF;
 IF new.status IS DISTINCT FROM old.status OR new.note IS DISTINCT FROM old.note THEN
  IF NOT private.is_game_teacher(old.game_id) THEN
   RAISE EXCEPTION 'Решение доступно только преподавателю' USING errcode='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.party_documents d WHERE d.party_id=old.party_id
    AND d.doc_kind=old.doc_kind AND d.version_number>old.version_number) THEN
   RAISE EXCEPTION 'Нельзя изменять рассмотрение предыдущей версии' USING errcode='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.game_parties p WHERE p.id=old.party_id
    AND p.registration_status='registered') THEN
   RAISE EXCEPTION 'Регистрационное решение уже принято' USING errcode='23514';
  END IF;
  IF new.status='revision' AND length(btrim(coalesce(new.note,'')))<5 THEN
   RAISE EXCEPTION 'Для доработки укажите причину (не менее 5 символов)' USING errcode='23514';
  END IF;
 END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION private.guard_party_document_review() FROM public,anon,authenticated;
DROP TRIGGER IF EXISTS guard_party_document_review ON public.party_documents;
CREATE TRIGGER guard_party_document_review BEFORE UPDATE ON public.party_documents
 FOR EACH ROW EXECUTE FUNCTION private.guard_party_document_review();

-- Internal access predicate, shared by table RLS and Storage RLS. Never use
-- the game's broad membership alone to expose a party's pending documents.
CREATE OR REPLACE FUNCTION private.may_read_party_attempt(p_party uuid,p_kind text,p_version integer,p_status text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(
 SELECT 1 FROM public.game_parties p WHERE p.id=p_party
 AND private.is_game_member(p.game_id)
 AND (
    private.is_game_teacher(p.game_id)
    OR EXISTS(SELECT 1 FROM public.game_members m
      WHERE m.game_id=p.game_id AND m.user_id=(SELECT auth.uid())
       AND m.kind='student' AND m.team=p.name AND m.roster_archived_at IS NULL)
    OR (p.registration_status='registered' AND p_status='accepted'
      AND p_version=(SELECT max(d.version_number) FROM public.party_documents d
                     WHERE d.party_id=p.id AND d.doc_kind=p_kind))
 )
 )
$$;
REVOKE ALL ON FUNCTION private.may_read_party_attempt(uuid,text,integer,text) FROM public,anon,authenticated;

DROP POLICY IF EXISTS party_documents_read ON public.party_documents;
CREATE POLICY party_documents_read ON public.party_documents FOR SELECT TO authenticated
 USING(private.may_read_party_attempt(party_id,doc_kind,version_number,status));

-- Restrictive Storage policy closes the permissive game_assets_read/other
-- policies for unregistered party documents; does not affect logos or other media.
DROP POLICY IF EXISTS game_assets_party_documents_private ON storage.objects;
CREATE POLICY game_assets_party_documents_private ON storage.objects
 AS RESTRICTIVE FOR SELECT TO authenticated USING (
 bucket_id<>'game-assets'
 OR name NOT LIKE '%/parties/%/docs/%'
 OR private.is_game_teacher((split_part(name,'/',1))::uuid)
 OR EXISTS(
  SELECT 1 FROM public.party_documents d
  WHERE d.storage_path=name AND private.may_read_party_attempt(d.party_id,d.doc_kind,d.version_number,d.status)
 )
);

-- No registrations on stale accepted attempts. Every most-recent required
-- document must be approved; existing attempts remain permanently in history.
CREATE OR REPLACE FUNCTION public.review_party_registration(p_party_id uuid,p_status text,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp' AS $$
DECLARE p public.game_parties%ROWTYPE;v_uid uuid:=auth.uid();v_missing text;
BEGIN
 SELECT * INTO p FROM public.game_parties WHERE id=p_party_id FOR UPDATE;
 IF p.id IS NULL OR NOT private.is_game_teacher(p.game_id) THEN RAISE EXCEPTION 'Требуются права преподавателя' USING errcode='42501';END IF;
 IF p.registration_status='registered' THEN RAISE EXCEPTION 'Партия уже зарегистрирована';END IF;
 IF p_status NOT IN ('registered','revision','rejected') THEN RAISE EXCEPTION 'Недопустимое решение';END IF;
 IF p_status='registered' THEN
  SELECT string_agg(x.kind,', ') INTO v_missing
  FROM (VALUES('application'),('charter'),('program'),('fee'),('symbol'),('congress_minutes')) x(kind)
  WHERE NOT EXISTS (
   SELECT 1 FROM public.party_documents d WHERE d.party_id=p.id AND d.doc_kind=x.kind
   AND d.status='accepted' AND d.version_number=(
    SELECT max(last.version_number) FROM public.party_documents last
    WHERE last.party_id=d.party_id AND last.doc_kind=d.doc_kind)
  );
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'Примите актуальные версии всех документов: %',v_missing;END IF;
 END IF;
 UPDATE public.game_parties SET registration_status=p_status,
   registration_note=CASE WHEN p_status='registered' THEN NULLIF(btrim(coalesce(p_note,'')),'')
    WHEN p_status='revision' THEN 'Регистрационный пакет возвращён на доработку. Подробности направлены партии.'
    ELSE 'В регистрации отказано. Подробности направлены партии.' END,
   registration_reviewed_at=now(),registration_reviewed_by=v_uid
 WHERE id=p.id;
 -- Public event only after the certificate can be issued.
 IF p_status='registered' THEN
  INSERT INTO public.game_events(game_id,round_no,category,severity,title,body,created_by)
  VALUES(p.game_id,1,'Регистрация партии','notice','Партия зарегистрирована',p.name,v_uid);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.review_party_registration(uuid,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.review_party_registration(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_party_registration(p_party_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp' AS $$
DECLARE p public.game_parties%ROWTYPE;v_uid uuid:=auth.uid();v_missing text;
BEGIN
 SELECT * INTO p FROM public.game_parties WHERE id=p_party_id FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Партия не найдена';END IF;
 IF p.registration_status='registered' THEN RAISE EXCEPTION 'Партия уже зарегистрирована';END IF;
 IF NOT private.is_game_teacher(p.game_id) AND p.leader_user_id IS DISTINCT FROM v_uid THEN
  RAISE EXCEPTION 'Требуются права председателя партии' USING errcode='42501';END IF;
 SELECT string_agg(x.kind,', ') INTO v_missing
 FROM (VALUES('application'),('charter'),('program'),('fee'),('symbol'),('congress_minutes')) x(kind)
 WHERE NOT EXISTS (
  SELECT 1 FROM public.party_documents d WHERE d.party_id=p.id AND d.doc_kind=x.kind
   AND d.status IN ('submitted','accepted') AND d.version_number=(
    SELECT max(last.version_number) FROM public.party_documents last
    WHERE last.party_id=d.party_id AND last.doc_kind=d.doc_kind)
 );
 IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'Загрузите или исправьте актуальные версии документов: %',v_missing;END IF;
 UPDATE public.game_parties SET registration_status='submitted',registration_note=NULL,registration_submitted_at=now()
 WHERE id=p.id;
END $$;
REVOKE ALL ON FUNCTION public.submit_party_registration(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.submit_party_registration(uuid) TO authenticated;

-- Keep the existing officially signed response/certificate workflow for
-- registration only. Returning packages for revision never publish signed
-- documents or political process posts before certification.
ALTER FUNCTION public.issue_party_justice_response(uuid,text,text) SET SCHEMA private;
ALTER FUNCTION private.issue_party_justice_response(uuid,text,text) RENAME TO original_issue_party_justice_response;
REVOKE ALL ON FUNCTION private.original_issue_party_justice_response(uuid,text,text) FROM public,anon,authenticated;
CREATE FUNCTION public.issue_party_justice_response(p_party_id uuid,p_status text,p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','private','pg_temp' AS $$
DECLARE p public.game_parties%ROWTYPE;v_id uuid;
BEGIN
 SELECT * INTO p FROM public.game_parties WHERE id=p_party_id FOR UPDATE;
 IF p.id IS NULL OR NOT private.is_game_teacher(p.game_id) THEN RAISE EXCEPTION 'Требуются права преподавателя' USING errcode='42501';END IF;
 IF length(btrim(coalesce(p_note,'')))<10 THEN RAISE EXCEPTION 'Подготовьте мотивированный ответ Минюста';END IF;
 IF p_status='registered' THEN
  RETURN private.original_issue_party_justice_response(p_party_id,p_status,p_note);
 END IF;
 IF p_status NOT IN ('revision','rejected') THEN RAISE EXCEPTION 'Недопустимое решение Минюста';END IF;
 PERFORM public.review_party_registration(p_party_id,p_status,p_note);
 -- Confidential text is only placed in the restricted faction channel, not in
 -- game events, public political posts, or the publicly readable party row.
 INSERT INTO public.chat_messages(game_id,channel_id,author_id,kind,text)
 SELECT p.game_id,c.id,auth.uid(),'system',
   'Минюст: '||(CASE WHEN p_status='revision' THEN 'доработка пакета' ELSE 'отказ в регистрации' END)||
   ' партии «'||p.name||'». '||left(p_note,6000)
 FROM public.chat_channels c WHERE c.game_id=p.game_id AND c.name='Фракция · '||p.name;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.issue_party_justice_response(uuid,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.issue_party_justice_response(uuid,text,text) TO authenticated;
