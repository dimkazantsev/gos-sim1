-- Game-scoped, RLS-authorized Realtime transport. One subscription per player,
-- with 30s polling recovery in clients. No new public tables are exposed.
do $migration$
declare table_name text;
begin
 foreach table_name in array array[
  'chat_messages','chat_mentions','chat_channel_state','chat_pins',
  'game_stages','game_parties','party_invitations','party_documents',
  'formal_documents','political_posts','game_votes','blitz_assignments','stage_deadline_rules'
 ] loop
  if not exists (
   select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename=table_name
  ) then
   execute format('alter publication supabase_realtime add table public.%I',table_name);
  end if;
 end loop;
end
$migration$;

-- These legacy permissive policies exposed rows across private chat channels.
-- Preserve read by authorized channel members and author/teacher write policies.
alter policy chat_messages_media_scope on public.chat_messages
 using (private.can_access_channel(channel_id))
 with check (private.can_access_channel(channel_id) and author_id=(select auth.uid()));
alter policy chat_media_one_hour_visibility on public.chat_messages
 using (
  private.can_access_channel(channel_id)
  and (kind <> all(array['audio'::message_kind,'video'::message_kind])
       or created_at > now() - interval '1 hour')
 );
-- The existing teacher/assignee policy is sufficient for Blitz answer rows.
drop policy if exists blitz_assignments_current_member on public.blitz_assignments;

alter table public.section_reads drop constraint if exists section_reads_section_key_check;
alter table public.section_reads add constraint section_reads_section_key_check
 check (section_key in ('dashboard','stages','parties','votes','documents','actions','events','teacher'));

create or replace function public.get_section_updates(p_game_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
 u uuid:=auth.uid();
 d timestamptz;v timestamptz;e timestamptz;
 a timestamptz;p timestamptz;s timestamptz;t timestamptz;h timestamptz;
begin
 if not private.is_game_member(p_game_id) then
  raise exception 'Нет доступа к игре.' using errcode='42501';
 end if;
 select coalesce(max(seen_at),'-infinity') into d from section_reads where game_id=p_game_id and user_id=u and section_key='documents';
 select coalesce(max(seen_at),'-infinity') into v from section_reads where game_id=p_game_id and user_id=u and section_key='votes';
 select coalesce(max(seen_at),'-infinity') into e from section_reads where game_id=p_game_id and user_id=u and section_key='events';
 select coalesce(max(seen_at),'-infinity') into a from section_reads where game_id=p_game_id and user_id=u and section_key='actions';
 select coalesce(max(seen_at),'-infinity') into p from section_reads where game_id=p_game_id and user_id=u and section_key='parties';
 select coalesce(max(seen_at),'-infinity') into s from section_reads where game_id=p_game_id and user_id=u and section_key='stages';
 select coalesce(max(seen_at),'-infinity') into t from section_reads where game_id=p_game_id and user_id=u and section_key='teacher';
 select coalesce(max(seen_at),'-infinity') into h from section_reads where game_id=p_game_id and user_id=u and section_key='dashboard';
 return jsonb_build_object(
  'documents',(select count(*) from formal_documents where game_id=p_game_id and updated_at>d),
  'votes',(select count(*) from game_votes where game_id=p_game_id and opened_at>v),
  'events',(select count(*) from (
   select id from event_assignments where game_id=p_game_id and recipient_id=u and created_at>e
   union all
   select id from event_collaboration_invites where game_id=p_game_id and recipient_id=u and status='pending' and created_at>e
  ) q),
  'actions',(select count(*) from political_posts where game_id=p_game_id and deleted_at is null and created_at>a)
     +(select count(*) from formal_documents where game_id=p_game_id and created_at>a),
  'parties',(select count(*) from game_parties where game_id=p_game_id and created_at>p)
     +(select count(*) from party_invitations where game_id=p_game_id and invited_user_id=u and status='pending' and created_at>p),
  'stages',(select count(*) from game_stages where game_id=p_game_id
       and greatest(coalesce(opened_at,'-infinity'),coalesce(completed_at,'-infinity'))>s),
  'dashboard',(select count(*) from political_posts where game_id=p_game_id and deleted_at is null and created_at>h),
  'teacher',case when private.is_game_teacher(p_game_id) then
    (select count(*) from game_parties where game_id=p_game_id and registration_status='submitted' and registration_submitted_at>t)
    +(select count(*) from party_documents where game_id=p_game_id and created_at>t and status <> 'accepted')
   else 0 end
 );
end $function$;

create or replace function public.mark_section_read(p_game_id uuid,p_section text,p_seen_at timestamptz)
returns void language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $function$
begin
 if not private.is_game_member(p_game_id) then
  raise exception 'Нет доступа к игре.' using errcode='42501';
 end if;
 if p_section not in ('dashboard','stages','parties','votes','documents','actions','events','teacher') then
  raise exception 'Неизвестный раздел.' using errcode='22023';
 end if;
 insert into section_reads(game_id,user_id,section_key,seen_at)
 values(p_game_id,auth.uid(),p_section,least(p_seen_at,clock_timestamp()))
 on conflict(game_id,user_id,section_key)
 do update set seen_at=greatest(section_reads.seen_at,excluded.seen_at);
end $function$;

-- The previous random() time per assignment could cluster all three prompts.
-- Keep 3-5/day, topic diversity, non-repeats and existing historical backlog.
create or replace function public.blitz_issue_for_day(p_game uuid,p_student uuid,p_day date,p_stage integer)
returns integer language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare n integer; ids bigint[]; inserted_count integer;
begin
 if not exists(select 1 from public.game_members m where m.game_id=p_game and m.user_id=p_student and m.kind='student')
 then return 0; end if;
 perform pg_advisory_xact_lock(hashtextextended('blitz:'||p_game||':'||p_student||':'||p_day,0));
 if exists(select 1 from public.blitz_daily_plans where game_id=p_game and user_id=p_student and assigned_day=p_day)
 then return 0; end if;
 n:=3+floor(random()*3)::integer;
 select array_agg(q.id) into ids from (
  select ranked.id from (
   select z.id,z.topic,row_number() over(partition by z.topic order by random()) as per_topic
   from public.blitz_questions z
   where z.verified and z.legal_review_status='approved'
    and not exists(select 1 from public.blitz_assignments a where a.game_id=p_game and a.user_id=p_student and a.question_id=z.id)
  ) ranked where ranked.per_topic=1 order by random() limit n
 ) q;
 if coalesce(array_length(ids,1),0)<>n then return 0; end if;
 insert into public.blitz_daily_plans(game_id,user_id,assigned_day,stage_no,target_count)
 values(p_game,p_student,p_day,p_stage,n);
 insert into public.blitz_assignments(game_id,user_id,question_id,stage_no,assigned_day,available_at)
 select p_game,p_student,a.question_id,p_stage,p_day,
  (p_day::timestamp+interval '9 hours'
   + interval '12 hours' *((a.ord-1)::double precision/n)
   + random()*interval '20 minutes') at time zone 'Europe/Moscow'
 from unnest(ids) with ordinality as a(question_id,ord);
 get diagnostics inserted_count=row_count;
 return inserted_count;
end $function$;
