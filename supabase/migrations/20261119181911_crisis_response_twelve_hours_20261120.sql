-- ГОС.ID: 12-hour primary crisis response. Preserve teacher permission check, game isolation and historical resolved crises.
create or replace function public.launch_crisis(
 p_game_id uuid,p_crisis_type text,p_intensity text,p_description text,p_response_minutes integer default 720
) returns uuid
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_stage integer;
 v_response_minutes constant integer:=720; -- Enforce 12 hours for old cached clients sending 20.
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
 if p_intensity not in ('low','medium','high','ultra') then raise exception 'Unsupported intensity'; end if;
 if length(trim(coalesce(p_crisis_type,'')))<3 or length(trim(coalesce(p_description,'')))<5 then raise exception 'Crisis description is required'; end if;
 if p_response_minutes<1 or p_response_minutes>720 then raise exception 'Response window must be from 1 to 720 minutes'; end if;
 select stage_no into v_stage from public.game_stages where game_id=p_game_id and status='open' order by stage_no desc limit 1;

 insert into public.game_crises(game_id,stage_no,crisis_type,intensity,description,created_by,status,response_deadline)
 values(p_game_id,coalesce(v_stage,15),trim(p_crisis_type),p_intensity,trim(p_description),v_uid,'active',now()+make_interval(mins=>v_response_minutes))
 returning id into v_id;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,coalesce(v_stage,15),'Кризис',
   case when p_intensity='ultra' then 'critical' when p_intensity='high' then 'warning' else 'notice' end,
   trim(p_crisis_type)||' · '||
   case p_intensity when 'low' then 'Низкая' when 'medium' then 'Средняя' when 'high' then 'Высокая' else 'Ультра' end,
   trim(p_description)||E'\n\nСрок первичной реакции: '||'12 часов.',v_uid);

 return v_id;
end;
$$;
revoke all on function public.launch_crisis(uuid,text,text,text,integer) from public,anon;
grant execute on function public.launch_crisis(uuid,text,text,text,integer) to authenticated;

-- Extend only live crises still within the newly approved 12-hour interval.
update public.game_crises
set response_deadline=created_at+interval '12 hours'
where status='active'
  and response_deadline is not null
  and created_at>now()-interval '12 hours'
  and response_deadline<created_at+interval '12 hours';
