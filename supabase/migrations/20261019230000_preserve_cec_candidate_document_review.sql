-- Preserve individual CEC reviewer decisions and remarks when recording the
-- final candidate decision. Automated checks must not overwrite manual review.
DO $migration$
DECLARE
  source_sql text;
  old_status text := 'status=case when coalesce(d.auto_check->>''verdict'',''manual'')=''issues'' then ''revision'' else d.status end,';
  new_status text := 'status=case when d.reviewed_by IS NOT NULL then d.status when coalesce(d.auto_check->>''verdict'',''manual'')=''issues'' then ''revision'' else d.status end,';
  old_note text := 'note=case when coalesce(d.auto_check->>''verdict'',''manual'')=''issues''';
  new_note text := 'note=case when d.reviewed_by IS NOT NULL then d.note when coalesce(d.auto_check->>''verdict'',''manual'')=''issues''';
  old_reviewer text := 'reviewed_by=case when coalesce(d.auto_check->>''verdict'',''manual'')=''issues''';
  new_reviewer text := 'reviewed_by=case when d.reviewed_by IS NOT NULL then d.reviewed_by when coalesce(d.auto_check->>''verdict'',''manual'')=''issues''';
BEGIN
 source_sql := pg_get_functiondef('public.record_presidential_cec_decision(uuid,text,integer,numeric,text,text)'::regprocedure);
 IF source_sql IS NULL OR strpos(source_sql,old_status)=0 OR strpos(source_sql,old_note)=0 OR strpos(source_sql,old_reviewer)=0 THEN
  RAISE EXCEPTION 'CEC decision function changed: migration requires review';
 END IF;
 source_sql := replace(source_sql,old_status,new_status);
 source_sql := replace(source_sql,old_note,new_note);
 source_sql := replace(source_sql,old_reviewer,new_reviewer);
 EXECUTE source_sql;
END
$migration$;
