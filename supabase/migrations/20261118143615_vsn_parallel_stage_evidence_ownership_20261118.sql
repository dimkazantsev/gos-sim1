-- Parallel stage ownership: preserve each stage's own activity period;
-- only explicitly stage-scoped actions may count in overlapping periods.
CREATE OR REPLACE FUNCTION private.vsn_stage_window(p_game uuid, p_stage integer)
 RETURNS TABLE(start_at timestamp with time zone, end_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select
    coalesce(
      s.opened_at,
      (select max(x.completed_at) from public.game_stages x where x.game_id=p_game and x.stage_no<p_stage and x.completed_at is not null),
      g.created_at
    ) as start_at,
    -- A different stage opening never closes this stage, because stages may run
    -- concurrently. Respect only this stage's own completion or score cutoff.
    least(coalesce(s.completed_at,now()),
      coalesce(s.score_closed_at,case when s.status='open' then s.deadline end,'infinity'::timestamptz)) as end_at
  from public.games g
  join public.game_stages s on s.game_id=g.id and s.stage_no=p_stage
  where g.id=p_game;
$function$
;

CREATE OR REPLACE FUNCTION private.compute_vsn_assessment(p_game uuid, p_user uuid, p_stage integer, p_run_type text DEFAULT 'hourly'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_start timestamptz; v_end timestamptz;
  v_unique tstzmultirange;
  v_overlap record;
  v_existing public.stage_assessments%rowtype; v_id uuid;
  chat_count int:=0; post_count int:=0; ballot_count int:=0;
  formal_doc_count int:=0; formal_action_count int:=0; formal_ballot_count int:=0;
  player_action_count int:=0; party_action_count int:=0; party_response_count int:=0;
  party_document_count int:=0; game_document_count int:=0;
  decision_count int:=0; activity_count int:=0; debrief_count int:=0;
  legal_hits int:=0; strategy_hits int:=0; analysis_chat_hits int:=0;
  debrief_categories int:=0; debrief_text text:='';
  participation int:=0; law_signal numeric:=0; strategy_signal numeric:=0;
  c1 boolean:=false; c2 boolean:=false; c3 boolean:=false;
  adjusted_score numeric;
  score numeric:=0; rationale text; summary jsonb;
  blitz_start integer; blitz_active boolean:=false; blitz_details jsonb:='{}'::jsonb; legal_component numeric:=0;
 event_law int:=0;event_invalid int:=0;event_strategy int:=0;
begin
  if p_stage<1 or p_stage>16 then raise exception 'Only stages 1-16 are assessed'; end if;

  select * into v_existing from public.stage_assessments
  where game_id=p_game and stage_no=p_stage and user_id=p_user for update;
  if v_existing.id is not null and v_existing.status='final' then return v_existing.id; end if;

  -- Once the teacher's scoring window has elapsed, hourly/manual recalculations
  -- may not award points for subsequent document completion or other activity.
  if exists(select 1 from public.game_stages s where s.game_id=p_game
     and s.stage_no=p_stage and s.score_closed_at is not null) then
    if v_existing.id is not null then return v_existing.id; end if;
    insert into public.stage_assessments(game_id,stage_no,user_id,auto_score,status,
      evidence_summary,last_run_type,last_auto_at)
    values(p_game,p_stage,p_user,0,'draft','{"scoring_closed":true}'::jsonb,p_run_type,now())
    returning id into v_id;
    return v_id;
  end if;

  select w.start_at,w.end_at into v_start,v_end from private.vsn_stage_window(p_game,p_stage) w;
  if v_start is null then v_start:=now()-interval '30 days'; end if;
  -- Unscoped interactions (general chat, party invitations and general
  -- activity) are usable only when exactly this stage was active.
  -- Stage-owned ballots, documents, acts, cases and debriefs always retain
  -- their own stage number even when stage windows overlap.
  v_end:=greatest(v_start,least(coalesce(v_end,clock_timestamp()),clock_timestamp()));
  v_unique:=tstzmultirange(tstzrange(v_start,v_end,'[)'));
  for v_overlap in
    select x.opened_at as from_at,
           least(coalesce(x.completed_at,clock_timestamp()),
             coalesce(x.score_closed_at,case when x.status='open' then x.deadline end,'infinity'::timestamptz),
             clock_timestamp()) as to_at
    from public.game_stages x
    where x.game_id=p_game and x.stage_no<>p_stage
      and x.status in ('open','completed') and x.opened_at is not null
      and x.opened_at<v_end
  loop
    if v_overlap.to_at>v_overlap.from_at then
      v_unique:=v_unique-tstzmultirange(tstzrange(v_overlap.from_at,v_overlap.to_at,'[)'));
    end if;
  end loop;

  select count(*)::int,
    count(*) filter(where lower(coalesce(text,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int,
    count(*) filter(where lower(coalesce(text,'')) ~ '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|голосуем|переговор)')::int,
    count(*) filter(where lower(coalesce(text,'')) ~ '(почему|потому|причин|обуслов|из-за)'
      and lower(coalesce(text,'')) ~ '(последств|результат|итог|повлиял|привел|интерес|выгод|потер|правил|институт|полномоч|процедур)')::int
  into chat_count,legal_hits,strategy_hits,analysis_chat_hits
  from public.chat_messages
  where game_id=p_game and author_id=p_user and created_at <@ v_unique
    and (kind<>'text' or length(trim(coalesce(text,'')))>0);

  select count(*)::int,
    legal_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int,
    strategy_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|переговор)')::int
  into post_count,legal_hits,strategy_hits
  from public.political_posts
  where game_id=p_game and author_id=p_user
    and (created_at <@ v_unique OR
      (context->>'stage_source'='explicit' and context->>'stage_no'=p_stage::text
       and created_at>=v_start and created_at<=v_end))
    and source_key is null and (context->>'automatic') is distinct from 'true';

  select count(*)::int,count(*) filter(where v.formal_document_id is not null)::int
  into ballot_count,formal_ballot_count
  from public.game_ballots b join public.game_votes v on v.id=b.vote_id
  where v.game_id=p_game and v.stage_no=p_stage and b.voter_id=p_user and b.created_at>=v_start and b.created_at<=v_end;

  select count(*)::int,
    legal_hits+count(*) filter(where lower(coalesce(d.title,'')||' '||coalesce(d.body_text,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int
  into formal_doc_count,legal_hits
  from public.formal_documents d
  where d.game_id=p_game and d.stage_no=p_stage and d.author_id=p_user and d.created_at>=v_start and d.created_at<=v_end
    and coalesce(d.metadata->>'registry_independent','false')<>'true';

  select count(*)::int into formal_action_count
  from public.formal_document_history h join public.formal_documents d on d.id=h.document_id
  where h.game_id=p_game and h.actor_id=p_user and d.stage_no=p_stage and h.created_at>=v_start and h.created_at<=v_end;

  select count(*)::int,
    strategy_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|переговор)')::int,
    legal_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int
  into player_action_count,strategy_hits,legal_hits
  from public.player_actions where game_id=p_game and round_no=p_stage and author_id=p_user
    and submitted_at>=v_start and submitted_at<=v_end;

  select count(*)::int,
    legal_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(конституц|закон|правов|норм|устав|положен|регламент|полномоч|процедур)')::int,
    strategy_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(стратег|интерес|цель|ресурс|риск|программ|план|предлага|коалиц|переговор)')::int
  into game_document_count,legal_hits,strategy_hits
  from public.game_documents
  where game_id=p_game and created_by=p_user and created_at <@ v_unique;

  select count(*)::int into party_document_count
  from public.party_documents
  where game_id=p_game and uploaded_by=p_user and created_at <@ v_unique;

  select count(*)::int into party_action_count
  from public.party_invitations
  where game_id=p_game and invited_by=p_user and created_at <@ v_unique;

  select count(*)::int into party_response_count
  from public.party_invitations
  where game_id=p_game and invited_user_id=p_user and responded_at is not null
    and responded_at <@ v_unique;

  select count(*)::int into decision_count
  from public.political_decisions d join public.political_posts p on p.id=d.post_id
  where d.game_id=p_game and p.author_id=p_user
    and (d.created_at <@ v_unique OR
      (p.context->>'stage_source'='explicit' and p.context->>'stage_no'=p_stage::text
       and d.created_at>=v_start and d.created_at<=v_end))
    and p.source_key is null and (p.context->>'automatic') is distinct from 'true';

  select count(*)::int into activity_count
  from public.game_activity ga
  where ga.game_id=p_game and ga.actor_id=p_user
    and (ga.created_at <@ v_unique
      or (ga.payload->>'stage_source'='explicit'
        and ga.payload->>'stage_no'=p_stage::text and ga.created_at>=v_start and ga.created_at<=v_end)
      or (ga.event_type='vote' and ga.created_at>=v_start and ga.created_at<=v_end
        and exists(select 1 from public.game_votes v
          where v.game_id=p_game and v.stage_no=p_stage
            and v.id::text=ga.payload->>'vote_id')))
    and ga.event_type not in ('navigation','presence');

  select count(*)::int,coalesce(max(body),'') into debrief_count,debrief_text
  from public.stage_debriefs where game_id=p_game and stage_no=p_stage and user_id=p_user;
  -- The debrief belongs to the completed stage and can legitimately be
  -- submitted within the one-hour post-completion window.

  if length(trim(debrief_text))>=80 then
    debrief_categories :=
      (case when lower(debrief_text) ~ '(почему|потому|причин|обуслов|из-за)' then 1 else 0 end)+
      (case when lower(debrief_text) ~ '(последств|результат|итог|повлиял|привел|выиграл|проиграл|потер)' then 1 else 0 end)+
      (case when lower(debrief_text) ~ '(интерес|выгод|цель|стратег|ресурс|риск)' then 1 else 0 end)+
      (case when lower(debrief_text) ~ '(правил|институт|полномоч|норм|закон|процедур|кворум)' then 1 else 0 end);
  end if;

  participation:=chat_count+post_count+ballot_count+formal_doc_count+formal_action_count+
    player_action_count+party_action_count+party_response_count+party_document_count+
    game_document_count+decision_count+activity_count+debrief_count;

  law_signal:=formal_doc_count*2+formal_action_count+formal_ballot_count*1.5+
    game_document_count*0.7+party_document_count*0.8+least(legal_hits,8)*0.5;
  strategy_signal:=post_count*0.75+ballot_count*0.5+player_action_count+decision_count*1.5+
    formal_doc_count+game_document_count*0.8+party_document_count*0.7+
    party_action_count*0.75+party_response_count*0.35+least(strategy_hits,8)*0.4;

  select count(*) filter(where authority_ok and lawful),count(*) filter(where not authority_ok or not lawful),count(*) filter(where strategy_point)
  into event_law,event_invalid,event_strategy from public.event_authority_evidence where game_id=p_game and actor_id=p_user and stage_no=p_stage and created_at>=v_start and created_at<=v_end;
  participation:=participation+event_law+event_invalid;
  c1:=(law_signal>=2 or event_law>0) and event_invalid=0;
  c2:=strategy_signal>=2 or event_strategy>0;
  c3:=(length(trim(debrief_text))>=80 and debrief_categories>=3) or analysis_chat_hits>=2;

  if participation=0 then score:=0;
  else score:=greatest(1,(case when c1 then 1 else 0 end)+(case when c2 then 1 else 0 end)+(case when c3 then 1 else 0 end)); end if;

  -- Only opt-in stages use the verified legal-knowledge rubric.
  -- Older stages and final teacher scores remain untouched.
  select case when g.settings->>'blitz_vsn_from_stage' ~ '^(1[0-6]|[1-9])$'
         then (g.settings->>'blitz_vsn_from_stage')::integer else null end
    into blitz_start from public.games g where g.id=p_game;
  blitz_active:=blitz_start is not null and p_stage>=blitz_start;
  if blitz_active then
    blitz_details:=private.blitz_vsn_components(p_game,p_user,p_stage);
    legal_component:=greatest(0,least(1,coalesce((blitz_details->>'score')::numeric,0)));
    c1:=legal_component=1;
    score:=round(least(3,legal_component+(case when c2 then 1 else 0 end)+(case when c3 then 1 else 0 end)),2);
  end if;

  rationale:=
    'Критерий 1 · право и правила: '||(case when c1 then 'зачтён' else 'пока не подтверждён' end)||
    '. НПА '||formal_doc_count||', процедурных действий '||formal_action_count||
    ', голосований по НПА '||formal_ballot_count||', партийных документов '||party_document_count||
    ', иных документов '||game_document_count||', правовых упоминаний '||legal_hits||'. '||
    'Критерий 2 · стратегия и интересы: '||(case when c2 then 'зачтён' else 'пока не подтверждён' end)||
    '. Публикаций '||post_count||', голосований '||ballot_count||
    ', действий/решений '||(player_action_count+decision_count)||', партийных инициатив '||party_action_count||
    ', ответов на партийные приглашения '||party_response_count||'. '||
    'Критерий 3 · итоговый разбор: '||(case when c3 then 'зачтён' else 'пока не подтверждён' end)||
    '. Разбор '||(case when debrief_count>0 then 'представлен' else 'не представлен' end)||
    ', аналитических связок в обсуждении '||analysis_chat_hits||'. '||
    'Автооценка: '||score||'/3'||case score when 3 then ' — высокий уровень.' when 2 then ' — средний уровень.' when 1 then ' — низкий уровень.' else ' — участия на этапе не зафиксировано.' end;

  if blitz_active then
    rationale:=rationale||E'\nБлиц и правовые знания: '||legal_component||'/1. Максимум: кейсы 0,30; действия 0,30; правильность блица 0,30; полнота 0,10. Итоговый автоматический расчёт: '||score||'/3.';
  end if;
  summary:=jsonb_build_object(
    'window',jsonb_build_object('from',v_start,'to',v_end),
    'counts',jsonb_build_object(
      'chat',chat_count,'posts',post_count,'ballots',ballot_count,
      'formal_documents',formal_doc_count,'formal_actions',formal_action_count,
      'player_actions',player_action_count,'party_invitations_sent',party_action_count,
      'party_invitation_responses',party_response_count,'party_documents',party_document_count,
      'game_documents',game_document_count,'accepted_decisions',decision_count,
      'meaningful_activity',activity_count,'debriefs',debrief_count
    ),
    'signals',jsonb_build_object(
      'law',law_signal,'strategy',strategy_signal,'legal_keyword_hits',legal_hits,
      'strategy_keyword_hits',strategy_hits,'analysis_chat_hits',analysis_chat_hits,
      'debrief_categories',debrief_categories
    )
  );

  if blitz_active then
    summary:=summary||jsonb_build_object('blitz_vsn',blitz_details,'legal_component',legal_component,'blitz_vsn_from_stage',blitz_start);
  end if;
  if v_existing.id is null then
    insert into public.stage_assessments(
      game_id,stage_no,user_id,auto_score,status,criterion_law,criterion_strategy,criterion_debrief,
      public_rationale,evidence_summary,last_run_type,last_auto_at,revision_count
    ) values(p_game,p_stage,p_user,score,'draft',c1,c2,c3,rationale,summary,p_run_type,now(),1)
    returning id into v_id;
  else
    update public.stage_assessments
    set auto_score=score,criterion_law=c1,criterion_strategy=c2,criterion_debrief=c3,
      public_rationale=rationale,evidence_summary=summary,last_run_type=p_run_type,
      last_auto_at=now(),revision_count=revision_count+1,updated_at=now()
    where id=v_existing.id returning id into v_id;
  end if;

  -- Journal the stored score and evidence after the deadline trigger.
  select auto_score,evidence_summary into adjusted_score,summary from public.stage_assessments where id=v_id;

  insert into public.stage_assessment_runs(
    assessment_id,game_id,stage_no,user_id,run_type,auto_score,
    criterion_law,criterion_strategy,criterion_debrief,rationale,evidence_summary
  ) values(v_id,p_game,p_stage,p_user,p_run_type,adjusted_score,c1,c2,c3,rationale,summary);

  update public.stage_assessments set evidence_summary=evidence_summary||jsonb_build_object('event_authority',jsonb_build_object('valid',event_law,'invalid',event_invalid,'strategy',event_strategy)), public_rationale=public_rationale||E'\nСобытия: правомерных решений в пределах полномочий '||event_law||', нарушений '||event_invalid||'. Правовой критерий: '||case when blitz_active then legal_component::text||' балла из 1' else case when c1 then '1 балл' else '0 баллов' end end||'.' where id=v_id;
  return v_id;
end;
$function$
;
