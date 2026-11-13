-- Resolved CEC complaints appear as compact official posts in Political Process.
-- Only the public subject and the finalized decision are published; never the
-- complainant, the underlying allegation or any private attachments.
CREATE OR REPLACE FUNCTION private.publish_presidential_cec_complaint(
 p_item public.presidential_cec_complaints
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $f$
BEGIN
 IF p_item.status='pending' OR p_item.resolved_at IS NULL
    OR p_item.resolved_by IS NULL OR nullif(btrim(p_item.resolution),'') IS NULL THEN
  RETURN;
 END IF;
 INSERT INTO public.political_posts(
  game_id,author_id,process_type,actor_key,actor_label,
  title,body,tags,source_key,context
 )
 SELECT p_item.game_id,p_item.resolved_by,'information','cec','Избирательная комиссия',
  left('Ответ ЦИК по жалобе на кандидата: '||c.display_name,180),
  p_item.resolution,ARRAY['ЦИК','Выборы Президента']::text[],
  'cec-complaint-response:'||p_item.id::text,
  jsonb_build_object(
   'automatic',true,'source_table','presidential_cec_complaints',
   'cec_complaint_reply',true,
   'cec_complaint_subject',p_item.subject,
   'cec_complaint_status',p_item.status,
   'cec_candidate_name',c.display_name
  )
 FROM public.presidential_candidates c
 WHERE c.id=p_item.candidate_id AND c.game_id=p_item.game_id
 ON CONFLICT (game_id,source_key) WHERE source_key IS NOT NULL DO NOTHING;
END $f$;
REVOKE ALL ON FUNCTION private.publish_presidential_cec_complaint(
 public.presidential_cec_complaints
) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.on_presidential_cec_complaint_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $f$
BEGIN
 IF OLD.status='pending' AND NEW.status<>'pending' THEN
  PERFORM private.publish_presidential_cec_complaint(NEW);
 END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION private.on_presidential_cec_complaint_resolved()
 FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS cec_complaint_political_process_post
 ON public.presidential_cec_complaints;
CREATE TRIGGER cec_complaint_political_process_post
AFTER UPDATE OF status ON public.presidential_cec_complaints
FOR EACH ROW WHEN (OLD.status='pending' AND NEW.status<>'pending')
EXECUTE FUNCTION private.on_presidential_cec_complaint_resolved();

-- Bring the already decided complaints into the feed once.
DO $backfill$
DECLARE item public.presidential_cec_complaints%ROWTYPE;
BEGIN
 FOR item IN
  SELECT * FROM public.presidential_cec_complaints
  WHERE status<>'pending' AND resolved_at IS NOT NULL
 LOOP
  PERFORM private.publish_presidential_cec_complaint(item);
 END LOOP;
END $backfill$;
