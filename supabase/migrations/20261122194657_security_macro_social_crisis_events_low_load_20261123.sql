
-- Approved ГОС.ID security model; independent of state programmes.
CREATE OR REPLACE FUNCTION private.apply_security_delta(
  p_game uuid,p_delta numeric,p_kind text,p_source text,p_actor uuid,p_note text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
DECLARE a text;prev numeric:=0;raw numeric;d numeric;
 mid uuid;oldval numeric;newval numeric;
BEGIN
 IF p_game IS NULL OR coalesce(p_delta,0)=0 THEN RETURN 0; END IF;
 a:=p_game::text||':'||coalesce(p_kind,'')||':'||coalesce(p_source,'');
 IF nullif(p_source,'') IS NOT NULL AND current_setting('gos.security_action',true)=a THEN
   prev:=coalesce(nullif(current_setting('gos.security_raw',true),'')::numeric,0);
 END IF;
 raw:=prev+p_delta;
 d:=greatest(-4,least(4,raw))-greatest(-4,least(4,prev));
 PERFORM set_config('gos.security_action',a,true);
 PERFORM set_config('gos.security_raw',raw::text,true);
 IF d=0 THEN RETURN 0;END IF;
 UPDATE public.state_metrics m SET previous_value=m.value,
  value=greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),m.value+d)),
  updated_at=clock_timestamp()
 WHERE m.game_id=p_game AND m.metric_key='security'
 AND greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),m.value+d)) IS DISTINCT FROM m.value
 RETURNING m.id,m.previous_value,m.value INTO mid,oldval,newval;
 IF NOT FOUND THEN RETURN 0;END IF;
 INSERT INTO public.state_metric_history
 (game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note)
 VALUES (p_game,mid,'security',newval,oldval,newval-oldval,
 'derived:security',left(coalesce(p_kind,'')||':'||coalesce(p_source,''),300),p_actor,
 left(coalesce(p_note,'Подтверждённое изменение безопасности'),500));
 RETURN newval-oldval;
END;$fn$;
REVOKE ALL ON FUNCTION private.apply_security_delta(uuid,numeric,text,text,uuid,text)
 FROM PUBLIC,anon,authenticated;

-- Inflation -0.8, key rate -0.5, explicit business activity +0.6.
-- Oil and FX are indirect through the already approved fiscal model.
CREATE OR REPLACE FUNCTION private.security_from_macro_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
DECLARE di numeric:=0;dr numeric:=0;da numeric:=0;d numeric;
BEGIN
 IF NEW.source_type<>'macro' THEN RETURN NEW;END IF;
 IF jsonb_typeof(NEW.before_values->'inflation')='number'
    AND jsonb_typeof(NEW.after_values->'inflation')='number' THEN
  di:=(NEW.after_values->>'inflation')::numeric-(NEW.before_values->>'inflation')::numeric;
 END IF;
 IF jsonb_typeof(NEW.before_values->'key_rate')='number'
    AND jsonb_typeof(NEW.after_values->'key_rate')='number' THEN
  dr:=(NEW.after_values->>'key_rate')::numeric-(NEW.before_values->>'key_rate')::numeric;
 END IF;
 IF jsonb_typeof(NEW.before_values->'activity_override')='number'
    AND jsonb_typeof(NEW.after_values->'activity_override')='number' THEN
  da:=(NEW.after_values->>'activity_override')::numeric-(NEW.before_values->>'activity_override')::numeric;
 END IF;
 d:=-0.8*di-0.5*dr+0.6*da;
 IF d<>0 THEN
  PERFORM private.apply_security_delta(NEW.game_id,d,'macro',NEW.source_id,NEW.actor_id,
    'Безопасность: изменения инфляции, ключевой ставки и заданной деловой активности');
 END IF;
 RETURN NEW;
END;$fn$;
REVOKE ALL ON FUNCTION private.security_from_macro_ledger() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_security_macro_ledger ON public.fiscal_change_ledger;
CREATE TRIGGER trg_security_macro_ledger AFTER INSERT ON public.fiscal_change_ledger
FOR EACH ROW WHEN (NEW.source_type='macro')
EXECUTE FUNCTION private.security_from_macro_ledger();

-- Real independent shifts only. Do not use calculated activity, voted
-- rules, legitimacy social derivatives, or crisis rule side effects.
CREATE OR REPLACE FUNCTION private.security_from_metric_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
DECLARE k numeric:=0;
BEGIN
 IF NEW.delta=0 THEN RETURN NEW;END IF;
 IF NEW.metric_key='economy' AND NEW.source_type IN ('teacher','decision','fiscal')
 THEN k:=0.7;
 ELSIF NEW.metric_key='social_tension' AND NEW.source_type IN ('teacher','decision')
 THEN k:=-0.4;
 ELSIF NEW.metric_key='lawfulness'
 AND NEW.source_type IN ('teacher','decision','event_authority')
 THEN k:=0.3;
 ELSIF NEW.metric_key='international_standing'
 AND NEW.source_type IN ('teacher','decision')
 THEN k:=0.2;
 END IF;
 IF k=0 THEN RETURN NEW;END IF;
 -- One security case should not be charged twice from its own fiscal/legal
 -- outcomes and from its independently classified event outcome.
 IF (NEW.metric_key='economy' AND NEW.source_type='fiscal')
 OR (NEW.metric_key='lawfulness' AND NEW.source_type='event_authority') THEN
  IF EXISTS(SELECT 1 FROM public.event_cases c
     WHERE c.game_id=NEW.game_id AND c.id::text=NEW.source_id
       AND c.category='Безопасность') THEN RETURN NEW;END IF;
 END IF;
 PERFORM private.apply_security_delta(NEW.game_id,NEW.delta*k,
 NEW.source_type,NEW.source_id,NEW.actor_id,
 'Безопасность: самостоятельное изменение '||NEW.metric_key||' × '||k::text);
 RETURN NEW;
END;$fn$;
REVOKE ALL ON FUNCTION private.security_from_metric_history() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_security_independent_metrics ON public.state_metric_history;
CREATE TRIGGER trg_security_independent_metrics AFTER INSERT ON public.state_metric_history
FOR EACH ROW
WHEN (NEW.delta<>0 AND NEW.metric_key IN
 ('economy','social_tension','lawfulness','international_standing'))
EXECUTE FUNCTION private.security_from_metric_history();

-- Initial crisis penalty already applies. Only management actions are new.
CREATE OR REPLACE FUNCTION private.security_from_crisis_management()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
DECLARE d numeric;
BEGIN
 IF NEW.kind NOT IN ('escalate','stabilize','finish') THEN RETURN NEW;END IF;
 d:=-0.10*(NEW.new_threat-NEW.old_threat)
    +0.05*(NEW.new_containment-NEW.old_containment)
    +CASE WHEN NEW.kind='finish' THEN 1 ELSE 0 END;
 IF d<>0 THEN
  PERFORM private.apply_security_delta(NEW.game_id,d,'crisis-management',
     NEW.action_id::text,NEW.actor_id,
     'Безопасность: развитие кризиса, локализация угрозы либо завершение');
 END IF;
 RETURN NEW;
END;$fn$;
REVOKE ALL ON FUNCTION private.security_from_crisis_management() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_security_crisis_management ON public.crisis_management_history;
CREATE TRIGGER trg_security_crisis_management AFTER INSERT ON public.crisis_management_history
FOR EACH ROW EXECUTE FUNCTION private.security_from_crisis_management();

-- Only case category "Безопасность", based on selected winning option.
-- Positive benefit requires existing lawful authorized evidence.
-- Historical 'beneficial' with a negative aggregate trust delta is not
-- interpreted as a security loss: trust and safety are separate.
CREATE OR REPLACE FUNCTION private.security_from_event_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $fn$
DECLARE c public.event_cases%rowtype;opt jsonb;interest text;d numeric:=0;
BEGIN
 SELECT * INTO c FROM public.event_cases
 WHERE id=NEW.case_id AND game_id=NEW.game_id AND category='Безопасность';
 IF c.id IS NULL OR coalesce(NEW.winner,'') !~ '^option_[0-9]+$' THEN RETURN NEW;END IF;
 opt:=c.effect_plan->'options'->(substring(NEW.winner from 8)::integer-1);
 IF jsonb_typeof(opt)<>'object' THEN RETURN NEW;END IF;
 interest:=opt->>'public_interest';
 IF interest IN ('beneficial','partial') AND coalesce((opt->>'lawful')::boolean,false) THEN
  IF EXISTS(SELECT 1 FROM public.event_decisions d
    JOIN public.event_authority_evidence e ON e.decision_id=d.id
    WHERE d.game_id=NEW.game_id AND d.case_id=NEW.case_id
    AND e.best_option AND e.authority_ok AND e.lawful) THEN
   d:=CASE WHEN interest='beneficial' THEN 2 ELSE 0.5 END;
  END IF;
 ELSIF interest='harmful' THEN
  d:=CASE WHEN c.seriousness IN ('serious','critical') THEN -4 ELSE -2 END;
 END IF;
 IF d<>0 THEN
  PERFORM private.apply_security_delta(NEW.game_id,d,'security-event',
  NEW.case_id::text,NULL,'Безопасность: исход ситуации «'||c.title||'»');
 END IF;
 RETURN NEW;
END;$fn$;
REVOKE ALL ON FUNCTION private.security_from_event_outcome() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_security_event_outcome ON public.event_case_outcomes;
CREATE TRIGGER trg_security_event_outcome AFTER INSERT ON public.event_case_outcomes
FOR EACH ROW EXECUTE FUNCTION private.security_from_event_outcome();

-- No extra auto-generated news for any derived metrics: they are already
-- available in the existing history and subscriptions.
CREATE OR REPLACE TRIGGER publish_public_metric_rating
 AFTER INSERT ON public.state_metric_history FOR EACH ROW
 WHEN (NEW.source_type IS DISTINCT FROM 'derived:legitimacy-social'
 AND NEW.source_type IS DISTINCT FROM 'derived:security')
 EXECUTE FUNCTION private.publish_rating_change();
