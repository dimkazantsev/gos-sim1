-- Timed scoring finishes at the original teacher deadline.
-- Administrative auto-extension keeps the stage open for unfinished official paperwork.
ALTER TABLE public.game_stages ADD COLUMN IF NOT EXISTS score_closed_at timestamptz;
COMMENT ON COLUMN public.game_stages.score_closed_at IS
 'Неизменный оценочный срок после автоматического истечения; автоматическое продление документов баллы не возобновляет.';
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
    least(coalesce(
      s.completed_at,
      (select min(x.opened_at) from public.game_stages x where x.game_id=p_game and x.stage_no>p_stage and x.opened_at is not null),
      now()
    ),coalesce(s.score_closed_at,case when s.status='open' then s.deadline end,'infinity'::timestamptz)) as end_at
  from public.games g
  join public.game_stages s on s.game_id=g.id and s.stage_no=p_stage
  where g.id=p_game;
$function$;

CREATE OR REPLACE FUNCTION private.compute_vsn_assessment(p_game uuid, p_user uuid, p_stage integer, p_run_type text DEFAULT 'hourly'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_start timestamptz; v_end timestamptz;
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
  if v_end is null or v_end<v_start then v_end:=now(); end if;

  select count(*)::int,
    count(*) filter(where lower(coalesce(text,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int,
    count(*) filter(where lower(coalesce(text,'')) ~ '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|голосуем|переговор)')::int,
    count(*) filter(where lower(coalesce(text,'')) ~ '(почему|потому|причин|обуслов|из-за)'
      and lower(coalesce(text,'')) ~ '(последств|результат|итог|повлиял|привел|интерес|выгод|потер|правил|институт|полномоч|процедур)')::int
  into chat_count,legal_hits,strategy_hits,analysis_chat_hits
  from public.chat_messages
  where game_id=p_game and author_id=p_user and created_at>=v_start and created_at<=v_end
    and (kind<>'text' or length(trim(coalesce(text,'')))>0);

  select count(*)::int,
    legal_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int,
    strategy_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|переговор)')::int
  into post_count,legal_hits,strategy_hits
  from public.political_posts
  where game_id=p_game and author_id=p_user and created_at>=v_start and created_at<=v_end
    and source_key is null and (context->>'automatic') is distinct from 'true';

  select count(*)::int,count(*) filter(where v.formal_document_id is not null)::int
  into ballot_count,formal_ballot_count
  from public.game_ballots b join public.game_votes v on v.id=b.vote_id
  where v.game_id=p_game and v.stage_no=p_stage and b.voter_id=p_user and b.created_at>=v_start and b.created_at<=v_end;

  select count(*)::int,
    legal_hits+count(*) filter(where lower(coalesce(d.title,'')||' '||coalesce(d.body_text,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int
  into formal_doc_count,legal_hits
  from public.formal_documents d
  where d.game_id=p_game and d.stage_no=p_stage and d.author_id=p_user and d.created_at>=v_start and d.created_at<=v_end;

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
  where game_id=p_game and created_by=p_user and created_at>=v_start and created_at<=v_end;

  select count(*)::int into party_document_count
  from public.party_documents
  where game_id=p_game and uploaded_by=p_user and created_at>=v_start and created_at<=v_end;

  select count(*)::int into party_action_count
  from public.party_invitations
  where game_id=p_game and invited_by=p_user and created_at>=v_start and created_at<=v_end;

  select count(*)::int into party_response_count
  from public.party_invitations
  where game_id=p_game and invited_user_id=p_user and responded_at is not null
    and responded_at>=v_start and responded_at<=v_end;

  select count(*)::int into decision_count
  from public.political_decisions d join public.political_posts p on p.id=d.post_id
  where d.game_id=p_game and p.author_id=p_user and d.created_at>=v_start and d.created_at<=v_end
    and p.source_key is null and (p.context->>'automatic') is distinct from 'true';

  select count(*)::int into activity_count
  from public.game_activity
  where game_id=p_game and actor_id=p_user and created_at>=v_start and created_at<=v_end
    and event_type not in ('navigation','presence');

  select count(*)::int,coalesce(max(body),'') into debrief_count,debrief_text
  from public.stage_debriefs where game_id=p_game and stage_no=p_stage and user_id=p_user
    and created_at>=v_start and created_at<=v_end;

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
$function$;

CREATE OR REPLACE FUNCTION private.blitz_vsn_components(p_game uuid, p_student uuid, p_stage integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_deadline timestamptz;total_q int; correct_q int; answered_q int; cases_n int; correct_cases numeric; acts int; c numeric; a numeric; b numeric; completion numeric;
begin
 select case when s.score_closed_at is not null or s.status='open' then coalesce(s.score_closed_at,s.deadline,clock_timestamp()) else coalesce(s.completed_at,clock_timestamp()) end into v_deadline from public.game_stages s where s.game_id=p_game and s.stage_no=p_stage;
 v_deadline:=least(coalesce(v_deadline,clock_timestamp()),clock_timestamp());
 select count(*),count(*) filter(where is_correct and answered_at<=v_deadline),count(*) filter(where chosen_index is not null and answered_at<=v_deadline)
 into total_q,correct_q,answered_q from public.blitz_assignments where game_id=p_game and user_id=p_student and stage_no=p_stage and available_at<=v_deadline;
 select count(*)::integer,coalesce(sum(e.score_share) filter(where e.best_option and e.authority_ok and e.lawful),0)
 into cases_n,correct_cases from public.event_authority_evidence e
 where e.game_id=p_game and e.actor_id=p_student and e.stage_no=p_stage and e.created_at<=v_deadline;
 select count(*) into acts from public.player_actions where game_id=p_game and author_id=p_student and round_no=p_stage and status='accepted' and submitted_at<=v_deadline;
 c:=case when cases_n>0 then 0.30*least(1,correct_cases::numeric/cases_n) else 0 end;
 a:=0.30*least(1,acts::numeric/3);
 b:=case when total_q>0 then 0.30*correct_q::numeric/total_q else 0 end;
 completion:=case when total_q>0 then 0.10*answered_q::numeric/total_q else 0 end;
 return jsonb_build_object('score',round(c+a+b+completion,2),'cases',round(c,2),'actions',round(a,2),'blitz',round(b,2),'completion',round(completion,2),'cases_total',cases_n,'cases_right',correct_cases,'actions_right',acts,'quiz_total',total_q,'quiz_right',correct_q,'quiz_answered',answered_q);
end $function$;


CREATE OR REPLACE FUNCTION private.stage_assessment_deadline_penalty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_penalty numeric:=0;
  v_document_penalty numeric:=0;
begin
  select coalesce(sum(i.penalty_points),0)
    into v_penalty
  from public.stage_deadline_incidents i
  where i.game_id=new.game_id
    and i.stage_no=new.stage_no
    and i.user_id=new.user_id
    and i.status='active';

  v_document_penalty:=private.stage_document_penalty_points(new.game_id,new.user_id,new.stage_no);
  -- Persist the gross score separately: a later document publication must restore
  -- only the already earned point, never re-assess late actions.
  new.evidence_summary:=coalesce(new.evidence_summary,'{}'::jsonb)
    || jsonb_build_object('unpenalized_auto_score',least(3,new.auto_score));
  new.auto_score:=greatest(0,least(3,new.auto_score-v_penalty-v_document_penalty));
  new.evidence_summary:=coalesce(new.evidence_summary,'{}'::jsonb)
    || jsonb_build_object('deadline_penalty_points',v_penalty,'final_document_penalty_points',v_document_penalty);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.refresh_grade_after_final_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE person record;
BEGIN
 IF NEW.status_code <> 'published'
   AND NOT (NEW.stage_no=10 AND NEW.status_code IN ('draft','submitted','under_review','review'))
 THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=NEW.game_id
   AND s.stage_no=NEW.stage_no AND s.status='completed') THEN RETURN NEW; END IF;
 FOR person IN
   SELECT DISTINCT a.user_id
   FROM public.stage_final_document_obligations o
   JOIN public.stage_assessments a
     ON a.game_id=o.game_id AND a.stage_no=o.stage_no AND a.user_id=o.user_id
   WHERE o.game_id=NEW.game_id AND o.stage_no=NEW.stage_no AND a.status='draft'
     AND coalesce((a.evidence_summary->>'final_document_penalty_points')::numeric,0)>0
     AND private.stage_document_penalty_points(NEW.game_id,a.user_id,NEW.stage_no)=0
 LOOP
   IF EXISTS(SELECT 1 FROM public.game_stages s WHERE s.game_id=NEW.game_id
       AND s.stage_no=NEW.stage_no AND s.score_closed_at IS NOT NULL) THEN
     UPDATE public.stage_assessments a
     SET auto_score=coalesce((a.evidence_summary->>'unpenalized_auto_score')::numeric,
       least(3,a.auto_score+coalesce((a.evidence_summary->>'deadline_penalty_points')::numeric,0)
       +coalesce((a.evidence_summary->>'final_document_penalty_points')::numeric,0))),
       updated_at=clock_timestamp()
     WHERE a.game_id=NEW.game_id AND a.stage_no=NEW.stage_no
       AND a.user_id=person.user_id AND a.status='draft';
   ELSE
     PERFORM private.compute_vsn_assessment(NEW.game_id,person.user_id,NEW.stage_no,'manual');
   END IF;
 END LOOP;
 RETURN NEW;
END;$function$;

CREATE OR REPLACE FUNCTION public.close_expired_game_stages()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare g uuid;n integer:=0;v_total integer;v_extended integer;v_open integer;v_earliest timestamptz;v_next integer;v_stage record;v_member record;
begin
 for g in select distinct game_id from public.game_stages
  where status='open' and deadline is not null and deadline<=clock_timestamp() loop
  perform pg_advisory_xact_lock(hashtextextended('stage-control:'||g,0));
  -- Snapshot existing VSN scores at the original deadline exactly once.
  -- Unfinished documentary obligations extend *work*, never the scoring window.
  for v_stage in select stage_no,deadline from public.game_stages
    where game_id=g and status='open' and score_closed_at is null
      and deadline is not null and deadline<=clock_timestamp() order by stage_no
  loop
    for v_member in select user_id from public.game_members
      where game_id=g and kind='student' and roster_archived_at is null
    loop
      perform private.compute_vsn_assessment(g,v_member.user_id,v_stage.stage_no,'stage_close');
    end loop;
    update public.game_stages set score_closed_at=v_stage.deadline
      where game_id=g and stage_no=v_stage.stage_no and status='open'
        and score_closed_at is null;
  end loop;
  -- Any unready stage (1-16) stays open for authorised document preparation.
  -- The transaction holds the same game-level advisory lock as manage_game_stage.
  v_extended:=0;
  for v_stage in select stage_no from public.game_stages
    where game_id=g and status='open' and deadline is not null
      and deadline<=clock_timestamp()
    order by stage_no loop
    if not coalesce((private.stage_readiness_json(g,v_stage.stage_no)->>'ready')::boolean,false) then
      update public.game_stages set deadline=clock_timestamp()+interval '30 minutes'
       where game_id=g and stage_no=v_stage.stage_no and status='open';
      -- Never overwrite the teacher's actual scoring deadline rule.
      v_extended:=v_extended+1;
    end if;
  end loop;
  update public.game_stages set status='completed',completed_at=clock_timestamp()
  where game_id=g and status='open' and deadline is not null and deadline<=clock_timestamp();
  get diagnostics v_total=row_count;n:=n+v_total;
  if v_total>0 or v_extended>0 then
   select count(*),min(deadline) into v_open,v_earliest from public.game_stages where game_id=g and status='open';
   select stage_no into v_next from public.game_stages where game_id=g and status='open' order by deadline nulls last,stage_no limit 1;
   update public.games set current_round=greatest(current_round,coalesce(v_next,current_round)),
    turn_open=v_open>0,turn_ends_at=case when v_open>0 then v_earliest else null end,
    status=case when v_open>0 then 'running' else 'paused' end where id=g;
  end if;
 end loop;
 return n;
end $function$;

CREATE OR REPLACE FUNCTION public.reset_game_stage_progress(p_game_id uuid, p_stage_no integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_count integer := 0;
  v_game_round integer;
  v_was_open boolean := false;
  v_target_id uuid;
begin
  if p_game_id is null or not private.is_game_teacher(p_game_id) then
    raise exception 'Teacher access required';
  end if;
  if p_stage_no is not null and (p_stage_no < 1 or p_stage_no > 16) then
    raise exception 'Stage must be between 1 and 16';
  end if;

  select current_round into v_game_round
    from public.games where id = p_game_id for update;
  if not found then raise exception 'Game does not exist'; end if;

  if p_stage_no is null then
    -- Clear only the lifecycle of the 16 stages, not student submissions or grades.
    update public.game_stages
      set status = 'locked', opened_at = null, completed_at = null, deadline = null,
          score_closed_at = null
      where game_id = p_game_id;
    get diagnostics v_count = row_count;
    delete from public.stage_deadline_rules where game_id = p_game_id;
    update public.games set current_round = 1, turn_open = false,
      turn_ends_at = null, status = 'paused'
      where id = p_game_id;
  else
    select id, status = 'open' into v_target_id, v_was_open
      from public.game_stages
      where game_id = p_game_id and stage_no = p_stage_no
      for update;
    if not found then raise exception 'Stage does not exist'; end if;
    update public.game_stages
      set status = 'locked', opened_at = null, completed_at = null, deadline = null
      where id = v_target_id;
    get diagnostics v_count = row_count;
    delete from public.stage_deadline_rules where game_id = p_game_id and stage_no = p_stage_no;
    -- Pause only if the currently running stage was reset.
    if v_was_open and v_game_round = p_stage_no then
      update public.games set turn_open = false, turn_ends_at = null,
        status = 'paused'
        where id = p_game_id;
    end if;
  end if;

  insert into public.audit_log(game_id,actor_id,action,entity_type,entity_id,payload)
  values (
    p_game_id, auth.uid(),
    case when p_stage_no is null then 'all_stage_progress_reset' else 'stage_progress_reset' end,
    'game_stages',v_target_id,
    jsonb_build_object('stage_no',p_stage_no,'affected_stages',v_count,'preserves_work',true)
  );
  return v_count;
end;
$function$;


CREATE OR REPLACE FUNCTION public.manage_game_stage(p_game_id uuid, p_stage_no integer, p_action text, p_minutes integer DEFAULT 30)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare s public.game_stages%rowtype;v_deadline timestamptz;v_next integer;v_earliest timestamptz;v_count integer;v_member record;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required' using errcode='42501';end if;
 if p_stage_no not between 1 and 16 or p_action not in ('open','close','extend') then
  raise exception 'Invalid stage operation' using errcode='22023';end if;
 if p_action in ('open','extend') and (p_minutes is null or p_minutes<1 or p_minutes>43200) then
  raise exception 'Duration must be 1–43200 minutes' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('stage-control:'||p_game_id,0));
 select * into s from public.game_stages where game_id=p_game_id and stage_no=p_stage_no for update;
 if not found then raise exception 'Stage not found' using errcode='P0002';end if;
 if p_action='close' then
  if s.status<>'open' then raise exception 'Stage is not open' using errcode='22023';end if;
  if p_stage_no=4
    and not coalesce((private.stage_readiness_json(p_game_id,4)->>'ready')::boolean,false)
  then raise exception 'Нельзя завершить этап 4: сначала изберите руководство и председателей пяти комитетов, распределите депутатов и завершите обязательные процедуры' using errcode='23514';end if;
  update public.game_stages set status='completed',completed_at=clock_timestamp() where id=s.id;
 elsif p_action='open' then
  if s.status='open' then raise exception 'Stage is already open' using errcode='22023';end if;
  v_deadline:=case when s.deadline>clock_timestamp() then s.deadline
   else clock_timestamp()+make_interval(mins=>p_minutes) end;
  update public.game_stages set status='open',
   opened_at=clock_timestamp(),completed_at=null,deadline=v_deadline where id=s.id;
 elsif p_action='extend' then
  if s.status<>'open' then raise exception 'Only open stages can be extended' using errcode='22023';end if;
  -- A teacher extension after expiration must not undo the elapsed score cutoff.
  if s.deadline is not null and s.deadline<=clock_timestamp() and s.score_closed_at is null then
    for v_member in select user_id from public.game_members
      where game_id=p_game_id and kind='student' and roster_archived_at is null
    loop
      perform private.compute_vsn_assessment(p_game_id,v_member.user_id,p_stage_no,'stage_close');
    end loop;
    update public.game_stages set score_closed_at=s.deadline where id=s.id
      and score_closed_at is null;
  end if;
  v_deadline:=greatest(coalesce(s.deadline,clock_timestamp()),clock_timestamp())+make_interval(mins=>p_minutes);
  update public.game_stages set deadline=v_deadline where id=s.id;
 end if;
 if p_action in ('open','extend') then
  update public.stage_deadline_rules set deadline_at=v_deadline,updated_by=auth.uid(),updated_at=clock_timestamp()
  where game_id=p_game_id and stage_no=p_stage_no;
 end if;
 select count(*),min(deadline) into v_count,v_earliest
 from public.game_stages where game_id=p_game_id and status='open';
 select stage_no into v_next from public.game_stages
 where game_id=p_game_id and status='open' order by deadline nulls last,stage_no limit 1;
 update public.games set
  current_round=greatest(current_round,coalesce(v_next,current_round)),
  turn_open=v_count>0,
  turn_ends_at=case when v_count>0 then v_earliest else null end,
  status=case when v_count>0 then 'running' else 'paused' end
 where id=p_game_id;
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(p_game_id,auth.uid(),'manage_game_stage','game_stages',
  jsonb_build_object('stage_no',p_stage_no,'operation',p_action,'minutes',p_minutes,'deadline',v_deadline));
end $function$;
