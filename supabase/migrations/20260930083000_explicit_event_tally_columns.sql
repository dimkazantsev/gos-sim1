-- Qualify tally aliases to avoid ambiguity with the narrative label variable.
create or replace function private.finalize_game_case(p_case uuid,p_allow_pending boolean default false)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.event_cases%rowtype;n integer;assigned integer;yes_count integer;no_count integer;
 winner text;requested numeric:=0;actual numeric:=0;info jsonb;post_id uuid;author uuid;media text;label text;
 tallies jsonb;best integer;winners integer;idx integer;kind text;lead text;body text;pending integer;
begin
 select * into c from public.event_cases where id=p_case for update;
 if c.id is null then raise exception 'Событие недоступно';end if;
 if exists(select 1 from public.event_case_outcomes where case_id=p_case)
 then return jsonb_build_object('reason','already_finalized');end if;
 select count(*),count(*) filter(where status='pending') into assigned,pending from public.event_assignments where case_id=p_case;
 if assigned=0 then return jsonb_build_object('reason','not_assigned');end if;
 if pending>0 and not p_allow_pending then return jsonb_build_object('reason','awaiting_answers');end if;
 select count(*) into n from public.event_decisions where case_id=p_case;
 if n=0 then return jsonb_build_object('reason','no_answers');end if;
 with counts as (
  select 'option_'||o.ordinality key,o.ordinality idx,o.value label,
    (select count(*) from public.event_decisions d where d.case_id=p_case and
     case d.choice when 'accept' then 'option_1' when 'reject' then 'option_2' else d.choice end='option_'||o.ordinality)::integer votes
  from jsonb_array_elements_text(c.decision_options) with ordinality o
 ) select jsonb_agg(jsonb_build_object('key',ct.key,'label',ct.label,'votes',ct.votes) order by ct.idx),max(ct.votes)
 into tallies,best from counts ct;
 select count(*) into winners from jsonb_array_elements(tallies) t where (t->>'votes')::integer=best;
 if winners<>1 then winner:='tie';idx:=-1;info:='{}';
 else
  select t->>'key' into winner from jsonb_array_elements(tallies) t where (t->>'votes')::integer=best;
  idx:=substring(winner from 8)::integer-1;info:=c.effect_plan->'options'->idx;
 end if;
 requested:=case when winner='tie' then 0 else coalesce((info->>'trust')::numeric,0) end;
 kind:=case when winner='tie' then 'tie' when requested>0 then 'beneficial' when requested<0 then 'harmful' else 'neutral' end;
 select count(*) filter(where coalesce((c.effect_plan->'options'->
  (case choice when 'accept' then 0 when 'reject' then 1 else substring(choice from 8)::integer-1 end)->>'trust')::numeric,0)>0),
  count(*) filter(where coalesce((c.effect_plan->'options'->
  (case choice when 'accept' then 0 when 'reject' then 1 else substring(choice from 8)::integer-1 end)->>'trust')::numeric,0)<0)
 into yes_count,no_count from public.event_decisions where case_id=c.id;
 label:=case when winner='tie' then 'Равное число голосов — общее решение не определено' else c.decision_options->>idx end;
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
  then 'Голоса разделились поровну. Общее решение не принято; показатель доверия не изменился.'
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
$$;
