-- ГОС.ID · Приглашения к ситуациям доступны только действующим студентам.
-- Не меняем прежние приглашения, полномочия и механику делегирования.
DO $patch$
DECLARE v_def text;
 v_inviter text:='and user_id=auth.uid() and kind=''student''';
 v_recipient text:='and user_id=p_recipient and kind=''student''';
BEGIN
 v_def:=pg_get_functiondef('public.invite_event_collaborator(uuid,uuid)'::regprocedure);
 IF position('roster_archived_at is null' IN v_def)>0 THEN RETURN; END IF;
 IF position(v_inviter IN v_def)=0 OR position(v_recipient IN v_def)=0
  OR position('После начала голосования приглашения закрыты' IN v_def)=0
  OR position('on conflict(case_id,recipient_id)' IN lower(v_def))=0
 THEN RAISE EXCEPTION 'Процедура приглашений изменилась: требуется проверка'; END IF;
 v_def:=replace(v_def,v_inviter,v_inviter||' and roster_archived_at is null');
 v_def:=replace(v_def,v_recipient,v_recipient||' and roster_archived_at is null');
 IF (length(v_def)-length(replace(v_def,'roster_archived_at is null','')))/length('roster_archived_at is null')<>2
 THEN RAISE EXCEPTION 'Нарушена проверка действующих участников'; END IF;
 EXECUTE v_def;
END;
$patch$;
