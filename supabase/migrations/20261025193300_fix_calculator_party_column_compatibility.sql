-- The authoritative calculator migration must use the actual game_parties
-- columns. This narrow repair preserves each existing function's rights,
-- validation, security-definer context and dependency bindings.
DO $repair$
DECLARE v_definition text;v_signature regprocedure;
BEGIN
 v_signature:='public.publish_electoral_calculator_result(uuid,text,text,integer,jsonb,jsonb,jsonb)'::regprocedure;
 SELECT pg_get_functiondef(v_signature::oid) INTO v_definition;
 IF position('SET mandates=COALESCE((p_result->>p.id::text)::integer,0),updated_at=now()' IN v_definition)=0 THEN
  RAISE EXCEPTION 'Electoral function body changed: review required';
 END IF;
 EXECUTE replace(v_definition,
  'SET mandates=COALESCE((p_result->>p.id::text)::integer,0),updated_at=now()',
  'SET mandates=COALESCE((p_result->>p.id::text)::integer,0)');
 v_signature:='private.apply_published_regional_calculator(uuid,text,jsonb,uuid)'::regprocedure;
 SELECT pg_get_functiondef(v_signature::oid) INTO v_definition;
 IF position('SET regional_seats_awarded=COALESCE((p_result->>p.id::text)::integer,0),updated_at=now()' IN v_definition)=0 THEN
  RAISE EXCEPTION 'Regional function body changed: review required';
 END IF;
 EXECUTE replace(v_definition,
  'SET regional_seats_awarded=COALESCE((p_result->>p.id::text)::integer,0),updated_at=now()',
  'SET regional_seats_awarded=COALESCE((p_result->>p.id::text)::integer,0)');
END;$repair$;