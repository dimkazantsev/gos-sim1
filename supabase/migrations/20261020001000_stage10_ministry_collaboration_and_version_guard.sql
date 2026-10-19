-- ГОС.ID. Командная подготовка государственных программ в Этапе 10.
-- Участник редактирует только черновик программы своего назначенного министерства.
-- Подпись министра, решение Председателя Правительства и уже утверждённые тексты не расширяются.
CREATE OR REPLACE FUNCTION private.can_edit_state_program(p_program uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
 SELECT p_user=(select auth.uid())
   AND (private.is_platform_admin() OR EXISTS(
     SELECT 1 FROM public.game_members gm
     WHERE gm.game_id=p.game_id AND gm.user_id=p_user
       AND gm.kind IN ('teacher','student') AND gm.roster_archived_at IS NULL
   ))
   AND NOT private.is_game_observer(p.game_id)
   AND (private.is_game_teacher(p.game_id) OR private.role_is_available(p.game_id,p_user))
   AND p.status IN ('draft','revision','minister_review')
   AND p.signed_at IS NULL
   AND (
     private.is_game_teacher(p.game_id)
     OR p.created_by=p_user
     OR p.responsible_minister_id=p_user
     OR (
       p.status IN ('draft','revision')
       AND EXISTS(
         SELECT 1 FROM public.institution_units u
         JOIN public.institution_assignments ia ON ia.unit_id=u.id
           AND ia.game_id=u.game_id AND ia.unit_kind='ministry'
         WHERE u.game_id=p.game_id
           AND u.unit_kind='ministry'
           AND u.head_user_id=p.responsible_minister_id
           AND ia.user_id=p_user
       )
     )
   )
 FROM public.state_programs p WHERE p.id=p_program;
$fn$;

-- Defensive concurrency guard: редактор пересылает версию, полученную при открытии.
-- Сохранение прежних клиентов без expected_updated_at продолжает работать.
DO $guard$
DECLARE v_definition text;v_old text:='if p_program_id is not null then';v_new text;
BEGIN
 v_definition:=pg_get_functiondef('public.save_state_program_draft(uuid,uuid,jsonb,boolean)'::regprocedure);
 IF position('expected_updated_at' in v_definition)>0 THEN RETURN; END IF;
 IF position(v_old in v_definition)=0 THEN
   RAISE EXCEPTION 'Невозможно безопасно обновить проверку версии государственной программы';
 END IF;
 v_new:=E'if p_program_id is not null then\n  if p_payload ? ''expected_updated_at'' and p.updated_at is distinct from nullif(p_payload->>''expected_updated_at'','''')::timestamptz then\n   raise exception ''Программа изменена другим участником. Обновите страницу и повторите правки в актуальной версии.'' using errcode=''40001'';\n  end if;';
 -- Важно: после FOR UPDATE p содержит текущую версию, поэтому вставляем после SELECT.
 -- Замена ниже выполняется лишь при сохранённом каноническом фрагменте.
 IF position('if p.id is null or not private.can_edit_state_program' in v_definition)=0 THEN
   RAISE EXCEPTION 'Изменилась структура проверки прав в save_state_program_draft';
 END IF;
 v_definition:=replace(v_definition,
   'if p.id is null or not private.can_edit_state_program(p.id,uid) then raise exception ''Нет доступа к этой программе'';end if;',
   'if p.id is null or not private.can_edit_state_program(p.id,uid) then raise exception ''Нет доступа к этой программе'';end if;'
   ||E'\n'||
   'if p_payload ? ''expected_updated_at'' and p.updated_at is distinct from nullif(p_payload->>''expected_updated_at'','''')::timestamptz then raise exception ''Программа изменена другим участником. Обновите страницу и повторите правки в актуальной версии.'' using errcode=''40001'';end if;');
 IF position('expected_updated_at' in v_definition)=0 THEN
   RAISE EXCEPTION 'Не удалось установить проверку актуальности редактируемой версии';
 END IF;
 EXECUTE v_definition;
END
$guard$;
