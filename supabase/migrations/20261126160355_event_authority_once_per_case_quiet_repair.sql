-- One legal effect per resolved case, regardless of participants.
-- Preserve individual evidence, scoring, winning choices, trust and other effects.
DO $patch$
DECLARE v_def text;
 v_old constant text:='legal_delta:=case when violations>0 then -least(9,violations*3) else 2 end;';
 v_new constant text:='legal_delta:=case when violations>0 then -3 else 2 end;';
 v_skip constant text:='if tg_table_name=''state_metric_history'' then if new.source_type=''repair:event_authority_once'' then return new;end if;end if;';
BEGIN
 v_def:=pg_get_functiondef('private.record_event_authority()'::regprocedure);
 IF strpos(v_def,v_new)=0 THEN
  IF strpos(v_def,v_old)=0 THEN RAISE EXCEPTION 'Authority formula changed; review required';END IF;
  EXECUTE replace(v_def,v_old,v_new);
 END IF;
 -- Keep the audit entry, but do not publish an automatic game-news item for this correction.
 v_def:=pg_get_functiondef('private.publish_rating_change()'::regprocedure);
 IF strpos(v_def,v_skip)=0 THEN
  IF strpos(v_def,'if coalesce(new.delta,0)=0 then return new;end if;')=0 THEN RAISE EXCEPTION 'Rating publisher changed; review required';END IF;
  EXECUTE replace(v_def,'if coalesce(new.delta,0)=0 then return new;end if;', 'if coalesce(new.delta,0)=0 then return new;end if;'||E'\n '||v_skip);
 END IF;
 IF strpos(pg_get_functiondef('private.record_event_authority()'::regprocedure),v_new)=0 THEN RAISE EXCEPTION 'Case cap not installed';END IF;
END $patch$;

-- Production-only, idempotent restitution. Restore only the actual excess deductions.
-- Keep original history, personal scores, case outcomes and non-lawfulness penalties.
DO $repair$
DECLARE
 gid constant uuid:='068dac89-00ea-447a-96bf-0cb11d85014a';
 repair_key constant text:='collective-lawfulness-20261126-v1';
 v_ids constant bigint[]:=ARRAY[3394,3503,3975,5675,5683,5701,5770]::bigint[];
 m public.state_metrics%rowtype;
 v_count integer;v_restore numeric;v_new numeric;v_news bigint;v_note text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.games WHERE id=gid AND status='running') THEN RETURN;END IF;
 SELECT * INTO STRICT m FROM public.state_metrics WHERE game_id=gid AND metric_key='lawfulness' FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.state_metric_history WHERE game_id=gid AND metric_key='lawfulness' AND source_type='repair:event_authority_once' AND source_id=repair_key) THEN RETURN;END IF;
 SELECT count(*),sum(greatest(coalesce(m.min_value,0),h.previous_value-3)-h.previous_value-h.delta),
 string_agg(c.title||': +'||(greatest(coalesce(m.min_value,0),h.previous_value-3)-h.previous_value-h.delta)::text, '; ' ORDER BY h.id)
 INTO v_count,v_restore,v_note
 FROM public.state_metric_history h
 JOIN public.event_cases c ON c.id::text=h.source_id AND c.game_id=h.game_id
 JOIN public.event_case_outcomes o ON o.case_id=c.id
 WHERE h.id=ANY(v_ids) AND h.game_id=gid AND h.metric_id=m.id AND h.metric_key='lawfulness'
 AND h.source_type='event_authority' AND h.delta < -3 AND o.winner<>'tie'
 AND (SELECT count(*) FROM public.event_decisions d WHERE d.case_id=c.id)>1;
 IF v_count<>7 OR v_restore IS DISTINCT FROM 38.4 THEN RAISE EXCEPTION 'Unexpected correction evidence: % cases, % points',v_count,v_restore;END IF;
 v_new:=least(coalesce(m.max_value,100),m.value+v_restore);
 IF m.value<30 AND v_new>=30 AND EXISTS(
 SELECT 1 FROM public.formal_documents d WHERE d.game_id=gid AND d.status_code IN ('sf_veto','sf_fkz_blocked')
 AND NOT coalesce(d.metadata->>'budget_sf_rejected_by_teacher'='true',false)
 AND d.doc_type IN ('fz_bill','fkz_bill','federal_budget') AND d.workflow_key IN ('bill','budget')
 AND d.workflow_steps->(d.current_step+1)->>'code'='president')
 THEN RAISE EXCEPTION 'Correction would change document status; review required';END IF;
 SELECT count(*) INTO v_news FROM public.political_posts WHERE game_id=gid AND source_key LIKE 'rating-batch:'||txid_current()||':%';
 UPDATE public.state_metrics SET previous_value=m.value,value=v_new,updated_at=clock_timestamp() WHERE id=m.id;
 INSERT INTO public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note)
 VALUES(gid,m.id,'lawfulness',v_new,m.value,v_new-m.value,'repair:event_authority_once',repair_key,NULL,'Исправление повторных списаний по 7 коллективным кейсам (обычный штраф −3 сохранён): '||v_note);
 IF (SELECT count(*) FROM public.political_posts WHERE game_id=gid AND source_key LIKE 'rating-batch:'||txid_current()||':%')<>v_news THEN RAISE EXCEPTION 'Unexpected game announcement';END IF;
END $repair$;
