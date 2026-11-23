-- ГОС.ID 2026-11-23. No historical replay.
-- Authority/legality breaches decrease lawfulness, not trust.
-- Original effect_plan trust_delta and legal penalty (-3 per violation, cap -9) remain intact.
-- No new triggers, tables, background reads, subscriptions or grants.
DO $patch$
DECLARE
 v_def text;
 v_old_penalty constant text := 'v_authority_delta:=case when violations>0 then -greatest(0,new.requested_trust_delta)-least(6,violations*2) else 1 end;';
 v_new_penalty constant text := 'v_authority_delta:=case when violations>0 then 0 else 1 end;';
 v_old_call constant text := 'perform private.apply_event_trust_delta(c.game_id,''authority-''||c.id,v_authority_delta,''Полномочия в событии: ''||c.title);';
 v_new_call constant text := 'if v_authority_delta<>0 then' || E'\n  ' || v_old_call || E'\n end if;';
 v_lawfulness constant text := 'legal_delta:=case when violations>0 then -least(9,violations*3) else 2 end;';
BEGIN
 v_def:=pg_get_functiondef('private.record_event_authority()'::regprocedure);
 IF position(v_new_penalty in v_def)>0 AND position('if v_authority_delta<>0 then' in v_def)>0 THEN
  RETURN;
 END IF;
 IF position(v_old_penalty in v_def)=0 OR position(v_old_call in v_def)=0
    OR position(v_lawfulness in v_def)=0 THEN
  RAISE EXCEPTION 'ГОС.ID: authority function changed; review before patch';
 END IF;
 v_def:=replace(replace(v_def,v_old_penalty,v_new_penalty),v_old_call,v_new_call);
 EXECUTE v_def;
 IF position(v_new_penalty in pg_get_functiondef('private.record_event_authority()'::regprocedure))=0 THEN
  RAISE EXCEPTION 'ГОС.ID: authority patch not installed';
 END IF;
END $patch$;
