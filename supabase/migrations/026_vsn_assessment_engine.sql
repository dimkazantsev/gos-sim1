-- Automatic VSN assessment engine for all 16 stages.

create or replace function private.vsn_stage_window(p_game uuid,p_stage integer)
returns table(start_at timestamptz,end_at timestamptz)
language sql stable security definer
set search_path=public,private,pg_temp
as $$
  select
    coalesce(
      s.opened_at,
      (select max(x.completed_at) from public.game_stages x
       where x.game_id=p_game and x.stage_no<p_stage and x.completed_at is not null),
      g.created_at
    ) as start_at,
    coalesce(
      s.completed_at,
      (select min(x.opened_at) from public.game_stages x
       where x.game_id=p_game and x.stage_no>p_stage and x.opened_at is not null),
      now()
    ) as end_at
  from public.games g
  join public.game_stages s on s.game_id=g.id and s.stage_no=p_stage
  where g.id=p_game;
$$;

create or replace function private.compute_vsn_assessment(
  p_game uuid,p_user uuid,p_stage integer,p_run_type text default 'hourly'
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  v_start timestamptz; v_end timestamptz;
  v_existing public.stage_assessments%rowtype;
  v_id uuid;
  chat_count int:=0; post_count int:=0; ballot_count int:=0;
  formal_doc_count int:=0; formal_action_count int:=0; formal_ballot_count int:=0;
  player_action_count int:=0; party_action_count int:=0; decision_count int:=0;
  activity_count int:=0; debrief_count int:=0;
  legal_hits int:=0; strategy_hits int:=0; analysis_chat_hits int:=0;
  debrief_categories int:=0; debrief_text text:='';
  participation int:=0; law_signal numeric:=0; strategy_signal numeric:=0;
  c1 boolean:=false; c2 boolean:=false; c3 boolean:=false;
  score int:=0; rationale text; summary jsonb;
begin
  if p_stage<1 or p_stage>16 then raise exception 'Only stages 1-16 are assessed'; end if;

  select * into v_existing
  from public.stage_assessments
  where game_id=p_game and stage_no=p_stage and user_id=p_user
  for update;

  if v_existing.id is not null and v_existing.status='final' then return v_existing.id; end if;

  select w.start_at,w.end_at into v_start,v_end
  from private.vsn_stage_window(p_game,p_stage) w;
  if v_start is null then v_start:=now()-interval '30 days'; end if;
  if v_end is null or v_end<v_start then v_end:=now(); end if;

  select count(*)::int,
         count(*) filter(where lower(coalesce(text,'')) ~
           '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int,
         count(*) filter(where lower(coalesce(text,'')) ~
           '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|голосуем|переговор)')::int,
         count(*) filter(where
           lower(coalesce(text,'')) ~ '(почему|потому|причин|обуслов|из-за)'
           and lower(coalesce(text,'')) ~
             '(последств|результат|итог|повлиял|привел|интерес|выгод|потер|правил|институт|полномоч|процедур)'
         )::int
  into chat_count,legal_hits,strategy_hits,analysis_chat_hits
  from public.chat_messages
  where game_id=p_game and author_id=p_user
    and created_at>=v_start and created_at<=v_end
    and (kind<>'text' or length(trim(coalesce(text,'')))>0);

  select count(*)::int,
         legal_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~
           '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int,
         strategy_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~
           '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|переговор)')::int
  into post_count,legal_hits,strategy_hits
  from public.political_posts
  where game_id=p_game and author_id=p_user
    and created_at>=v_start and created_at<=v_end;

  select count(*)::int,
         count(*) filter(where v.formal_document_id is not null)::int
  into ballot_count,formal_ballot_count
  from public.game_ballots b
  join public.game_votes v on v.id=b.vote_id
  where v.game_id=p_game and v.stage_no=p_stage and b.voter_id=p_user;

  select count(*)::int,
         legal_hits+count(*) filter(where lower(coalesce(d.title,'')||' '||coalesce(d.body_text,'')) ~
           '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int
  into formal_doc_count,legal_hits
  from public.formal_documents d
  where d.game_id=p_game and d.stage_no=p_stage and d.author_id=p_user;

  select count(*)::int into formal_action_count
  from public.formal_document_history h
  join public.formal_documents d on d.id=h.document_id
  where h.game_id=p_game and h.actor_id=p_user and d.stage_no=p_stage;

  select count(*)::int,
         strategy_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~
           '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|переговор)')::int,
         legal_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~
           '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int
  into player_action_count,strategy_hits,legal_hits
  from public.player_actions
  where game_id=p_game and round_no=p_stage and author_id=p_user;

  select count(*)::int into party_action_count
  from public.party_invitations
  where game_id=p_game and invited_by=p_user
    and created_at>=v_start and created_at<=v_end;

  select count(*)::int into decision_count
  from public.political_decisions d
  join public.political_posts p on p.id=d.post_id
  where d.game_id=p_game and p.author_id=p_user
    and d.created_at>=v_start and d.created_at<=v_end;

  select count(*)::int into activity_count
  from public.game_activity
  where game_id=p_game and actor_id=p_user
    and created_at>=v_start and created_at<=v_end
    and event_type not in ('navigation','presence');

  select count(*)::int,coalesce(max(body),'')
  into debrief_count,debrief_text
  from public.stage_debriefs
  where game_id=p_game and stage_no=p_stage and user_id=p_user;

  if length(trim(debrief_text))>=80 then
    debrief_categories :=
      (case when lower(debrief_text) ~ '(почему|потому|причин|обуслов|из-за)' then 1 else 0 end)+
      (case when lower(debrief_text) ~ '(последств|результат|итог|повлиял|привел|выиграл|проиграл|потер)' then 1 else 0 end)+
      (case when lower(debrief_text) ~ '(интерес|выгод|цель|стратег|ресурс|риск)' then 1 else 0 end)+
      (case when lower(debrief_text) ~ '(правил|институт|полномоч|норм|закон|процедур|кворум)' then 1 else 0 end);
  end if;

  participation:=chat_count+post_count+ballot_count+formal_doc_count+formal_action_count+
                 player_action_count+party_action_count+decision_count+activity_count+debrief_count;

  law_signal:=formal_doc_count*2+formal_action_count+formal_ballot_count*1.5+least(legal_hits,6)*0.5;
  strategy_signal:=post_count*0.75+ballot_count*0.5+player_action_count+decision_count*1.5+
                   formal_doc_count+party_action_count*0.75+least(strategy_hits,6)*0.4;

  c1:=law_signal>=2;
  c2:=strategy_signal>=2;
  c3:=(length(trim(debrief_text))>=80 and debrief_categories>=3) or analysis_chat_hits>=2;

  if participation=0 then score:=0;
  else score:=greatest(1,
    (case when c1 then 1 else 0 end)+
    (case when c2 then 1 else 0 end)+
    (case when c3 then 1 else 0 end));
  end if;

  rationale:=
    'Критерий 1 · право и правила: '||(case when c1 then 'зачтён' else 'пока не подтверждён' end)||
    '. НПА '||formal_doc_count||', процедурных действий '||formal_action_count||
    ', голосований по НПА '||formal_ballot_count||', правовых упоминаний '||legal_hits||'. '||
    'Критерий 2 · стратегия и интересы: '||(case when c2 then 'зачтён' else 'пока не подтверждён' end)||
    '. Публикаций '||post_count||', голосований '||ballot_count||
    ', действий/решений '||(player_action_count+decision_count)||', партийных действий '||party_action_count||'. '||
    'Критерий 3 · итоговый разбор: '||(case when c3 then 'зачтён' else 'пока не подтверждён' end)||
    '. Разбор '||(case when debrief_count>0 then 'представлен' else 'не представлен' end)||
    ', аналитических связок в обсуждении '||analysis_chat_hits||'. '||
    'Автооценка: '||score||'/3'||case score
      when 3 then ' — высокий уровень.'
      when 2 then ' — средний уровень.'
      when 1 then ' — низкий уровень.'
      else ' — участия на этапе не зафиксировано.' end;

  summary:=jsonb_build_object(
    'window',jsonb_build_object('from',v_start,'to',v_end),
    'counts',jsonb_build_object(
      'chat',chat_count,'posts',post_count,'ballots',ballot_count,
      'formal_documents',formal_doc_count,'formal_actions',formal_action_count,
      'player_actions',player_action_count,'party_actions',party_action_count,
      'accepted_decisions',decision_count,'meaningful_activity',activity_count,'debriefs',debrief_count
    ),
    'signals',jsonb_build_object(
      'law',law_signal,'strategy',strategy_signal,
      'legal_keyword_hits',legal_hits,'strategy_keyword_hits',strategy_hits,
      'analysis_chat_hits',analysis_chat_hits,'debrief_categories',debrief_categories
    )
  );

  if v_existing.id is null then
    insert into public.stage_assessments(
      game_id,stage_no,user_id,auto_score,status,
      criterion_law,criterion_strategy,criterion_debrief,
      public_rationale,evidence_summary,last_run_type,last_auto_at,revision_count
    ) values(
      p_game,p_stage,p_user,score,'draft',c1,c2,c3,
      rationale,summary,p_run_type,now(),1
    ) returning id into v_id;
  else
    update public.stage_assessments
    set auto_score=score,criterion_law=c1,criterion_strategy=c2,criterion_debrief=c3,
        public_rationale=rationale,evidence_summary=summary,last_run_type=p_run_type,
        last_auto_at=now(),revision_count=revision_count+1,updated_at=now()
    where id=v_existing.id
    returning id into v_id;
  end if;

  insert into public.stage_assessment_runs(
    assessment_id,game_id,stage_no,user_id,run_type,auto_score,
    criterion_law,criterion_strategy,criterion_debrief,rationale,evidence_summary
  ) values(v_id,p_game,p_stage,p_user,p_run_type,score,c1,c2,c3,rationale,summary);

  return v_id;
end;
$$;

create or replace function private.run_vsn_game(p_game uuid,p_run_type text default 'hourly')
returns integer
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare s record;m record;n int:=0;
begin
  for s in select stage_no from public.game_stages
    where game_id=p_game and stage_no between 1 and 16 and status in ('open','completed')
    order by stage_no
  loop
    for m in select user_id from public.game_members where game_id=p_game and kind='student'
    loop
      if not exists(
        select 1 from public.stage_assessments a
        where a.game_id=p_game and a.stage_no=s.stage_no
          and a.user_id=m.user_id and a.status='final'
      ) then
        perform private.compute_vsn_assessment(p_game,m.user_id,s.stage_no,p_run_type);
        n:=n+1;
      end if;
    end loop;
  end loop;
  return n;
end;
$$;

create or replace function private.run_vsn_all(p_run_type text default 'hourly')
returns integer
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare g record;n int:=0;
begin
  for g in select id from public.games where status<>'archived'
  loop
    n:=n+private.run_vsn_game(g.id,p_run_type);
  end loop;
  return n;
end;
$$;

create or replace function private.run_due_nightly_vsn()
returns integer
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare g record;n int:=0;tz text;today_local date;
begin
  for g in select id,settings from public.games where status<>'archived'
  loop
    tz:=coalesce(g.settings->>'evaluation_timezone','Asia/Barnaul');
    if not exists(select 1 from pg_timezone_names where name=tz) then tz:='UTC'; end if;
    today_local:=(now() at time zone tz)::date;
    if extract(hour from (now() at time zone tz))=3
       and not exists(
         select 1 from public.stage_assessment_runs r
         where r.game_id=g.id and r.run_type='nightly'
           and (r.created_at at time zone tz)::date=today_local
       )
    then n:=n+private.run_vsn_game(g.id,'nightly'); end if;
  end loop;
  return n;
end;
$$;

create or replace function public.submit_stage_debrief(
  p_game_id uuid,p_stage_no integer,p_body text
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;
begin
  if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
  if p_stage_no<1 or p_stage_no>16 then raise exception 'Only stages 1-16 are assessed'; end if;
  if length(trim(coalesce(p_body,'')))<40 then raise exception 'Debrief is too short'; end if;

  insert into public.stage_debriefs(game_id,stage_no,user_id,body)
  values(p_game_id,p_stage_no,v_uid,trim(p_body))
  on conflict(game_id,stage_no,user_id)
  do update set body=excluded.body,updated_at=now()
  returning id into v_id;

  perform private.compute_vsn_assessment(p_game_id,v_uid,p_stage_no,'debrief');
  return v_id;
end;
$$;
revoke all on function public.submit_stage_debrief(uuid,integer,text) from public,anon;
grant execute on function public.submit_stage_debrief(uuid,integer,text) to authenticated;

create or replace function public.recalculate_student_stage(
  p_game_id uuid,p_user_id uuid,p_stage_no integer
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
  if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
  if p_stage_no<1 or p_stage_no>16 then raise exception 'Stage must be 1-16'; end if;
  if not exists(
    select 1 from public.game_members
    where game_id=p_game_id and user_id=p_user_id and kind='student'
  ) then raise exception 'Student not found'; end if;
  return private.compute_vsn_assessment(p_game_id,p_user_id,p_stage_no,'manual');
end;
$$;
revoke all on function public.recalculate_student_stage(uuid,uuid,integer) from public,anon;
grant execute on function public.recalculate_student_stage(uuid,uuid,integer) to authenticated;

create or replace function public.recalculate_stage_assessment(p_assessment_id uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare a public.stage_assessments%rowtype;
begin
  select * into a from public.stage_assessments where id=p_assessment_id;
  if a.id is null then raise exception 'Assessment not found'; end if;
  if not private.is_game_teacher(a.game_id) then raise exception 'Teacher access required'; end if;
  if a.status='final' then raise exception 'Reopen the final assessment first'; end if;
  perform private.compute_vsn_assessment(a.game_id,a.user_id,a.stage_no,'manual');
end;
$$;
revoke all on function public.recalculate_stage_assessment(uuid) from public,anon;
grant execute on function public.recalculate_stage_assessment(uuid) to authenticated;

create or replace function public.finalize_stage_assessment(
  p_assessment_id uuid,p_score integer,p_teacher_note text default null
) returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare a public.stage_assessments%rowtype;v_uid uuid:=(select auth.uid());v_eval uuid;
begin
  if p_score<0 or p_score>3 then raise exception 'Score must be 0-3'; end if;
  select * into a from public.stage_assessments where id=p_assessment_id for update;
  if a.id is null then raise exception 'Assessment not found'; end if;
  if not private.is_game_teacher(a.game_id) then raise exception 'Teacher access required'; end if;

  update public.stage_assessments
  set final_score=p_score,status='final',
      teacher_note=nullif(trim(coalesce(p_teacher_note,'')),''),
      finalized_by=v_uid,finalized_at=now(),updated_at=now()
  where id=a.id;

  select id into v_eval from public.game_evaluations
  where game_id=a.game_id and stage_no=a.stage_no and user_id=a.user_id
  order by updated_at desc limit 1;

  if v_eval is null then
    insert into public.game_evaluations(game_id,stage_no,user_id,evaluator_id,score,note)
    values(a.game_id,a.stage_no,a.user_id,v_uid,p_score,
      coalesce(nullif(trim(coalesce(p_teacher_note,'')),''),a.public_rationale));
  else
    update public.game_evaluations
    set evaluator_id=v_uid,score=p_score,
        note=coalesce(nullif(trim(coalesce(p_teacher_note,'')),''),a.public_rationale),
        updated_at=now()
    where id=v_eval;
  end if;
end;
$$;
revoke all on function public.finalize_stage_assessment(uuid,integer,text) from public,anon;
grant execute on function public.finalize_stage_assessment(uuid,integer,text) to authenticated;

create or replace function public.reopen_stage_assessment(p_assessment_id uuid)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare a public.stage_assessments%rowtype;
begin
  select * into a from public.stage_assessments where id=p_assessment_id;
  if a.id is null then raise exception 'Assessment not found'; end if;
  if not private.is_game_teacher(a.game_id) then raise exception 'Teacher access required'; end if;
  update public.stage_assessments
  set status='draft',final_score=null,finalized_by=null,finalized_at=null,updated_at=now()
  where id=a.id;
  perform private.compute_vsn_assessment(a.game_id,a.user_id,a.stage_no,'manual');
end;
$$;
revoke all on function public.reopen_stage_assessment(uuid) from public,anon;
grant execute on function public.reopen_stage_assessment(uuid) to authenticated;

create or replace function public.set_evaluation_timezone(p_game_id uuid,p_timezone text)
returns void
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
  if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Unknown timezone'; end if;
  update public.games
  set settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{evaluation_timezone}',to_jsonb(p_timezone),true)
  where id=p_game_id;
end;
$$;
revoke all on function public.set_evaluation_timezone(uuid,text) from public,anon;
grant execute on function public.set_evaluation_timezone(uuid,text) to authenticated;

create or replace function private.vsn_stage_status_trigger()
returns trigger language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
  if new.stage_no between 1 and 16
     and new.status in ('open','completed')
     and old.status is distinct from new.status
  then
    perform private.run_vsn_game(
      new.game_id,case when new.status='completed' then 'stage_close' else 'manual' end
    );
  end if;
  return new;
end;
$$;
drop trigger if exists trg_vsn_stage_status on public.game_stages;
create trigger trg_vsn_stage_status
after update of status on public.game_stages
for each row execute function private.vsn_stage_status_trigger();

create or replace function private.vsn_new_student_trigger()
returns trigger language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare s record;
begin
  if new.kind='student' then
    for s in select stage_no from public.game_stages
      where game_id=new.game_id and stage_no between 1 and 16
        and status in ('open','completed')
      order by stage_no
    loop
      perform private.compute_vsn_assessment(new.game_id,new.user_id,s.stage_no,'manual');
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_vsn_new_student on public.game_members;
create trigger trg_vsn_new_student
after insert on public.game_members
for each row execute function private.vsn_new_student_trigger();
