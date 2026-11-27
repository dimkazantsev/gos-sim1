-- Candidate step 2 only. Never apply independently of the full Events V2 release.
-- No existing cases are marked V2 here, no historical rows are changed.
ALTER TABLE public.event_collaboration_invites ADD COLUMN transfer_stage_no integer CHECK (transfer_stage_no BETWEEN 1 AND 16);
CREATE UNIQUE INDEX event_v2_one_accepted_transfer ON public.event_collaboration_invites(case_id) WHERE transfer_stage_no IS NOT NULL;
CREATE INDEX event_v2_transfer_credit ON public.event_collaboration_invites(game_id,inviter_id,transfer_stage_no,responded_at) WHERE transfer_stage_no IS NOT NULL AND status='accepted';
CREATE OR REPLACE FUNCTION private.event_v2_competent(p_case uuid,p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.event_cases c JOIN public.game_members m ON m.game_id=c.game_id AND m.user_id=p_user AND m.kind='student' AND m.roster_archived_at IS NULL
 WHERE c.id=p_case AND c.audience='single' AND c.effect_plan->>'rules_version'='2' AND
 EXISTS(SELECT 1 FROM jsonb_array_elements(c.effect_plan->'options') o WHERE o->>'key'=c.effect_plan->>'best_option_key' AND coalesce((o->>'lawful')::boolean,false)
 AND (private.event_role_matches(m.role_title,o->'authorized_roles') OR private.event_party_controls_region(c.id,p_user))));
$f$;
REVOKE ALL ON FUNCTION private.event_v2_competent(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.guard_event_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.event_cases%rowtype; assigned integer; invited boolean;
begin
 select * into c from public.event_cases where id=new.case_id for update;
 if c.id is null or c.game_id<>new.game_id then raise exception 'Событие другой игры недоступно';end if;
 if not exists(select 1 from public.game_members where game_id=new.game_id and user_id=new.recipient_id and kind='student')
 then raise exception 'Получателем должен быть участник этой игры';end if;
 if tg_op='INSERT' then
  if c.status<>'ready' or exists(select 1 from public.event_case_outcomes where case_id=c.id)
  then raise exception 'Нельзя назначать архивное или завершённое событие';end if;
  if exists(select 1 from public.event_decisions where case_id=c.id)
  then raise exception 'После начала голосования состав участников не меняется';end if;
  select count(*) into assigned from public.event_assignments where case_id=c.id and recipient_id<>new.recipient_id;
  invited:=exists(select 1 from public.event_collaboration_invites
    where case_id=c.id and recipient_id=new.recipient_id and status='accepted');
  if c.audience='single' and (((c.audience='single' AND c.effect_plan->>'rules_version'='2') and assigned>=1) or (not coalesce((c.audience='single' AND c.effect_plan->>'rules_version'='2'),false) and ((not invited and assigned>=1) or (invited and assigned>=3))))
  then raise exception 'Все места в этом событии уже назначены';end if;
  if c.audience='group' and assigned>=3
  then raise exception 'Все места в этом событии уже назначены';end if;
 end if;
 if tg_op='UPDATE' and (new.game_id<>old.game_id or new.case_id<>old.case_id or new.recipient_id<>old.recipient_id) then
  if NOT coalesce((c.audience='single' AND c.effect_plan->>'rules_version'='2') AND new.game_id=old.game_id AND new.case_id=old.case_id
   AND new.id=old.id AND new.stage_no=old.stage_no AND old.status='pending' AND new.status='pending'
   AND auth.uid()=new.recipient_id AND NOT EXISTS(SELECT 1 FROM public.event_decisions WHERE case_id=c.id)
   AND EXISTS(SELECT 1 FROM public.event_collaboration_invites i WHERE i.case_id=c.id AND i.game_id=c.game_id
   AND i.inviter_id=old.recipient_id AND i.recipient_id=new.recipient_id AND i.status='accepted'
   AND i.transfer_stage_no=old.stage_no),false)
  then raise exception 'Назначение нельзя перенести другому участнику';end if;
 end if;
 if tg_op='UPDATE' and new.status='pending' and exists(select 1 from public.event_case_outcomes where case_id=c.id)
 then raise exception 'Голосование уже завершено';end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.invite_event_collaborator(p_case uuid, p_recipient uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.event_cases%rowtype;
begin
 select * into c from public.event_cases where id=p_case for update;
 if c.id is null or not exists(select 1 from public.event_assignments where case_id=p_case and recipient_id=auth.uid()) or not exists(select 1 from public.game_members where game_id=c.game_id and user_id=auth.uid() and kind='student' and roster_archived_at is null) then raise exception 'Ситуация недоступна';end if;
 if exists(select 1 from public.event_decisions where case_id=p_case) or exists(select 1 from public.event_case_outcomes where case_id=p_case) then raise exception 'После начала голосования приглашения закрыты';end if;
 if p_recipient=auth.uid() or exists(select 1 from public.event_assignments where case_id=p_case and recipient_id=p_recipient) or not exists(select 1 from public.game_members where game_id=c.game_id and user_id=p_recipient and kind='student' and roster_archived_at is null) then raise exception 'Выберите другого участника текущей игры';end if;
 if (c.audience='single' AND c.effect_plan->>'rules_version'='2') then
  if not exists(select 1 from public.event_assignments where case_id=c.id and recipient_id=auth.uid() and status='pending' and stage_no is not null)
   or (select count(*) from public.event_assignments where case_id=c.id)<>1
   or exists(select 1 from public.event_collaboration_invites where case_id=c.id and (status='pending' or transfer_stage_no is not null))
   then raise exception 'Передача ситуации недоступна';end if;
 elsif c.audience in ('single','group') and ((select count(*) from public.event_assignments where case_id=p_case) + (select count(*) from public.event_collaboration_invites where case_id=p_case and status='pending'))>=3 then raise exception 'Все места совместного решения заняты';end if;
 if (select count(*) from public.event_collaboration_invites where case_id=p_case and status in ('pending','accepted'))>=30 then raise exception 'Достигнут предел приглашений';end if;
 insert into public.event_collaboration_invites(case_id,game_id,inviter_id,recipient_id) values(p_case,c.game_id,auth.uid(),p_recipient)
 on conflict(case_id,recipient_id) do update set status='pending',inviter_id=auth.uid(),responded_at=null where event_collaboration_invites.status in ('declined','cancelled');
end;$function$;

CREATE OR REPLACE FUNCTION public.respond_event_invitation(p_id uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare i public.event_collaboration_invites%rowtype;c public.event_cases%rowtype;a public.event_assignments%rowtype;
begin
 select * into i from public.event_collaboration_invites where id=p_id and recipient_id=auth.uid();
 if i.id is null then raise exception 'Приглашение недоступно';end if;
 select * into c from public.event_cases where id=i.case_id for update;
 select * into i from public.event_collaboration_invites where id=p_id for update;
 if i.status<>'pending' or exists(select 1 from public.event_decisions where case_id=i.case_id)
 then raise exception 'Приглашение уже закрыто';end if;
 if p_accept then
  if not exists (select 1 from public.game_members where game_id=i.game_id and user_id=auth.uid() and kind='student' and roster_archived_at is null) then raise exception 'Приглашение доступно только действующему участнику'; end if;
  if (c.audience='single' AND c.effect_plan->>'rules_version'='2') then
   select * into a from public.event_assignments where case_id=c.id and game_id=c.game_id and recipient_id=i.inviter_id for update;
   if a.id is null or a.status<>'pending' or a.stage_no is null or (select count(*) from public.event_assignments where case_id=c.id)<>1
    or exists(select 1 from public.event_collaboration_invites where case_id=c.id and transfer_stage_no is not null)
    or exists(select 1 from public.event_case_outcomes where case_id=c.id)
    then raise exception 'Передача ситуации недоступна';end if;
   if not exists(select 1 from public.game_members where game_id=c.game_id and user_id=i.inviter_id and kind='student' and roster_archived_at is null)
    or private.event_v2_competent(c.id,i.inviter_id)
    or not private.event_v2_competent(c.id,auth.uid()) then
     update public.event_collaboration_invites set status='declined',responded_at=now() where id=p_id;
     return;
   end if;
   update public.event_collaboration_invites set status='accepted',responded_at=now(),transfer_stage_no=a.stage_no where id=p_id;
   update public.event_assignments set recipient_id=auth.uid() where id=a.id;
   return;
  end if;
  -- Assignment is first: failure rolls back the invitation transaction too.
  update public.event_collaboration_invites set status='accepted',responded_at=now() where id=p_id;
  insert into public.event_assignments(case_id,game_id,recipient_id,created_by)
  values(i.case_id,i.game_id,auth.uid(),i.inviter_id) on conflict do nothing;
 else
  update public.event_collaboration_invites set status='declined',responded_at=now() where id=p_id;
 end if;
end $function$;

CREATE OR REPLACE FUNCTION private.snapshot_event_office()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare a public.event_assignments%rowtype;c public.event_cases%rowtype;
begin
 select * into c from public.event_cases where id=new.case_id for update;
 select * into a from public.event_assignments where id=new.assignment_id;
 if c.id is null or a.case_id<>c.id or a.game_id<>new.game_id or a.recipient_id<>new.actor_id or a.status<>'pending' or new.actor_id<>auth.uid() then raise exception 'Некорректное назначение';end if;
 if not exists(select 1 from public.game_members where game_id=c.game_id and user_id=auth.uid() and kind='student' and (not coalesce((c.audience='single' AND c.effect_plan->>'rules_version'='2'),false) or roster_archived_at is null)) then raise exception 'Голосует только участник';end if;
 if exists(select 1 from public.event_case_outcomes where case_id=c.id) or exists(select 1 from public.event_collaboration_invites where case_id=c.id and status='pending') then raise exception 'Дождитесь ответа на приглашения';end if;
 if new.choice!~'^option_[1-6]$' or substring(new.choice from 8)::int>jsonb_array_length(c.decision_options) then raise exception 'Вариант недоступен';end if;
 select role_title into new.role_snapshot from public.game_members where game_id=c.game_id and user_id=new.actor_id;
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION private.record_event_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.event_cases%rowtype;d record;o jsonb;qualified uuid[];ok boolean;lawful boolean;v_stage integer;violations int:=0;legal_delta numeric;v_authority_delta numeric;old_value numeric;new_value numeric;m public.state_metrics%rowtype;
begin
 select * into c from public.event_cases where id=new.case_id;
 -- Each decision inherits its assignment's immutable stage. Parallel stages
 -- must never use the highest currently opened stage as attribution.
 for d in select * from public.event_decisions where case_id=c.id loop
  select ea.stage_no into v_stage from public.event_assignments ea
   where ea.id=d.assignment_id and ea.game_id=c.game_id;
  o:=c.effect_plan->'options'->(substring(d.choice from 8)::int-1);
  select array_agg(distinct x.actor_id) into qualified from public.event_decisions x where x.case_id=c.id and x.choice=d.choice and (private.event_role_matches(x.role_snapshot,o->'authorized_roles') OR private.event_party_controls_region(c.id,x.actor_id)) and (x.actor_id=d.actor_id or exists(select 1 from public.event_collaboration_invites i where i.case_id=c.id and i.inviter_id=d.actor_id and i.recipient_id=x.actor_id and i.status='accepted'));
  ok:=case when (c.audience='single' AND c.effect_plan->>'rules_version'='2') then private.event_v2_competent(c.id,d.actor_id) AND (private.event_role_matches(d.role_snapshot,o->'authorized_roles') OR private.event_party_controls_region(c.id,d.actor_id)) else coalesce(cardinality(qualified),0)>0 end;
  lawful:=coalesce((o->>'lawful')::boolean,false);
  -- Unattributed legacy assignments are not guessed into another stage;
  -- case resolution, trust and legal effects continue normally.
  if v_stage is not null then
  insert into public.event_authority_evidence(decision_id,case_id,game_id,actor_id,stage_no,authority_ok,lawful,strategy_point,role_snapshot,legal_basis,coalition_ids,delegated_ok,best_option)
  values(d.id,c.id,c.game_id,d.actor_id,v_stage,ok,lawful,ok and lawful and coalesce((o->>'protects_role_interest')::boolean,false),d.role_snapshot,coalesce(o->>'legal_basis','Правовая разметка варианта отсутствует'),coalesce(qualified,'{}'),not (private.event_role_matches(d.role_snapshot,o->'authorized_roles') OR private.event_party_controls_region(c.id,d.actor_id)) and ok,(case when (c.audience='single' AND c.effect_plan->>'rules_version'='2') then d.choice=c.effect_plan->>'best_option_key' else coalesce(o->>'public_interest','')='beneficial' end) and lawful and d.choice=new.winner) on conflict do nothing;
  end if;
  if d.choice=new.winner and (not ok or not lawful) then violations:=violations+1;end if;
 end loop;
 update public.event_authority_evidence ev set score_share=case when ev.best_option and ev.authority_ok and ev.lawful then case when (c.audience='single' AND c.effect_plan->>'rules_version'='2') then case when exists(select 1 from public.event_collaboration_invites i where i.case_id=c.id and i.recipient_id=ev.actor_id and i.status='accepted' and i.transfer_stage_no is not null) then .5 else 1 end else round(1.0/nullif((select count(*) from public.event_authority_evidence ec where ec.case_id=c.id and ec.best_option and ec.authority_ok and ec.lawful),0),5) end else 0 end where ev.case_id=c.id; if new.winner='tie' then return new;end if;
 v_authority_delta:=case when violations>0 then 0 else 1 end;
 legal_delta:=case when violations>0 then -3 else 2 end;
 if v_authority_delta<>0 then
  perform private.apply_event_trust_delta(c.game_id,'authority-'||c.id,v_authority_delta,'Полномочия в событии: '||c.title);
 end if;
 select * into m from public.state_metrics where game_id=c.game_id and metric_key='lawfulness' for update;
 if m.id is not null then
  old_value:=m.value;new_value:=greatest(coalesce(m.min_value,-1e9),least(coalesce(m.max_value,1e9),old_value+legal_delta));
  update public.state_metrics set previous_value=old_value,value=new_value where id=m.id;
  insert into public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note)
  values(c.game_id,m.id,m.metric_key,new_value,old_value,new_value-old_value,'event_authority',c.id::text,auth.uid(),'Правовая устойчивость: проверка полномочий по событию «'||c.title||'»');
 end if;
 update public.event_case_outcomes set trust_delta=new.trust_delta+coalesce((select delta from public.event_trust_ledger where game_id=c.game_id and action_key='authority-'||c.id),0),requested_trust_delta=new.requested_trust_delta+v_authority_delta where case_id=c.id;
 update public.political_posts set body=body||E'\n\nПроверка полномочий: нарушений '||violations||'. Суммарное фактическое изменение доверия: '||(select trust_delta from public.event_case_outcomes where case_id=c.id)||' п.п.' where id=new.media_post_id;
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION private.blitz_vsn_components(p_game uuid, p_student uuid, p_stage integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_deadline timestamptz;total_q int; correct_q int; answered_q int; cases_n int; correct_cases numeric; transfer_n int; acts int; c numeric; a numeric; b numeric; completion numeric;
begin
 select case when s.score_closed_at is not null or s.status='open' then coalesce(s.score_closed_at,s.deadline,clock_timestamp()) else coalesce(s.completed_at,clock_timestamp()) end into v_deadline from public.game_stages s where s.game_id=p_game and s.stage_no=p_stage;
 v_deadline:=least(coalesce(v_deadline,clock_timestamp()),clock_timestamp());
 select count(*),count(*) filter(where is_correct and answered_at<=v_deadline),count(*) filter(where chosen_index is not null and answered_at<=v_deadline)
 into total_q,correct_q,answered_q from public.blitz_assignments where game_id=p_game and user_id=p_student and stage_no=p_stage and available_at<=v_deadline;
 select count(*)::integer,coalesce(sum(e.score_share) filter(where e.best_option and e.authority_ok and e.lawful),0)
 into cases_n,correct_cases from public.event_authority_evidence e
 where e.game_id=p_game and e.actor_id=p_student and e.stage_no=p_stage and e.created_at<=v_deadline;
 select count(*)::int into transfer_n from public.event_collaboration_invites i
 where i.game_id=p_game and i.inviter_id=p_student and i.transfer_stage_no=p_stage and i.status='accepted' and i.responded_at<=v_deadline;
 cases_n:=cases_n+transfer_n;correct_cases:=correct_cases+.5*transfer_n;
 select count(*) into acts from public.player_actions where game_id=p_game and author_id=p_student and round_no=p_stage and status='accepted' and submitted_at<=v_deadline;
 c:=case when cases_n>0 then 0.30*least(1,correct_cases::numeric/cases_n) else 0 end;
 a:=0.30*least(1,acts::numeric/3);
 b:=case when total_q>0 then 0.30*correct_q::numeric/total_q else 0 end;
 completion:=case when total_q>0 then 0.10*answered_q::numeric/total_q else 0 end;
 return jsonb_build_object('score',round(c+a+b+completion,2),'cases',round(c,2),'actions',round(a,2),'blitz',round(b,2),'completion',round(completion,2),'cases_total',cases_n,'cases_right',correct_cases,'actions_right',acts,'quiz_total',total_q,'quiz_right',correct_q,'quiz_answered',answered_q);
end $function$;

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
  event_law:=event_law+(select count(*)::int from public.event_collaboration_invites i where i.game_id=p_game and i.inviter_id=p_user and i.transfer_stage_no=p_stage and i.status='accepted' and i.responded_at>=v_start and i.responded_at<=v_end);
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

CREATE OR REPLACE FUNCTION public.get_event_workspace_projection(p_game_id uuid, p_include_ready_count boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
 v_teacher boolean;
 v_full_view boolean;
 v_cases uuid[];
 v_winning jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_member(p_game_id) THEN
  RAISE EXCEPTION 'Нет доступа к игре.' USING ERRCODE='42501';
 END IF;
 v_teacher:=private.is_game_teacher(p_game_id);
 v_full_view:=v_teacher OR EXISTS(
  SELECT 1 FROM public.game_members gm WHERE gm.game_id=p_game_id AND gm.user_id=(SELECT auth.uid())
    AND gm.kind='observer' AND gm.roster_archived_at IS NULL);
 IF NOT v_full_view THEN
  SELECT coalesce(array_agg(DISTINCT x.case_id),ARRAY[]::uuid[]) INTO v_cases
  FROM (
   SELECT a.case_id FROM public.event_assignments a
    WHERE a.game_id=p_game_id AND a.recipient_id=(SELECT auth.uid())
   UNION
   SELECT i.case_id FROM public.event_collaboration_invites i
    WHERE i.game_id=p_game_id AND (i.recipient_id=(SELECT auth.uid()) OR (i.inviter_id=(SELECT auth.uid()) AND i.transfer_stage_no IS NOT NULL))
  ) x;
 END IF;
 -- Evaluate only the publicly resolved winning option, never a case answer key.
 v_winning:=private.event_winning_outcomes_visible(p_game_id,v_cases);
 RETURN jsonb_build_object(
  'assignments',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
   FROM (SELECT id,case_id,game_id,recipient_id,status,created_at FROM public.event_assignments
    WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'decisions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
   FROM (SELECT id,case_id,actor_id,choice,role_snapshot FROM public.event_decisions
    WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.case_id)
   FROM (SELECT o.case_id,o.winner,o.trust_delta,o.votes_count,o.assignments_count,o.media_post_id,o.requested_trust_delta,o.resolution_kind,
     (v_winning->(o.case_id::text)->'winning_fiscal_effect') AS winning_fiscal_effect,
     (v_winning->(o.case_id::text)->>'winning_description') AS winning_description
   FROM public.event_case_outcomes o
   WHERE o.game_id=p_game_id AND (v_full_view OR o.case_id=ANY(v_cases))) x),'[]'::jsonb),
  'invitations',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
   FROM (SELECT id,case_id,inviter_id,recipient_id,status,transfer_stage_no FROM public.event_collaboration_invites
    WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'authority',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.decision_id)
   FROM (SELECT decision_id,case_id,actor_id,authority_ok,lawful,strategy_point,role_snapshot,legal_basis,score_share
   FROM public.event_authority_evidence WHERE game_id=p_game_id AND (v_full_view OR case_id=ANY(v_cases))) x),'[]'::jsonb),
  'ready_case_count',CASE WHEN p_include_ready_count AND v_teacher THEN
   (SELECT count(*) FROM public.event_cases WHERE game_id=p_game_id AND status='ready')
   ELSE NULL END
 );
END $function$;
