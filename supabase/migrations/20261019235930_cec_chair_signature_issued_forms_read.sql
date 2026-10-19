-- Только подпись председателя ЦИК, взятая из его профиля ГОС.ID.
-- Другие подписи и файлы game-assets остаются закрыты для посторонних.
DROP POLICY IF EXISTS cec_chair_signature_on_issued_decisions_read ON storage.objects;
CREATE POLICY cec_chair_signature_on_issued_decisions_read ON storage.objects
FOR SELECT TO authenticated
USING (
 bucket_id='game-assets'
 AND name ~ '^[0-9a-fA-F-]+/profiles/[0-9a-fA-F-]+/signature-[^/]+[.]png$'
 AND (
  EXISTS(
    SELECT 1
    FROM public.game_profiles p
    JOIN public.game_members gm ON gm.game_id=p.game_id AND gm.user_id=p.user_id
    WHERE p.signature_path=objects.name
      AND gm.kind='teacher'
      AND gm.full_name='Казанцев Дмитрий Анатольевич'
      AND private.is_game_member(p.game_id)
      AND EXISTS(
       SELECT 1 FROM public.presidential_cec_decisions d
       WHERE d.game_id=p.game_id AND d.decision_type='registered'
      )
  )
  OR EXISTS(
    SELECT 1
    FROM public.presidential_cec_decisions d
    JOIN public.game_members gm ON gm.game_id=d.game_id AND gm.user_id=d.created_by
    WHERE d.reasoning->>'chair_signature_path'=objects.name
      AND gm.kind='teacher'
      AND gm.full_name='Казанцев Дмитрий Анатольевич'
      AND private.is_game_member(d.game_id)
  )
 )
);
