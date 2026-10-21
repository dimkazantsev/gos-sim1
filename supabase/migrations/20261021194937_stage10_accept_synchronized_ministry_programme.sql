-- Stage 10: treat only a synchronised programme created in Work as the required Registry document.
-- The generated formal document belongs to a ministry; the Government coordinates its approval.
-- Never count an unrelated draft or an unsigned/unready programme.
DO $fix$
DECLARE def text; needle text; insert_case text;
BEGIN
 def:=pg_get_functiondef('private.stage_required_final_documents(uuid,integer)'::regprocedure);
 needle:='WHEN x.template_key=''financial_economic''';
 insert_case:='WHEN x.template_key=''state_program'' THEN d.doc_type=''state_program'' AND d.metadata->>''auto_synced''=''true'' AND EXISTS (SELECT 1 FROM public.state_programs p WHERE p.game_id=d.game_id AND p.id::text=d.metadata->>''state_program_id'' AND p.status IN (''ready'',''government_vote'',''adopted'') AND p.signed_at IS NOT NULL) ';
 IF position(needle in def)=0 OR position('WHEN x.template_key=''state_program'' THEN' in def)>0
 THEN RAISE EXCEPTION 'Unexpected Stage 10 requirement implementation; refusing automatic rewrite'; END IF;
 def:=replace(def,needle,insert_case||needle);
 EXECUTE def;
END $fix$;