-- Stage 12: server-side automatic closing of expired Duma sessions.
create or replace function private.auto_close_expired_duma_sessions()
returns integer
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare s public.duma_sessions%rowtype;v_next uuid;v_next_no integer;v_carried integer;v_closed integer:=0;
begin
 for s in
  select * from public.duma_sessions
  where status='open' and scheduled_end is not null and scheduled_end<=now()
  order by scheduled_end
  for update skip locked
 loop
  update public.duma_sessions set status='closed',closed_at=now() where id=s.id;
  select count(*)::integer into v_carried
  from public.duma_agenda_items where session_id=s.id and status in ('pending','in_progress');
  update public.duma_agenda_items set status='carried_over'
  where session_id=s.id and status in ('pending','in_progress');

  if v_carried>0 then
   select coalesce(max(session_no),0)+1 into v_next_no from public.duma_sessions where game_id=s.game_id;
   insert into public.duma_sessions(game_id,stage_no,session_no,title,status,chair_user_id,created_by)
   values(s.game_id,s.stage_no,v_next_no,'Заседание Государственной Думы №'||v_next_no,'draft',s.chair_user_id,s.created_by)
   returning id into v_next;
   insert into public.duma_agenda_items(session_id,game_id,formal_document_id,agenda_no,status)
   select v_next,s.game_id,formal_document_id,row_number() over(order by agenda_no),'pending'
   from public.duma_agenda_items
   where session_id=s.id and status='carried_over'
   order by agenda_no;
  else v_next:=null; end if;

  insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
  values(
   s.game_id,s.stage_no,'Заседание ГД','notice','Заседание Государственной Думы завершено по регламенту',
   'Срок заседания истёк автоматически. Рассмотрено: '||
   (select count(*) from public.duma_agenda_items where session_id=s.id and status='completed')||
   '; перенесено: '||v_carried,
   s.created_by
  );
  v_closed:=v_closed+1;
 end loop;
 return v_closed;
end;$$;
revoke all on function private.auto_close_expired_duma_sessions() from public,anon,authenticated;

do $$
declare jid bigint;
begin
 select jobid into jid from cron.job where jobname='gos_sim_auto_close_duma_sessions' limit 1;
 if jid is not null then perform cron.unschedule(jid); end if;
 perform cron.schedule('gos_sim_auto_close_duma_sessions','* * * * *','select private.auto_close_expired_duma_sessions();');
end $$;

-- Default parliamentary schedule: 20:00–00:00 in the game timezone unless explicitly overridden.
create or replace function public.create_duma_session(
 p_game_id uuid,p_title text,p_scheduled_start timestamptz default null,p_scheduled_end timestamptz default null
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
 v_uid uuid:=(select auth.uid());v_no integer;v_id uuid;
 v_tz text;v_local_date date;v_start timestamptz;v_end timestamptz;
begin
 if v_uid is null or not private.can_manage_duma_session(p_game_id,v_uid) then raise exception 'State Duma chair / teacher access required'; end if;
 if exists(select 1 from public.duma_sessions where game_id=p_game_id and status='open') then raise exception 'Close the current State Duma session first'; end if;
 select coalesce(settings->>'evaluation_timezone','Asia/Barnaul') into v_tz from public.games where id=p_game_id;
 v_local_date:=(now() at time zone v_tz)::date;
 v_start:=coalesce(p_scheduled_start,(v_local_date+time '20:00') at time zone v_tz);
 v_end:=coalesce(p_scheduled_end,((v_local_date+1)+time '00:00') at time zone v_tz);
 if v_end<=v_start then raise exception 'Session end must be later than start'; end if;
 select coalesce(max(session_no),0)+1 into v_no from public.duma_sessions where game_id=p_game_id;
 insert into public.duma_sessions(game_id,session_no,title,scheduled_start,scheduled_end,chair_user_id,created_by)
 values(p_game_id,v_no,coalesce(nullif(trim(p_title),''),'Заседание Государственной Думы №'||v_no),v_start,v_end,v_uid,v_uid)
 returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.create_duma_session(uuid,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.create_duma_session(uuid,text,timestamptz,timestamptz) to authenticated;
