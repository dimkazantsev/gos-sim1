-- Party indicators editable by the game teacher without changing election rules.
-- Nullable rating is a separate public indicator; presidential_rating_modifier remains untouched.
ALTER TABLE public.game_parties ADD COLUMN IF NOT EXISTS rating numeric;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.game_parties'::regclass
      AND conname='game_parties_rating_range_check'
  ) THEN
    ALTER TABLE public.game_parties
      ADD CONSTRAINT game_parties_rating_range_check
      CHECK (rating IS NULL OR (rating >= 0 AND rating <= 100));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.teacher_update_party_statistics(
  p_party_id uuid,
  p_rating numeric,
  p_support numeric,
  p_mandates integer,
  p_expected_rating numeric,
  p_expected_support numeric,
  p_expected_mandates integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  party public.game_parties%ROWTYPE;
  party_game_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE='42501';
  END IF;
  SELECT game_id INTO party_game_id FROM public.game_parties WHERE id=p_party_id;
  IF party_game_id IS NULL OR NOT private.is_game_teacher(party_game_id) THEN
    RAISE EXCEPTION 'Требуются права преподавателя' USING ERRCODE='42501';
  END IF;
  IF p_support IS NULL OR p_support < 0 OR p_support > 100
      OR (p_rating IS NOT NULL AND (p_rating < 0 OR p_rating > 100))
      OR p_mandates IS NULL OR p_mandates < 0 OR p_mandates > 450 THEN
    RAISE EXCEPTION 'Неверные показатели: рейтинг и поддержка от 0 до 100, мандаты от 0 до 450';
  END IF;

  -- Serialize teacher edits for the same game, then re-read the party.
  PERFORM 1 FROM public.games WHERE id=party_game_id FOR UPDATE;
  SELECT * INTO party FROM public.game_parties WHERE id=p_party_id FOR UPDATE;
  IF party.id IS NULL OR party.game_id IS DISTINCT FROM party_game_id THEN
    RAISE EXCEPTION 'Партия не найдена';
  END IF;
  IF party.rating IS DISTINCT FROM p_expected_rating
     OR party.support IS DISTINCT FROM p_expected_support
     OR party.mandates IS DISTINCT FROM p_expected_mandates THEN
    RAISE EXCEPTION 'Показатели партии уже изменились. Обновите карточку и повторите попытку.';
  END IF;

  IF party.mandates IS DISTINCT FROM p_mandates THEN
    -- Existing RPC enforces the 450-seat ceiling and freezes open Duma votes.
    PERFORM public.set_party_mandates(p_party_id,p_mandates);
  END IF;
  IF party.rating IS NOT DISTINCT FROM p_rating
     AND party.support IS NOT DISTINCT FROM p_support
     AND party.mandates IS NOT DISTINCT FROM p_mandates THEN
    RETURN;
  END IF;

  UPDATE public.game_parties
     SET rating=p_rating, support=p_support
   WHERE id=p_party_id;

  IF party.support IS DISTINCT FROM p_support THEN
    INSERT INTO public.party_support_history
      (game_id,party_id,value,previous_value,delta,source_type,source_id)
    VALUES
      (party.game_id,party.id,p_support,party.support,p_support-party.support,
       'teacher_manual',auth.uid()::text);
  END IF;

  INSERT INTO public.game_activity(game_id,actor_id,event_type,label,view_key,payload)
  VALUES(
    party.game_id,auth.uid(),'party_statistics_adjusted',
    'Преподаватель изменил показатели партии «'||party.name||'»',
    'teacher',
    jsonb_build_object('party_id',party.id,
      'before',jsonb_build_object('rating',party.rating,'support',party.support,'mandates',party.mandates),
      'after',jsonb_build_object('rating',p_rating,'support',p_support,'mandates',p_mandates))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.teacher_update_party_statistics(
  uuid,numeric,numeric,integer,numeric,numeric,integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.teacher_update_party_statistics(
  uuid,numeric,numeric,integer,numeric,numeric,integer
) TO authenticated;
