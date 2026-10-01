-- Generated process updates are public records; only original student work contributes to VSN.
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
  score int:=0; rationale text; summary jsonb;
 event_law int:=0;event_invalid int:=0;event_strategy int:=0;
begin
  if p_stage<1 or p_stage>16 then raise exception 'Only stages 1-16 are assessed'; end if;

  select * into v_existing from public.stage_assessments
  where game_id=p_game and stage_no=p_stage and user_id=p_user for update;
  if v_existing.id is not null and v_existing.status='final' then return v_existing.id; end if;

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
  where v.game_id=p_game and v.stage_no=p_stage and b.voter_id=p_user;

  select count(*)::int,
    legal_hits+count(*) filter(where lower(coalesce(d.title,'')||' '||coalesce(d.body_text,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int
  into formal_doc_count,legal_hits
  from public.formal_documents d
  where d.game_id=p_game and d.stage_no=p_stage and d.author_id=p_user;

  select count(*)::int into formal_action_count
  from public.formal_document_history h join public.formal_documents d on d.id=h.document_id
  where h.game_id=p_game and h.actor_id=p_user and d.stage_no=p_stage;

  select count(*)::int,
    strategy_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(предлага|договор|согласу|стратег|интерес|выгод|риск|ресурс|цель|коалиц|поддерж|переговор)')::int,
    legal_hits+count(*) filter(where lower(coalesce(title,'')||' '||coalesce(body,'')) ~ '(конституц|закон|фз|фкз|стать[яьи]|правов|норм[аы]|полномоч|компетенц|регламент|кворум|процедур|устав)')::int
  into player_action_count,strategy_hits,legal_hits
  from public.player_actions where game_id=p_game and round_no=p_stage and author_id=p_user;

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
  from public.stage_debriefs where game_id=p_game and stage_no=p_stage and user_id=p_user;

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
  into event_law,event_invalid,event_strategy from public.event_authority_evidence where game_id=p_game and actor_id=p_user and stage_no=p_stage;
  participation:=participation+event_law+event_invalid;
  c1:=(law_signal>=2 or event_law>0) and event_invalid=0;
  c2:=strategy_signal>=2 or event_strategy>0;
  c3:=(length(trim(debrief_text))>=80 and debrief_categories>=3) or analysis_chat_hits>=2;

  if participation=0 then score:=0;
  else score:=greatest(1,(case when c1 then 1 else 0 end)+(case when c2 then 1 else 0 end)+(case when c3 then 1 else 0 end)); end if;

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

  insert into public.stage_assessment_runs(
    assessment_id,game_id,stage_no,user_id,run_type,auto_score,
    criterion_law,criterion_strategy,criterion_debrief,rationale,evidence_summary
  ) values(v_id,p_game,p_stage,p_user,p_run_type,score,c1,c2,c3,rationale,summary);

  update public.stage_assessments set evidence_summary=evidence_summary||jsonb_build_object('event_authority',jsonb_build_object('valid',event_law,'invalid',event_invalid,'strategy',event_strategy)), public_rationale=public_rationale||E'\nСобытия: правомерных решений в пределах полномочий '||event_law||', нарушений '||event_invalid||'. Правовой критерий: '||case when c1 then '1 балл' else '0 баллов' end||'.' where id=v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_stage_assessment_evidence(p_game_id uuid, p_user_id uuid, p_stage_no integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid:=(select auth.uid());
  v_start timestamptz; v_end timestamptz; out_json jsonb;
begin
  if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
  if p_stage_no<1 or p_stage_no>16 then raise exception 'Stage must be 1-16'; end if;
  if v_uid<>p_user_id and not private.is_game_teacher(p_game_id) then
    raise exception 'Detailed evidence is available only to the student and teacher';
  end if;
  select w.start_at,w.end_at into v_start,v_end from private.vsn_stage_window(p_game_id,p_stage_no) w;

  select jsonb_build_object(
    'window',jsonb_build_object('from',v_start,'to',v_end),
    'chat',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'created_at',m.created_at,'channel',c.name,'kind',m.kind,'text',m.text,
      'mime_type',m.mime_type,'storage_path',m.storage_path) order by m.created_at)
      from public.chat_messages m left join public.chat_channels c on c.id=m.channel_id
      where m.game_id=p_game_id and m.author_id=p_user_id and m.created_at>=v_start and m.created_at<=v_end),'[]'::jsonb),
    'political_posts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'created_at',p.created_at,'title',p.title,'body',p.body,'actor_label',p.actor_label,'status',p.status,'tags',p.tags) order by p.created_at)
      from public.political_posts p where p.game_id=p_game_id and p.author_id=p_user_id and p.created_at>=v_start and p.created_at<=v_end
        and p.source_key is null and (p.context->>'automatic') is distinct from 'true'),'[]'::jsonb),
    'ballots',coalesce((select jsonb_agg(jsonb_build_object(
      'vote_id',v.id,'title',v.title,'choice',b.choice,'weight',b.weight,'created_at',b.created_at,'formal_document_id',v.formal_document_id) order by b.created_at)
      from public.game_ballots b join public.game_votes v on v.id=b.vote_id
      where v.game_id=p_game_id and v.stage_no=p_stage_no and b.voter_id=p_user_id),'[]'::jsonb),
    'formal_documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'registry_no',d.registry_no,'title',d.title,'doc_type',d.doc_type,'body_text',d.body_text,'status',d.status_label,'created_at',d.created_at) order by d.created_at)
      from public.formal_documents d where d.game_id=p_game_id and d.stage_no=p_stage_no and d.author_id=p_user_id),'[]'::jsonb),
    'formal_actions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',h.id,'document_id',h.document_id,'action',h.action,'from_status',h.from_status,'to_status',h.to_status,'note',h.note,'created_at',h.created_at) order by h.created_at)
      from public.formal_document_history h join public.formal_documents d on d.id=h.document_id
      where h.game_id=p_game_id and h.actor_id=p_user_id and d.stage_no=p_stage_no),'[]'::jsonb),
    'actions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'action_type',a.action_type,'title',a.title,'body',a.body,'budget',a.budget,'status',a.status,'teacher_feedback',a.teacher_feedback,'submitted_at',a.submitted_at) order by a.submitted_at)
      from public.player_actions a where a.game_id=p_game_id and a.round_no=p_stage_no and a.author_id=p_user_id),'[]'::jsonb),
    'game_documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'title',d.title,'doc_type',d.doc_type,'body',d.body,'created_at',d.created_at) order by d.created_at)
      from public.game_documents d where d.game_id=p_game_id and d.created_by=p_user_id and d.created_at>=v_start and d.created_at<=v_end),'[]'::jsonb),
    'party_documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'party_id',d.party_id,'doc_kind',d.doc_kind,'title',d.title,'file_name',d.file_name,'status',d.status,'note',d.note,'created_at',d.created_at) order by d.created_at)
      from public.party_documents d where d.game_id=p_game_id and d.uploaded_by=p_user_id and d.created_at>=v_start and d.created_at<=v_end),'[]'::jsonb),
    'party_actions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'party_id',i.party_id,'invited_user_id',i.invited_user_id,'invited_by',i.invited_by,
      'status',i.status,'created_at',i.created_at,'responded_at',i.responded_at,
      'role',case when i.invited_by=p_user_id then 'inviter' else 'invitee' end) order by coalesce(i.responded_at,i.created_at))
      from public.party_invitations i where i.game_id=p_game_id
        and ((i.invited_by=p_user_id and i.created_at>=v_start and i.created_at<=v_end)
          or (i.invited_user_id=p_user_id and i.responded_at>=v_start and i.responded_at<=v_end))),'[]'::jsonb),
    'debrief',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'body',d.body,'created_at',d.created_at,'updated_at',d.updated_at))
      from public.stage_debriefs d where d.game_id=p_game_id and d.stage_no=p_stage_no and d.user_id=p_user_id),'[]'::jsonb),
    'activity',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'event_type',a.event_type,'label',a.label,'view_key',a.view_key,'created_at',a.created_at) order by a.created_at)
      from public.game_activity a where a.game_id=p_game_id and a.actor_id=p_user_id
        and a.created_at>=v_start and a.created_at<=v_end and a.event_type not in ('navigation','presence')),'[]'::jsonb)
  ) into out_json;
  return out_json;
end;
$function$;

