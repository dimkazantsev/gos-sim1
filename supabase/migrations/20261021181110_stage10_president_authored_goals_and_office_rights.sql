-- ГОС.ID · 21.10.2026. Исправление по прямому указанию владельца:
-- Президент САМОСТОЯТЕЛЬНО формулирует 5–6 целей, без готового списка.
-- Сохраняем исторические опубликованные послания, госпрограммы и документацию.

-- Полномочия Президента определяются не только первичной должностью участника,
-- но и действующим назначением в game_office_assignments. Проверка строго в своей игре.
CREATE OR REPLACE FUNCTION private.can_manage_presidential_policy(p_game uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp AS $f$
 SELECT p_user IS NOT DISTINCT FROM (SELECT auth.uid()) AND (
   private.is_game_teacher(p_game) OR
   (private.role_is_available(p_game,p_user) AND
    EXISTS(SELECT 1 FROM public.game_members m
      WHERE m.game_id=p_game AND m.user_id=p_user
        AND m.kind='student' AND m.roster_archived_at IS NULL)
    AND (
      lower(trim(private.game_role(p_game,p_user)))='президент российской федерации'
      OR EXISTS(SELECT 1 FROM public.game_office_assignments o
        WHERE o.game_id=p_game AND o.user_id=p_user AND o.status='active'
          AND lower(trim(o.role_title))='президент российской федерации')
    ))
 );
$f$;
REVOKE ALL ON FUNCTION private.can_manage_presidential_policy(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Одновременно и атомарно сохраняем ФИО-связанные произвольные формулировки.
CREATE OR REPLACE FUNCTION public.set_presidential_address_goals(p_address_id uuid,p_goals text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $f$
DECLARE a public.presidential_addresses%ROWTYPE;v_uid uuid:=auth.uid();
 v_goal text;v_index integer:=0;v_n integer:=coalesce(array_length(p_goals,1),0);
BEGIN
 SELECT * INTO a FROM public.presidential_addresses WHERE id=p_address_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Послание Президента не найдено'; END IF;
 IF v_uid IS NULL OR NOT private.can_manage_presidential_policy(a.game_id,v_uid)
 THEN RAISE EXCEPTION 'Только действующий Президент или преподаватель вправе утверждать цели' USING ERRCODE='42501';END IF;
 IF a.status<>'draft' THEN RAISE EXCEPTION 'Опубликованное послание и его цели нельзя изменять';END IF;
 IF v_n NOT BETWEEN 5 AND 6 THEN
   RAISE EXCEPTION 'Президент должен сформулировать от пяти до шести целей';END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_goals) g
   WHERE g IS NULL OR length(btrim(g)) NOT BETWEEN 12 AND 500)
 THEN RAISE EXCEPTION 'Каждая цель должна содержать от 12 до 500 символов';END IF;
 IF (SELECT count(DISTINCT lower(btrim(g))) FROM unnest(p_goals) g)<>v_n
 THEN RAISE EXCEPTION 'Не допускаются повторяющиеся цели';END IF;
 -- Ранее созданные особые приоритеты не удаляем без согласования.
 IF EXISTS(SELECT 1 FROM public.presidential_priorities p
   WHERE p.address_id=a.id AND
     (p.national_goal IS NULL OR p.title IS DISTINCT FROM p.national_goal OR p.description IS NOT NULL))
 THEN RAISE EXCEPTION 'Послание содержит отдельные приоритеты, которые нельзя автоматически заменить';END IF;
 DELETE FROM public.presidential_priorities WHERE address_id=a.id;
 FOREACH v_goal IN ARRAY p_goals LOOP
   v_index:=v_index+1;
   INSERT INTO public.presidential_priorities(address_id,game_id,priority_no,title,national_goal)
   VALUES(a.id,a.game_id,v_index,btrim(v_goal),btrim(v_goal));
 END LOOP;
 UPDATE public.presidential_addresses SET updated_at=now() WHERE id=a.id;
END $f$;
REVOKE ALL ON FUNCTION public.set_presidential_address_goals(uuid,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_presidential_address_goals(uuid,text[]) TO authenticated;

-- При публикации послания действуют уже внедрённые проверки 5–6 уникальных
-- приоритетов и синхронизация с Реестром НПА; не трогаем их и чужие документы.
