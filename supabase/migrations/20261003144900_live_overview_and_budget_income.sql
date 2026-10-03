-- Game-scoped authoritative monitoring and a single federal income forecast.
create table public.budget_income_history(
 id bigint generated always as identity primary key,
 game_id uuid not null references public.games(id) on delete cascade,
 plan_id uuid references public.budget_simulator_plans(id) on delete set null,
 value numeric not null,previous_value numeric,expenditure numeric not null,
 mode text not null check(mode in ('baseline','draft','document','published')),
 note text not null,recorded_at timestamptz not null default clock_timestamp()
);
create index budget_income_history_game on public.budget_income_history(game_id,id desc);
create index budget_income_history_plan on public.budget_income_history(plan_id) where plan_id is not null;
alter table public.budget_income_history enable row level security;
create policy budget_income_history_read on public.budget_income_history for select to authenticated using(private.is_game_member(game_id));
revoke all on public.budget_income_history from anon,authenticated;
grant select on public.budget_income_history to authenticated;

-- Once a game adopts the 2026 model, legacy budget deltas remain meaningful:
-- a manual correction/rule/reversal changes federal income by the same million roubles.
create function private.bridge_budget_income_change() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare delta numeric;
begin
 if old.metric_key<>'budget' or coalesce(old.description,'') not like 'Общий прогноз федеральных доходов на 2026 год.%'
  or current_setting('gos.budget_income_sync',true)='on' then return new;end if;
 delta:=new.value-old.value;
 if delta<>0 then
  update budget_simulator_state set revenue_adjustment=revenue_adjustment+delta,version=version+1,updated_at=clock_timestamp() where game_id=new.game_id;
  if found then insert into budget_simulator_ledger(game_id,kind,note,amount,source_key)
   values(new.game_id,'income_adjustment','Изменение доходов через модель последствий. Величина включена в общий федеральный расчет.',delta,'income-adjustment:'||gen_random_uuid());end if;
 end if;
 return new;
end$$;
revoke all on function private.bridge_budget_income_change() from public,anon,authenticated;
create trigger budget_income_change before update of value on public.state_metrics for each row execute function private.bridge_budget_income_change();

create function public.get_budget_pulse(p_game_id uuid) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare simulation jsonb;plan jsonb;draft jsonb;base jsonb;calculation jsonb;latest budget_income_history%rowtype;
 v_mode text;v_note text;v_metric_id uuid;new_value numeric;old_value numeric;sync_before text;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к бюджету этой игры.';end if;
 perform pg_advisory_xact_lock(hashtextextended('gos-budget-pulse:'||p_game_id::text,0));
 simulation:=public.get_budget_simulator(p_game_id);
 -- Matches the calculator's initial selection: latest saved draft, otherwise latest plan.
 select x into plan from jsonb_array_elements(simulation->'plans') with ordinality as p(x,n)
 order by case when x->>'status'='draft' then 0 else 1 end,n limit 1;
 if plan is null then
  select data into base from private.budget_baseline where year=2026;
  draft:=jsonb_build_object('title','Проект федерального бюджета на 2026 год','note','','income_changes','{}'::jsonb,'spending_changes','{}'::jsonb,'revenue_adjustments','{}'::jsonb,
   'financing',base->'financing','terms',jsonb_build_object('ofz_fixed',60,'ofz_float',60,'bank_credit',12,'external',60),'transfer_ids','[]'::jsonb);
  v_mode:='baseline';v_note:='Исходный план 2026 года с учетом текущих игровых условий.';
 else
  draft:=plan->'draft';v_mode:=plan->>'status';v_note:=case v_mode when 'draft' then 'Общий сохраненный черновик' when 'document' then 'Проект закона в реестре' else 'Опубликованный игровой бюджет' end||': '||(plan->>'title')||'.';
 end if;
 calculation:=private.calculate_budget_simulator(p_game_id,draft);new_value:=(calculation->>'revenue')::numeric;
 select * into latest from budget_income_history where game_id=p_game_id order by id desc limit 1;
 if latest.id is null or latest.value is distinct from new_value or latest.expenditure is distinct from (calculation->>'expenditure')::numeric
  or latest.plan_id is distinct from (plan->>'id')::uuid or latest.mode is distinct from v_mode then
  insert into budget_income_history(game_id,plan_id,value,previous_value,expenditure,mode,note)
  values(p_game_id,(plan->>'id')::uuid,new_value,latest.value,(calculation->>'expenditure')::numeric,v_mode,v_note) returning * into latest;
 end if;
 select id,value into v_metric_id,old_value from state_metrics where game_id=p_game_id and metric_key='budget';
 sync_before:=current_setting('gos.budget_income_sync',true);perform set_config('gos.budget_income_sync','on',true);
 if v_metric_id is null then
  insert into state_metrics(game_id,metric_key,label,value,previous_value,unit,is_public,group_key,description,min_value,max_value,sort_order)
  values(p_game_id,'budget','Доходы бюджета',new_value,new_value,'млн ₽',true,'economy','Общий прогноз федеральных доходов на 2026 год. До опубликования закона это прогноз, а не исполнение бюджета.',null,null,3) returning id into v_metric_id;
 else
  update state_metrics set label='Доходы бюджета',value=new_value,previous_value=coalesce(latest.previous_value,new_value),unit='млн ₽',min_value=null,max_value=null,
   description='Общий прогноз федеральных доходов на 2026 год. До опубликования закона это прогноз, а не исполнение бюджета.'
   where id=v_metric_id and (label is distinct from 'Доходы бюджета' or value is distinct from new_value or unit is distinct from 'млн ₽'
     or max_value is not null or coalesce(description,'') not like 'Общий прогноз федеральных доходов на 2026 год.%');
 end if;
 perform set_config('gos.budget_income_sync',coalesce(sync_before,''),true);
 return jsonb_build_object('game_id',p_game_id,'mode',v_mode,'plan_id',plan->>'id','document_id',plan->>'document_id','plan_revision',plan->'revision','note',v_note,
  'calculation',calculation,'as_of',clock_timestamp(),'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) from
   (select id,game_id,v_metric_id as metric_id,'budget'::text as metric_key,value,previous_value,value-coalesce(previous_value,value) as delta,
    'budget_forecast'::text as source_type,plan_id::text as source_id,null::uuid as actor_id,note,recorded_at
    from budget_income_history where game_id=p_game_id order by id desc limit 300)h));
end$$;
revoke all on function public.get_budget_pulse(uuid) from public,anon;
grant execute on function public.get_budget_pulse(uuid) to authenticated;

create function public.get_teacher_overview(p_game_id uuid) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare n timestamptz:=clock_timestamp();result jsonb;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Обзор управления доступен только преподавателю этой игры.';end if;
 with students as(select user_id from game_members where game_id=p_game_id and kind='student' and roster_archived_at is null)
 select jsonb_build_object(
 'as_of',n,
 'students',(select count(*) from students),
 'online',(select count(*) from students s join game_presence p on p.user_id=s.user_id and p.game_id=p_game_id where p.last_seen_at>=n-interval '90 seconds' and p.last_seen_at<=n+interval '5 seconds'),
 'active_day',(select count(distinct a.actor_id) from game_activity a join students s on s.user_id=a.actor_id where a.game_id=p_game_id and a.created_at>=n-interval '24 hours' and a.created_at<=n),
 'actions_day',(select count(*) from game_activity a join students s on s.user_id=a.actor_id where a.game_id=p_game_id and a.created_at>=n-interval '24 hours' and a.created_at<=n),
 'stages_total',(select count(*) from game_stages where game_id=p_game_id),
 'stages_completed',(select count(*) from game_stages where game_id=p_game_id and status='completed'),
 'stages_overdue',(select count(*) from game_stages where game_id=p_game_id and status='open' and deadline<n),
 'documents_total',(select count(*) from formal_documents where game_id=p_game_id),
 'documents_draft',(select count(*) from formal_documents where game_id=p_game_id and status_code='draft'),
 'documents_published',(select count(*) from formal_documents where game_id=p_game_id and status_code='published'),
 'documents_moving',(select count(*) from formal_documents where game_id=p_game_id and status_code not in ('draft','published','rejected','withdrawn','cancelled')),
 'votes_open',(select count(*) from game_votes where game_id=p_game_id and status='open'),
 'votes_closed',(select count(*) from game_votes where game_id=p_game_id and status='closed'),
 'votes_failed_quorum',(select count(*) from game_votes where game_id=p_game_id and status='closed' and result_quorum_met=false),
 'ballots_open',(select count(*) from game_ballots b join game_votes v on v.id=b.vote_id and v.game_id=p_game_id where v.status='open'),
 'parties_total',(select count(*) from game_parties where game_id=p_game_id),
 'parties_registered',(select count(*) from game_parties where game_id=p_game_id and registration_status='registered'),
 'parties_waiting',(select count(*) from game_parties where game_id=p_game_id and registration_status='submitted'),
 'party_files',(select count(*) from party_documents where game_id=p_game_id),
 'mandates',(select coalesce(sum(mandates),0) from game_parties where game_id=p_game_id),
 'mandates_available',(select coalesce(sum(greatest(0,mandates-ghost_loss_current-representation_penalty)),0) from game_parties where game_id=p_game_id),
 'mandates_allocated',(select coalesce(sum(pm.base_mandates),0) from party_member_mandates pm join students s on s.user_id=pm.user_id where pm.game_id=p_game_id),
 'cases_active',(select count(distinct a.case_id) from event_assignments a join students s on s.user_id=a.recipient_id where a.game_id=p_game_id and a.status in ('pending','accepted') and not exists(select 1 from event_case_outcomes o where o.game_id=p_game_id and o.case_id=a.case_id)),
 'case_invites_waiting',(select count(*) from event_assignments a join students s on s.user_id=a.recipient_id where a.game_id=p_game_id and a.status='pending' and not exists(select 1 from event_case_outcomes o where o.game_id=p_game_id and o.case_id=a.case_id)),
 'cases_resolved',(select count(*) from event_case_outcomes where game_id=p_game_id),
 'posts_public',(select count(*) from political_posts where game_id=p_game_id and deleted_at is null and status in ('published','accepted')),
 'media_waiting',(select count(*) from media_news_proposals where game_id=p_game_id and status='pending'),
 'grades_final',(select count(*) from stage_assessments a join students s on s.user_id=a.user_id where a.game_id=p_game_id and a.status='final'),
 'grades_waiting',(select count(*) from stage_assessments a join students s on s.user_id=a.user_id where a.game_id=p_game_id and a.status='draft' and (a.auto_score>0 or a.evidence_summary<>'{}'::jsonb)),
 'grade_average',(select round(avg(a.final_score),2) from stage_assessments a join students s on s.user_id=a.user_id where a.game_id=p_game_id and a.status='final'),
 'changes_day',(select count(*) from state_metric_history where game_id=p_game_id and source_type<>'baseline' and recorded_at>=n-interval '24 hours' and recorded_at<=n)
 ) into result;
 return result;
end$$;
revoke all on function public.get_teacher_overview(uuid) from public,anon;
grant execute on function public.get_teacher_overview(uuid) to authenticated;
