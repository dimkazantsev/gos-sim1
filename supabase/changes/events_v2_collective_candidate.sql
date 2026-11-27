-- Step 3 candidate, apply after step 2 only during final V2 release.
ALTER TABLE public.event_decisions ADD COLUMN vote_round integer NOT NULL DEFAULT 1 CHECK (vote_round IN (1,2));
ALTER TABLE public.event_decisions DROP CONSTRAINT event_decisions_case_id_actor_id_key;
ALTER TABLE public.event_decisions ADD CONSTRAINT event_decisions_case_actor_round_key UNIQUE(case_id,actor_id,vote_round);
CREATE OR REPLACE FUNCTION private.event_v2_validate_collective(p_plan jsonb,p_labels jsonb,p_scene jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $f$
DECLARE o jsonb;v record;
BEGIN
 IF p_plan ? 'best_option_key' OR jsonb_typeof(p_plan->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'options')<>jsonb_array_length(p_labels) THEN RAISE EXCEPTION 'Коллективная разметка недопустима';END IF;
 FOR o IN SELECT value FROM jsonb_array_elements(p_plan->'options') LOOP
  IF NOT coalesce((o->>'lawful')::boolean,false) OR jsonb_typeof(o->'trust') IS DISTINCT FROM 'number' OR abs((o->>'trust')::numeric)>4 THEN RAISE EXCEPTION 'Недопустимый коллективный вариант';END IF;
  IF o ? 'metric_effects' AND jsonb_typeof(o->'metric_effects') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Недопустимые последствия';END IF;
  FOR v IN SELECT * FROM jsonb_each(coalesce(o->'metric_effects','{}')) LOOP
   IF v.key NOT IN ('economy','elite_support','international_standing','media_climate','security','social_stability','social_tension') OR jsonb_typeof(v.value)<>'number' OR abs((v.value::text)::numeric)>4 OR (v.key='economy' AND o ? 'fiscal_effect') THEN RAISE EXCEPTION 'Недопустимый или двойной эффект: %',v.key;END IF;
  END LOOP;
  IF o ? 'fiscal_effect' AND (jsonb_typeof(o->'fiscal_effect') IS DISTINCT FROM 'object' OR nullif(p_scene->>'region_code','') IS NULL) THEN RAISE EXCEPTION 'Региональный эффект без региона';END IF;
 END LOOP;
END $f$;
CREATE OR REPLACE FUNCTION private.event_v2_apply_collective_metrics(p_case uuid,p_winner text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE c public.event_cases%rowtype;v record;mid uuid;oldval numeric;newval numeric;d numeric;
BEGIN
 IF p_winner !~ '^option_[1-6]$' THEN RETURN;END IF;
 SELECT * INTO c FROM public.event_cases WHERE id=p_case;
 IF NOT coalesce((c.audience IN ('group','all') AND c.effect_plan->>'rules_version'='2'),false) THEN RETURN;END IF;
 FOR v IN SELECT * FROM jsonb_each(coalesce(c.effect_plan->'options'->(substring(p_winner from 8)::int-1)->'metric_effects','{}')) ORDER BY key LOOP
  d:=(v.value::text)::numeric;IF d=0 THEN CONTINUE;END IF;
  UPDATE public.state_metrics m SET previous_value=m.value,value=greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),m.value+d))
  WHERE m.game_id=c.game_id AND m.metric_key=v.key AND greatest(coalesce(m.min_value,0),least(coalesce(m.max_value,100),m.value+d)) IS DISTINCT FROM m.value
  RETURNING id,previous_value,value INTO mid,oldval,newval;
  IF FOUND THEN INSERT INTO public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note) VALUES(c.game_id,mid,v.key,newval,oldval,newval-oldval,'event_collective',c.id::text,NULL,'Коллективное решение: '||c.title);END IF;
 END LOOP;
END $f$;
REVOKE ALL ON FUNCTION private.event_v2_validate_collective(jsonb,jsonb,jsonb),private.event_v2_apply_collective_metrics(uuid,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.finalize_event_case_round(p_case_id uuid,p_round integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE c public.event_cases%rowtype;
BEGIN
 SELECT * INTO c FROM public.event_cases WHERE id=p_case_id FOR UPDATE;
 IF c.id IS NULL OR auth.uid() IS NULL OR NOT private.is_game_teacher(c.game_id) THEN RAISE EXCEPTION 'Требуются права преподавателя';END IF;
 IF NOT coalesce((c.audience IN ('group','all') AND c.effect_plan->>'rules_version'='2'),false) OR p_round IS DISTINCT FROM coalesce((c.comic_scene->>'vote_round')::int,1) THEN RAISE EXCEPTION 'Обновите текущий тур';END IF;
 RETURN private.finalize_game_case(p_case_id,true);
END $f$;
REVOKE ALL ON FUNCTION public.finalize_event_case_round(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_event_case_round(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION private.finalize_game_case(p_case uuid, p_allow_pending boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.event_cases%rowtype;n integer;assigned integer;yes_count integer;no_count integer;
 winner text;requested numeric:=0;actual numeric:=0;info jsonb;post_id uuid;author uuid;media text;label text;
 tallies jsonb;best integer;winners integer;idx integer;kind text;lead text;body text;pending integer;v_round int:=1;v_finalists jsonb;v_cutoff int;v_collective boolean:=false;
begin
 select * into c from public.event_cases where id=p_case for update;
 if c.id is null then raise exception 'Событие недоступно';end if;
 if exists(select 1 from public.event_case_outcomes where case_id=p_case)
 then return jsonb_build_object('reason','already_finalized');end if;
 select count(*),count(*) filter(where status='pending') into assigned,pending from public.event_assignments where case_id=p_case;
 v_collective:=coalesce((c.audience IN ('group','all') AND c.effect_plan->>'rules_version'='2'),false);
 if v_collective then v_round:=coalesce((c.comic_scene->>'vote_round')::int,1);perform private.event_v2_validate_collective(c.effect_plan,c.decision_options,c.comic_scene);end if;
 if assigned=0 then return jsonb_build_object('reason','not_assigned');end if;
 if exists(select 1 from public.event_collaboration_invites where case_id=p_case and status='pending') then return jsonb_build_object('reason','awaiting_invitations');end if;
 if pending>0 and not p_allow_pending then return jsonb_build_object('reason','awaiting_answers');end if;
 select count(*) into n from public.event_decisions where case_id=p_case and vote_round=v_round;
 if n=0 and not (v_collective and v_round=2 and p_allow_pending) then return jsonb_build_object('reason','no_answers');end if;
 with counts as (
  select 'option_'||o.ordinality key,o.ordinality idx,o.value label,
    (select count(*) from public.event_decisions d where d.case_id=p_case and d.vote_round=v_round and
     case d.choice when 'accept' then 'option_1' when 'reject' then 'option_2' else d.choice end='option_'||o.ordinality)::integer votes
  from jsonb_array_elements_text(c.decision_options) with ordinality o
  where v_round=1 or (c.comic_scene->'runoff_options') ? ('option_'||o.ordinality)
 ) select jsonb_agg(jsonb_build_object('key',ct.key,'label',ct.label,'votes',ct.votes) order by ct.idx),max(ct.votes)
 into tallies,best from counts ct;
 select count(*) into winners from jsonb_array_elements(tallies) t where (t->>'votes')::integer=best;
 if winners<>1 or best*2<=assigned then winner:='tie';idx:=-1;info:='{}';
 else
  select t->>'key' into winner from jsonb_array_elements(tallies) t where (t->>'votes')::integer=best;
  idx:=substring(winner from 8)::integer-1;info:=c.effect_plan->'options'->idx;
 end if;
 if v_collective and v_round=1 and winner='tie' then
  select (t->>'votes')::int into v_cutoff from jsonb_array_elements(tallies) t order by (t->>'votes')::int desc,t->>'key' offset 1 limit 1;
  select jsonb_agg(t->>'key' order by t->>'key') into v_finalists from jsonb_array_elements(tallies) t where (t->>'votes')::int>=coalesce(v_cutoff,0);
  update public.event_cases set comic_scene=coalesce(comic_scene,'{}')||jsonb_build_object('vote_round',2,'runoff_options',v_finalists,'first_round_tallies',tallies) where id=c.id;
  update public.event_assignments set status='pending' where case_id=c.id and status<>'pending';
  return jsonb_build_object('reason','runoff_started','vote_round',2,'runoff_options',v_finalists);
 end if;
 requested:=case when winner='tie' then 0 else coalesce((info->>'trust')::numeric,0) end;
 kind:=case when winner='tie' then 'tie' when v_collective then 'neutral' when requested>0 then 'beneficial' when requested<0 then 'harmful' else 'neutral' end;
 select count(*) filter(where coalesce((c.effect_plan->'options'->
  (case choice when 'accept' then 0 when 'reject' then 1 else substring(choice from 8)::integer-1 end)->>'trust')::numeric,0)>0),
  count(*) filter(where coalesce((c.effect_plan->'options'->
  (case choice when 'accept' then 0 when 'reject' then 1 else substring(choice from 8)::integer-1 end)->>'trust')::numeric,0)<0)
 into yes_count,no_count from public.event_decisions where case_id=c.id and vote_round=v_round;
 label:=case when winner='tie' then 'Большинство участников не поддержало единый вариант — решение не принято' else c.decision_options->>idx end;
 perform private.apply_event_trust_delta(c.game_id,'choice-'||c.id,requested,'Итог события: '||c.title||'; '||label);
 select delta into actual from public.event_trust_ledger where game_id=c.game_id and action_key='choice-'||c.id;
 media:=coalesce(nullif(c.comic_scene->>'media_label',''),case
  when c.category ilike '%Эколог%' then 'Экологический Вестник Республики'
  when c.category ilike '%Эконом%' then 'Деловая Газета Республики'
  when c.category ilike '%Международ%' then 'Международный Обозреватель Республики'
  when c.seriousness='light' then 'Культурное Радио Республики'
  else 'Общественная Служба Новостей Республики' end);
 lead:=coalesce(nullif(c.comic_scene->>'news_lead',''),'Сегодня ситуация «'||c.title||'» получила ответ участников игры.');
 body:=lead||E'\n\nВыбрано: '||label||'.'||E'\n\n'||case when winner='tie'
  then 'Ни один вариант не получил большинство участников. Общее решение не принято; показатель доверия не изменился.'
  else coalesce(nullif(info->>'news',''),nullif(info->>'description',''),nullif(info->>'note',''),'Исход оценён в учебной модели.') end||
  E'\n\nГолосов: '||n||' из '||assigned||'. Фактическое изменение доверия: '||case when actual>0 then '+' else '' end||actual||' п.п.'||
  case when actual<>requested then ' Расчётный эффект: '||requested||' п.п.; применены границы показателя.' else '' end;
 select owner_id into author from public.games where id=c.game_id;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,
  internal_view,internal_ref_id,status,comic_scene,effects_applied)
 values(c.game_id,author,'news','media',media,c.title||' · Итог выбора',body,array['EVENT','Учебные Новости',c.category],
  'events',c.id::text,'published',c.comic_scene||jsonb_build_object('title',c.title,'category',c.category,'case_key',c.case_key),true)
 returning id into post_id;
 insert into public.event_case_outcomes(game_id,case_id,winner,yes_votes,no_votes,votes_count,assignments_count,
  trust_delta,requested_trust_delta,resolution_kind,option_tallies,media_post_id)
 values(c.game_id,c.id,winner,yes_count,no_count,n,assigned,actual,requested,kind,tallies,post_id);
 update public.event_assignments set status='resolved' where case_id=c.id and status='pending';
 return jsonb_build_object('winner',winner,'trust_delta',actual,'requested_trust_delta',requested,'post_id',post_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_event_decision(p_assignment_id uuid, p_choice text, p_rationale text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare a public.event_assignments%rowtype;c public.event_cases%rowtype;choice_index integer;case_id uuid;v_round int:=1;
begin
 select ea.case_id into case_id from public.event_assignments ea where ea.id=p_assignment_id and ea.recipient_id=auth.uid();
 if case_id is null then raise exception 'Задание недоступно';end if;
 -- Every writer locks the case before an assignment, avoiding two-voter deadlocks.
 select * into c from public.event_cases where id=case_id for update;
 select * into a from public.event_assignments where id=p_assignment_id for update;
 if a.recipient_id<>auth.uid() or not exists(select 1 from public.game_members where game_id=a.game_id and user_id=auth.uid() and kind='student')
 then raise exception 'Голосовать может назначенный участник';end if;
 if a.status<>'pending' or exists(select 1 from public.event_case_outcomes where event_case_outcomes.case_id=c.id)
 then raise exception 'Голосование уже завершено';end if;
 if (c.audience IN ('group','all') AND c.effect_plan->>'rules_version'='2') then
  v_round:=coalesce((c.comic_scene->>'vote_round')::int,1);
  if v_round=2 then if p_choice !~ '^round2:option_[1-6]$' then raise exception 'Обновите ситуацию: начался второй тур';end if;p_choice:=substring(p_choice from 8);
  elsif p_choice LIKE 'round2:%' then raise exception 'Второй тур ещё не начался';end if;
 end if;
 choice_index:=case p_choice when 'accept' then 1 when 'reject' then 2 else
  case when p_choice ~ '^option_[1-6]$' then substring(p_choice from 8)::integer else 0 end end;
 if choice_index<1 or choice_index>jsonb_array_length(c.decision_options) then raise exception 'Вариант недоступен';end if;
 insert into public.event_decisions(assignment_id,case_id,game_id,actor_id,choice,rationale,vote_round)
 values(a.id,c.id,c.game_id,auth.uid(),'option_'||choice_index,left(coalesce(p_rationale,''),3000),v_round);
 update public.event_assignments set status='resolved' where id=a.id;
 perform private.finalize_game_case(c.id,false);
 if not coalesce((c.audience IN ('group','all') AND c.effect_plan->>'rules_version'='2'),false) then perform private.apply_event_trust(c.game_id);end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_event_case(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare g uuid;c public.event_cases%rowtype;
begin
 select game_id into g from public.event_cases where id=p_case_id;
 if g is null or not private.is_game_teacher(g) then raise exception 'Teacher required';end if;
 select * into c from public.event_cases where id=p_case_id for update;
 if (c.audience IN ('group','all') AND c.effect_plan->>'rules_version'='2') then raise exception 'Укажите текущий тур голосования';end if;
 return private.finalize_game_case(p_case_id,true);
end;
$function$;

CREATE OR REPLACE FUNCTION private.security_from_event_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE c public.event_cases%rowtype;opt jsonb;interest text;d numeric:=0;
BEGIN
 SELECT * INTO c FROM public.event_cases
 WHERE id=NEW.case_id AND game_id=NEW.game_id AND category='Безопасность';
 IF c.id IS NULL OR coalesce(NEW.winner,'') !~ '^option_[0-9]+$' THEN RETURN NEW;END IF;
 IF (c.audience IN ('group','all') AND c.effect_plan->>'rules_version'='2') THEN RETURN NEW;END IF;
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
END;$function$;

CREATE OR REPLACE FUNCTION public.get_event_decision_feedback(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.event_cases%rowtype;d public.event_decisions%rowtype;e public.event_authority_evidence%rowtype;o jsonb;i integer;answers jsonb;
begin
 select * into c from public.event_cases where id=p_case_id;
 if c.id is null or auth.uid() is null or not private.is_game_member(c.game_id) then
  raise exception 'Game access required' using errcode='42501';
 end if;
 if not private.is_game_teacher(c.game_id) and not exists (
  select 1 from public.event_case_outcomes where case_id=p_case_id and game_id=c.game_id
 ) then
  raise exception 'Explanation is available after final outcome' using errcode='42501';
 end if;
 if (c.audience IN ('group','all') AND c.effect_plan->>'rules_version'='2') then
  if not exists(select 1 from public.event_decisions where case_id=c.id and actor_id=auth.uid()) then raise exception 'Решение недоступно';end if;
  return jsonb_build_object('collective',true,'chosen_consequence',(select c.effect_plan->'options'->(substring(o.winner from 8)::int-1)->>'description' from public.event_case_outcomes o where o.case_id=c.id and o.winner ~ '^option_[1-6]$'));
 end if;
 select * into d from public.event_decisions where case_id=c.id and actor_id=auth.uid();
 if d.id is null then raise exception 'Submit your decision before opening the legal explanation';end if;
 select * into e from public.event_authority_evidence where decision_id=d.id;
 i:=case d.choice when 'accept' then 0 when 'reject' then 1 else substring(d.choice from 8)::int-1 end;
 o:=c.effect_plan->'options'->i;
 select coalesce(jsonb_agg(jsonb_build_object('label',c.decision_options->>(x.n::int-1),'description',x.value->>'description','roles',coalesce(x.value->'authorized_roles',to_jsonb(c.allowed_roles))) order by x.n),'[]'::jsonb)
 into answers from jsonb_array_elements(c.effect_plan->'options') with ordinality x(value,n)
 where coalesce((x.value->>'lawful')::boolean,true);
 return jsonb_build_object('role',d.role_snapshot,'authority_ok',coalesce(e.authority_ok,false),'delegated_ok',coalesce(e.delegated_ok,false),'best_option',coalesce(e.best_option,false),'score_share',coalesce(e.score_share,0),'lawful',coalesce(e.lawful,(o->>'lawful')::boolean,false),'legal_basis',coalesce(e.legal_basis,o->>'legal_basis'),'chosen_consequence',o->>'description','lawful_choices',answers);
end $function$;

CREATE OR REPLACE FUNCTION private.apply_event_trust(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare decided integer;pending integer;n integer;daily_penalty numeric;s public.event_auto_settings%rowtype;
begin
 select * into s from public.event_auto_settings where game_id=p_game;
 if not found then return;end if;
 select count(*) into decided from public.event_case_outcomes o join public.event_cases c on c.id=o.case_id where o.game_id=p_game and o.requested_trust_delta>0 and not coalesce((c.audience IN ('group','all') AND c.effect_plan->>'rules_version'='2'),false);
 if decided>=20 then
   for n in 1..floor(decided/20)::integer loop
     perform private.apply_event_trust_delta(p_game,'resolved-'||n*20,s.trust_per_20,
       'За каждые 20 общих решений в интересах общества: +'||s.trust_per_20||' п.п. доверия');
   end loop;
 end if;
 select count(*) into pending from public.event_assignments a join public.event_cases c on c.id=a.case_id where a.game_id=p_game and a.status='pending' and a.created_at<now()-interval '48 hours' and not coalesce((c.audience IN ('group','all') AND c.effect_plan->>'rules_version'='2'),false);
 daily_penalty=least(3,floor(pending/3)*s.backlog_penalty);
 if daily_penalty>0 then
   perform private.apply_event_trust_delta(p_game,'backlog-'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),
      -daily_penalty,'Накоплено '||pending||' необработанных ситуаций старше 48 часов: -'||daily_penalty||' п.п. доверия');
 end if;
end;
$function$;
