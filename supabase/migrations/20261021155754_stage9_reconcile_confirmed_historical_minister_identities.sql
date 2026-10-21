-- One-time, owner-approved reconciliation of three Stage 9 historic nominees.
-- No change to votes, decrees, resolutions, scores, signatures, dates or original document text.
-- Identifies the unique game by the three exact orphaned historical nominations, not a generated UUID.
DO $reconcile$
DECLARE
  v_game uuid;
  v_games integer;
  v_target record;
  v_nom public.government_nominations%ROWTYPE;
  v_unit public.institution_units%ROWTYPE;
  v_member_id uuid;
  v_members integer;
  v_document public.formal_documents%ROWTYPE;
  v_document_id uuid;
  v_old_name text;
  v_note text;
BEGIN
  SELECT count(*), min(game_id::text)::uuid INTO v_games, v_game
  FROM (
    SELECT game_id
    FROM public.government_nominations
    WHERE stage_no=9 AND status='appointed'
      AND candidate_user_id IS NULL
      AND ((office_key='ministry_foreign' AND candidate_name='Иванов Иван Ивановича')
        OR (office_key='ministry_defence' AND candidate_name='Иванов Иван Ивановичв')
        OR (office_key='ministry_internal' AND candidate_name='Иванов Иван Ивановича'))
    GROUP BY game_id HAVING count(*)=3
  ) AS exact_game;
  IF v_games<>1 THEN
    RAISE EXCEPTION 'Expected exactly one game with three unlinked historic Stage 9 nominees, found %', v_games;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('historical-minister-identities:'||v_game::text,0));

  -- Lock and validate every affected record BEFORE the first write. All writes are transactional.
  FOR v_target IN
    SELECT * FROM (VALUES
     ('ministry_foreign','Иванов Иван Ивановича','Иванов Иван Иванович'),
     ('ministry_defence','Иванов Иван Ивановичв','Тестов Тест Тестович'),
     ('ministry_internal','Иванов Иван Ивановича','Иванов Иван Иванович')
    ) AS mapping(office_key,old_name,new_name)
  LOOP
    SELECT * INTO STRICT v_nom FROM public.government_nominations
    WHERE game_id=v_game AND stage_no=9 AND status='appointed'
      AND office_key=v_target.office_key AND candidate_user_id IS NULL
      AND candidate_name=v_target.old_name
    FOR UPDATE;

    SELECT count(*), min(user_id::text)::uuid INTO v_members,v_member_id
    FROM public.game_members
    WHERE game_id=v_game AND kind='student' AND roster_archived_at IS NULL
      AND full_name=v_target.new_name;
    IF v_members<>1 OR v_member_id IS NULL THEN
      RAISE EXCEPTION 'Expected one active registered student % in the game; found %',v_target.new_name,v_members;
    END IF;

    SELECT * INTO STRICT v_unit FROM public.institution_units
    WHERE game_id=v_game AND unit_kind='ministry'
      AND unit_key=substring(v_target.office_key from 10) FOR UPDATE;
    IF v_unit.head_user_id IS NOT NULL AND v_unit.head_user_id<>v_member_id THEN
      RAISE EXCEPTION 'Ministry % already has a different recorded head',v_target.office_key;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.institution_assignments a
      WHERE a.unit_id=v_unit.id AND a.assignment_role='head' AND a.user_id<>v_member_id
    ) THEN RAISE EXCEPTION 'Ministry % has a conflicting head assignment',v_target.office_key; END IF;

    IF v_nom.appointment_document_id IS NULL THEN
      RAISE EXCEPTION 'Historic appointment decree missing for %',v_target.office_key;
    END IF;
    -- All linked published documents are immutable as to title, text, signature, vote and chronology.
    FOR v_document_id IN
      SELECT unnest(array_remove(ARRAY[v_nom.formal_document_id,v_nom.appointment_document_id],NULL::uuid))
    LOOP
      SELECT * INTO STRICT v_document FROM public.formal_documents
      WHERE id=v_document_id AND game_id=v_game AND status_code='published'
        AND metadata->>'nomination_id'=v_nom.id::text
      FOR UPDATE;
    END LOOP;
  END LOOP;

  FOR v_target IN
    SELECT * FROM (VALUES
     ('ministry_foreign','Иванов Иван Ивановича','Иванов Иван Иванович'),
     ('ministry_defence','Иванов Иван Ивановичв','Тестов Тест Тестович'),
     ('ministry_internal','Иванов Иван Ивановича','Иванов Иван Иванович')
    ) AS mapping(office_key,old_name,new_name)
  LOOP
    SELECT * INTO STRICT v_nom FROM public.government_nominations
      WHERE game_id=v_game AND stage_no=9 AND status='appointed'
        AND office_key=v_target.office_key AND candidate_user_id IS NULL FOR UPDATE;
    SELECT user_id INTO STRICT v_member_id FROM public.game_members
      WHERE game_id=v_game AND kind='student' AND roster_archived_at IS NULL
        AND full_name=v_target.new_name;

    v_old_name:=v_nom.candidate_name;
    v_note:='Уточнение по подтверждённому решению владельца от 21.10.2026: '||
       v_old_name||' → '||v_target.new_name||
       '. Исходные подписанные документы, голоса, оценки и даты оставлены неизменными.';
    UPDATE public.government_nominations SET
      candidate_user_id=v_member_id,
      candidate_name=v_target.new_name,
      note=concat_ws(E'\n',NULLIF(note,''),v_note),
      updated_at=now()
    WHERE id=v_nom.id AND candidate_user_id IS NULL AND candidate_name=v_old_name;
    IF NOT FOUND THEN RAISE EXCEPTION 'Concurrent nominee change: %',v_target.office_key; END IF;

    UPDATE public.institution_units SET head_user_id=v_member_id
    WHERE game_id=v_game AND unit_kind='ministry'
      AND unit_key=substring(v_target.office_key from 10)
      AND (head_user_id IS NULL OR head_user_id=v_member_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Concurrent ministry head change: %',v_target.office_key; END IF;

    INSERT INTO public.institution_assignments(
      game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by
    )
    SELECT v_game,u.id,'ministry',v_member_id,NULL,'head',v_nom.nominated_by
    FROM public.institution_units u
    WHERE u.game_id=v_game AND u.unit_kind='ministry'
      AND u.unit_key=substring(v_target.office_key from 10)
    ON CONFLICT (unit_id,user_id) DO UPDATE
      SET assignment_role='head';

    FOR v_document_id IN
      SELECT unnest(array_remove(ARRAY[v_nom.formal_document_id,v_nom.appointment_document_id],NULL::uuid))
    LOOP
      -- Add a non-signed clarification, preserving the original published title,
      -- body_text, candidate_name metadata, signatures, registry number and status.
      UPDATE public.formal_documents d SET
        metadata=jsonb_set(COALESCE(d.metadata,'{}'::jsonb),
          '{identity_clarification}',
          jsonb_build_object(
            'previous_name',v_old_name,
            'confirmed_name',v_target.new_name,
            'confirmed_user_id',v_member_id,
            'confirmed_on','2026-10-21',
            'authority','Подтверждено владельцем игры',
            'original_document_preserved',true
          ),true)
      WHERE d.id=v_document_id AND d.game_id=v_game;
      INSERT INTO public.formal_document_history(
        document_id,game_id,actor_id,action,from_status,to_status,note
      ) VALUES(
        v_document_id,v_game,NULL,'identity_clarification',
        'published','published',v_note
      );
    END LOOP;

    INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,entity_id,payload)
    VALUES(v_game,NULL,'owner_confirmed_historic_minister_identity',
      'government_nominations',v_nom.id,jsonb_build_object(
       'office_key',v_target.office_key,
       'previous_candidate_name',v_old_name,
       'previous_candidate_user_id',v_nom.candidate_user_id,
       'confirmed_candidate_name',v_target.new_name,
       'confirmed_user_id',v_member_id,
       'appointment_document_id',v_nom.appointment_document_id,
       'nomination_document_id',v_nom.formal_document_id,
       'original_signed_documents_preserved',true,
       'votes_and_scores_unchanged',true,
       'confirmed_on','2026-10-21'
      ));
  END LOOP;
END $reconcile$;
