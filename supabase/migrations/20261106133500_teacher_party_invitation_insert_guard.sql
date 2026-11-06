-- Важное уточнение: OLD не читается при INSERT партии или приглашения.
CREATE OR REPLACE FUNCTION private.enforce_party_stage_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 -- Преподаватель вправе отменить устаревшее приглашение после этапа 1;
 -- иные изменения приглашений остаются ограничены первым этапом.
 IF tg_table_name='party_invitations' AND tg_op='UPDATE' THEN
  -- Never dereference OLD from INSERT triggers (party creation/invitation).
  IF old.status='pending' AND new.status='cancelled'
     AND (new.game_id,new.party_id,new.invited_user_id,new.invited_by)
         IS NOT DISTINCT FROM (old.game_id,old.party_id,old.invited_user_id,old.invited_by)
     AND private.is_game_teacher(new.game_id) THEN
   RETURN new;
  END IF;
 END IF;
 IF auth.uid() IS NOT NULL AND NOT private.stage_one_party_active(new.game_id) THEN
  RAISE EXCEPTION 'Первый этап ещё не открыт.' USING errcode='42501';
 END IF;
 RETURN new;
END;
$function$
;
