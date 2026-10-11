DO $qa$
DECLARE approved integer; pending integer; rejected integer;
BEGIN
 SELECT count(*) FILTER(WHERE legal_review_status='approved'),
        count(*) FILTER(WHERE legal_review_status='pending'),
        count(*) FILTER(WHERE legal_review_status='rejected')
 INTO approved,pending,rejected
 FROM public.blitz_questions;
 IF approved<>1000 OR pending<>0 OR rejected<>0 THEN
  RAISE EXCEPTION 'Expected 1000 approved legal reviews, got approved %, pending %, rejected %',approved,pending,rejected;
 END IF;
 IF EXISTS(SELECT 1 FROM public.blitz_questions WHERE NOT verified AND legal_review_status='approved') THEN
  RAISE EXCEPTION 'Technical verification gate bypassed';
 END IF;
 IF (SELECT article FROM public.blitz_questions WHERE id=842) <> 'статья 83, пункт «д.1»; статья 112, часть 2' THEN
  RAISE EXCEPTION 'Direct constitutional citation for question 842 was not corrected';
 END IF;
 RAISE NOTICE 'PASS: all 1000 questions covered by legal-review migrations; no pending/rejected rows remain in reviewed fixture';
END $qa$;
