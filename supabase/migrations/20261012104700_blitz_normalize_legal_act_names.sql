-- Canonicalize display names so the teacher NPA filter has one entry per act.
-- Only legal_act labels change; questions, options, answer keys, article citations and review status stay untouched.
UPDATE public.blitz_questions
SET legal_act=CASE
 WHEN legal_act LIKE '%145-ФЗ%' THEN 'Бюджетный кодекс Российской Федерации, № 145-ФЗ'
 WHEN legal_act LIKE '%146-ФЗ%' OR legal_act='Налоговый кодекс Российской Федерации (часть первая)' THEN 'Налоговый кодекс Российской Федерации (часть первая), № 146-ФЗ'
 WHEN legal_act LIKE '%59-ФЗ%' THEN 'Федеральный закон от 02.05.2006 № 59-ФЗ «О порядке рассмотрения обращений граждан Российской Федерации»'
 WHEN legal_act LIKE '%№ 3-ФЗ%' THEN 'Федеральный закон от 08.05.1994 № 3-ФЗ «О статусе сенатора РФ и статусе депутата Государственной Думы»'
 WHEN legal_act LIKE '%95-ФЗ%' THEN 'Федеральный закон от 11.07.2001 № 95-ФЗ'
 WHEN legal_act LIKE '%33-ФЗ%' THEN 'Федеральный закон от 20.03.2025 № 33-ФЗ «Об общих принципах организации местного самоуправления в единой системе публичной власти»'
 WHEN legal_act LIKE '%414-ФЗ%' THEN 'Федеральный закон от 21.12.2021 № 414-ФЗ'
 WHEN legal_act LIKE '%20-ФЗ%' THEN 'Федеральный закон от 22.02.2014 № 20-ФЗ «О выборах депутатов Государственной Думы»'
 WHEN legal_act LIKE '%135-ФЗ%' THEN 'Федеральный закон от 26.07.2006 № 135-ФЗ «О защите конкуренции»'
 WHEN legal_act LIKE '%210-ФЗ%' THEN 'Федеральный закон от 27.07.2010 № 210-ФЗ «Об организации предоставления государственных и муниципальных услуг»'
 WHEN legal_act LIKE '%172-ФЗ%' THEN 'Федеральный закон от 28.06.2014 № 172-ФЗ «О стратегическом планировании в Российской Федерации»'
 WHEN legal_act LIKE '%4-ФКЗ%' THEN 'ФКЗ от 06.11.2020 № 4-ФКЗ «О Правительстве Российской Федерации»'
 ELSE legal_act END;

DO $verify$
DECLARE n integer;
BEGIN
 SELECT count(DISTINCT legal_act) INTO n FROM public.blitz_questions;
 IF n<>23 THEN RAISE EXCEPTION 'Expected 23 canonical NPA labels after normalization, got %',n; END IF;
 IF (SELECT count(*) FROM public.blitz_questions)<>1000 THEN RAISE EXCEPTION 'Question bank cardinality changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.blitz_questions WHERE legal_review_status<>'approved' OR verified IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'Normalization must not change release eligibility';
 END IF;
END $verify$;
