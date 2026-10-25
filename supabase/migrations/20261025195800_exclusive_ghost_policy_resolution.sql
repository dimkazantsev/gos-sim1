-- При утверждении режима Goust Voting все конкурирующие проекты одного
-- вопроса отклоняются. Разные игры и разные процедуры не затрагиваются.
-- Существующие бюллетени, принятый режим и история голосований сохраняются.
CREATE OR REPLACE FUNCTION private.enforce_exclusive_ghost_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $exclusive$
BEGIN
 -- Последовательное изменение режимов одной игры при параллельных клиентах.
 PERFORM pg_advisory_xact_lock(hashtextextended('ghost-policy:'||new.game_id::text,0));
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM public.ghost_voting_policies
            WHERE game_id=new.game_id AND status='adopted') THEN
   RAISE EXCEPTION 'Режим Goust Voting уже утверждён. Новые предложения недоступны.';
  END IF;
  RETURN new;
 END IF;
 IF new.status='vote_open' AND old.status IS DISTINCT FROM new.status THEN
  IF EXISTS(SELECT 1 FROM public.ghost_voting_policies
            WHERE game_id=new.game_id AND id<>new.id AND status='adopted') THEN
   RAISE EXCEPTION 'По этому вопросу уже принято решение.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.game_votes
            WHERE game_id=new.game_id AND stage_no=5 AND
                  procedure_key='ghost_policy' AND status='open'
                  AND id IS DISTINCT FROM new.vote_id) THEN
   RAISE EXCEPTION 'По этому вопросу уже идёт другое голосование.';
  END IF;
 END IF;
 IF new.status='adopted' AND old.status IS DISTINCT FROM new.status THEN
  IF EXISTS(SELECT 1 FROM public.ghost_voting_policies
            WHERE game_id=new.game_id AND id<>new.id AND status='adopted') THEN
   RAISE EXCEPTION 'Невозможно утвердить одновременно два режима Goust Voting.';
  END IF;
  UPDATE public.ghost_voting_policies
  SET status='rejected',updated_at=now()
  WHERE game_id=new.game_id AND id<>new.id
    AND status IN ('draft','vote_open');
 END IF;
 RETURN new;
END;
$exclusive$;

DROP TRIGGER IF EXISTS guard_exclusive_ghost_policy ON public.ghost_voting_policies;
CREATE TRIGGER guard_exclusive_ghost_policy
BEFORE INSERT OR UPDATE OF status ON public.ghost_voting_policies
FOR EACH ROW EXECUTE FUNCTION private.enforce_exclusive_ghost_policy();

-- Однократное приведение ранее созданных конкурирующих черновиков.
UPDATE public.ghost_voting_policies AS candidate
SET status='rejected',updated_at=now()
WHERE status IN ('draft','vote_open') AND EXISTS(
 SELECT 1 FROM public.ghost_voting_policies AS accepted
 WHERE accepted.game_id=candidate.game_id
   AND accepted.id<>candidate.id
   AND accepted.status='adopted'
);

REVOKE ALL ON FUNCTION private.enforce_exclusive_ghost_policy()
FROM PUBLIC,anon,authenticated;
