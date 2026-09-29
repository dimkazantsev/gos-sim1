-- Authored multi-option event decisions, server-side outcome resolution and a single
-- fictional news report per resolved event (never masquerade as a real media outlet).
alter table public.event_cases add column if not exists comic_scene jsonb not null default '{}'::jsonb;
alter table public.political_posts add column if not exists comic_scene jsonb;
alter table public.event_decisions drop constraint if exists event_decisions_choice_check;
alter table public.event_decisions add constraint event_decisions_choice_check
 check(choice in ('accept','reject','option_1','option_2','option_3','option_4','option_5','option_6'));
create table if not exists public.event_case_outcomes(
 game_id uuid not null references public.games(id) on delete cascade,
 case_id uuid primary key references public.event_cases(id) on delete cascade,
 winner text not null,yes_votes int not null default 0,no_votes int not null default 0,
 votes_count int not null default 0,assignments_count int not null default 0,
 trust_delta numeric not null default 0,media_post_id uuid references public.political_posts(id) on delete set null,
 resolved_at timestamptz not null default now()
);
alter table public.event_case_outcomes enable row level security;
create policy event_outcome_read on public.event_case_outcomes for select to authenticated
 using(private.is_game_member(game_id));
grant select on public.event_case_outcomes to authenticated;
create or replace function private.finalize_game_case(p_case uuid,p_allow_pending boolean default false)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.event_cases%rowtype;n int;assigned int;yes_count int;no_count int;
 winner text;delta numeric:=0;info jsonb;v_post uuid;v_author uuid;v_media text;v_label text;
begin
 select * into c from public.event_cases where id=p_case for update;
 if c.id is null then raise exception 'Case unavailable';end if;
 if exists(select 1 from public.event_case_outcomes where case_id=p_case)
 then return jsonb_build_object('reason','already_finalized');end if;
 select count(*) into assigned from public.event_assignments where case_id=p_case;
 if assigned=0 then return jsonb_build_object('reason','not_assigned');end if;
 if not p_allow_pending and exists(select 1 from public.event_assignments where case_id=p_case and status='pending')
 then return jsonb_build_object('reason','awaiting_answers');end if;
 select count(*) into n from public.event_decisions where case_id=p_case;
 if n=0 then return jsonb_build_object('reason','no_answers');end if;
 select count(*) into yes_count from public.event_decisions where case_id=p_case and choice in ('accept','option_1');
 select count(*) into no_count from public.event_decisions where case_id=p_case and choice in ('reject','option_3');
 -- One vote per assigned student. Ties deliberately produce a neutral outcome.
 select d.choice into winner from public.event_decisions d where d.case_id=p_case
 group by d.choice order by count(*) desc,d.choice asc limit 1;
 if (select count(*) from public.event_decisions where case_id=p_case and choice=winner)
   <=(select coalesce(max(ct),0) from (select count(*) ct from public.event_decisions
     where case_id=p_case and choice<>winner group by choice) alternatives)
 then winner:='tie';end if;
 info:=case when winner='accept' then c.effect_plan->'options'->0
  when winner='reject' then c.effect_plan->'options'->1
  when winner like 'option_%' then c.effect_plan->'options'->((substring(winner from 8))::int-1)
  else '{}'::jsonb end;
 delta:=case when winner='tie' then 0 else coalesce((info->>'trust')::numeric,0) end;
 select owner_id into v_author from public.games where id=c.game_id;
 v_media:=case
 when c.category ilike '%Эколог%' then 'Экологический вестник Республики'
 when c.category ilike '%Эконом%' or c.category ilike '%инфраструкт%' then 'Деловая газета Республики'
 when c.category ilike '%Культур%' or c.seriousness='light' then 'Городские истории · Радио Республики'
 when c.category ilike '%Международ%' then 'Международный обозреватель Республики'
 else 'Общественная служба новостей Республики' end;
 v_label:=case when winner='tie' then 'Участники не пришли к единому решению'
  else coalesce(c.decision_options->>case when winner='accept' then 0 when winner='reject' then 1
   else (substring(winner from 8))::int-1 end,'Решение принято') end;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,
  internal_view,internal_ref_id,status,comic_scene,effects_applied)
 values(c.game_id,v_author,'news','media',v_media,
  'Республика обсуждает: '||c.title,
  c.situation||E'\n\n'||'По итогам голосования: '||v_label||'. '||
   case when winner='tie' then 'Итоговый рейтинг не изменён: голоса разделились поровну.'
        when delta>0 then 'В игровой модели доверие граждан выросло на '||delta||' п.п.'
        when delta<0 then 'В игровой модели доверие граждан снизилось на '||abs(delta)||' п.п.'
        else 'Решение не изменило игровой показатель доверия.' end,
 ARRAY['EVENT','Учебные новости',c.category],
 'events',c.id::text,'published',
 coalesce(c.comic_scene,'{}'::jsonb)||jsonb_build_object('title',c.title,'category',c.category),
 true) returning id into v_post;
 insert into public.event_case_outcomes(game_id,case_id,winner,yes_votes,no_votes,votes_count,assignments_count,trust_delta,media_post_id)
 values(c.game_id,c.id,winner,yes_count,no_count,n,assigned,delta,v_post);
 if delta<>0 then perform private.apply_event_trust_delta(c.game_id,'choice-'||c.id::text,delta,
  'Учебный исход события: '||c.title||'; '||v_label);end if;
 return jsonb_build_object('winner',winner,'trust_delta',delta,'post_id',v_post);
end;
$$;
revoke all on function private.finalize_game_case(uuid,boolean) from public,anon,authenticated;
create or replace function public.finalize_event_case(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare g uuid;
begin
 select game_id into g from public.event_cases where id=p_case_id;
 if g is null or not private.is_game_teacher(g) then raise exception 'Teacher required';end if;
 return private.finalize_game_case(p_case_id,true);
end;
$$;
revoke all on function public.finalize_event_case(uuid) from public,anon;
grant execute on function public.finalize_event_case(uuid) to authenticated;
create or replace function public.submit_event_decision(p_assignment_id uuid,p_choice text,p_rationale text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.event_assignments%rowtype;c public.event_cases%rowtype;choice_index int;
begin
 select * into a from public.event_assignments where id=p_assignment_id for update;
 if a.id is null or a.recipient_id<>auth.uid() then raise exception 'Assignment unavailable';end if;
 if exists(select 1 from public.game_members where game_id=a.game_id and user_id=auth.uid() and kind='observer')
 then raise exception 'Guests cannot vote';end if;
 if a.status<>'pending' then raise exception 'Already decided';end if;
 select * into c from public.event_cases where id=a.case_id;
 if exists(select 1 from public.event_case_outcomes where case_id=c.id) then raise exception 'Event already finalized';end if;
 choice_index:=case p_choice when 'accept' then 1 when 'reject' then 2
  else case when p_choice ~ '^option_[1-6]$' then substring(p_choice from 8)::int else 0 end end;
 if choice_index<1 or choice_index>jsonb_array_length(c.decision_options)
 then raise exception 'Invalid choice';end if;
 insert into public.event_decisions(assignment_id,case_id,game_id,actor_id,choice,rationale)
 values(a.id,a.case_id,a.game_id,auth.uid(),p_choice,left(coalesce(p_rationale,''),3000));
 update public.event_assignments set status=case when p_choice='accept' then 'accepted'
 when p_choice='reject' then 'rejected' else 'resolved' end where id=a.id;
 perform private.finalize_game_case(c.id,false);
 perform private.apply_event_trust(c.game_id);
end;
$$;
revoke all on function public.submit_event_decision(uuid,text,text) from public,anon;
grant execute on function public.submit_event_decision(uuid,text,text) to authenticated;