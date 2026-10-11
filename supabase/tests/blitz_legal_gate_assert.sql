DO $qa$
DECLARE g uuid:=md5('game')::uuid; t uuid:=md5('teacher')::uuid; qid bigint; before_n int; after_n int;
BEGIN
 INSERT INTO public.game_members(game_id,user_id,kind) VALUES(g,t,'teacher');
 SELECT count(*) INTO before_n FROM public.blitz_questions WHERE verified AND legal_review_status='approved';
 IF before_n<>0 THEN RAISE EXCEPTION 'Fresh bank must start with zero legally approved questions'; END IF;
 SELECT id INTO qid FROM public.blitz_questions ORDER BY id LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',t::text,true);
 PERFORM public.blitz_set_legal_review(g,qid,'approved','isolated CI legal gate');
 SELECT count(*) INTO after_n FROM public.blitz_questions WHERE verified AND legal_review_status='approved';
 IF after_n<>1 THEN RAISE EXCEPTION 'Approval did not add exactly one question to release pool'; END IF;
 PERFORM public.blitz_set_legal_review(g,qid,'rejected','source needs correction');
 IF EXISTS(SELECT 1 FROM public.blitz_questions WHERE id=qid AND legal_review_status<>'rejected') THEN
  RAISE EXCEPTION 'Rejection status was not persisted';
 END IF;
 PERFORM public.blitz_set_legal_review(g,qid,'pending',null);
 IF EXISTS(SELECT 1 FROM public.blitz_questions WHERE id=qid AND legal_review_status<>'pending') THEN
  RAISE EXCEPTION 'Pending reset failed';
 END IF;
 RAISE NOTICE 'PASS legal release gate: pending by default, explicit approval/rejection/reset';
END $qa$;
