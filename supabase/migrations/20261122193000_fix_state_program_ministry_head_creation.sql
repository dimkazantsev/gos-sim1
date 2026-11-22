-- ГОС.ID: разрешить создание ГП фактически назначенным руководителям министерств.
-- Не расширяем права рядовых сотрудников, гостей и участников других игр.
-- Сохраняем все существующие проверки и тело функции без переписывания.
DO $patch$
DECLARE
  v_def text;
  v_old text := 'and not private.has_effective_role_like(p_game_id,v_uid,ARRAY[''%министр%'',''%правительств%''])';
  v_new text := $code$and not (
       -- gos_id_ministry_head_program_creation_v1
       private.has_effective_role_like(p_game_id,v_uid,ARRAY['%министр%','%правительств%'])
       or exists (
         select 1
         from public.institution_units u
         join public.game_members gm
           on gm.game_id=u.game_id and gm.user_id=u.head_user_id
         where u.game_id=p_game_id
           and u.unit_kind='ministry'
           and u.head_user_id=v_uid
           and gm.kind='student'
           and gm.roster_archived_at is null
       )
     )$code$;
BEGIN
  v_def := pg_get_functiondef('public.save_state_program(uuid,uuid,text,text,uuid,uuid,text,date,date,numeric,text)'::regprocedure);
  IF position('gos_id_ministry_head_program_creation_v1' in v_def)>0 THEN RETURN; END IF;
  IF position(v_old in v_def)=0 THEN
    RAISE EXCEPTION 'Неожиданное изменение проверки полномочий при создании государственной программы';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END
$patch$;
