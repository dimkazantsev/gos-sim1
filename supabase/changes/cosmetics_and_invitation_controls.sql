CREATE OR REPLACE FUNCTION private.preserve_platform_admin_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin if exists(select 1 from public.platform_admins where user_id=new.user_id) then new.kind:='teacher'; if new.role_title is null or new.role_title in ('Участник','Гость','Руководитель симуляции') then new.role_title:='Преподаватель';end if;end if;return new;end;$function$;

CREATE OR REPLACE FUNCTION public.has_seen_my_intro()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select auth.uid() is not null and exists(select 1 from public.game_profiles where user_id=auth.uid() and (intro_seen_at is not null or onboarding_completed_at is not null)); $function$;

CREATE OR REPLACE FUNCTION public.open_direct_conversation(p_game uuid, p_recipient uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_channel uuid;v_name text;
begin
 if auth.uid() is null or auth.uid()=p_recipient or not exists(select 1 from public.game_members where game_id=p_game and user_id=auth.uid() and kind<>'observer') or not exists(select 1 from public.game_members where game_id=p_game and user_id=p_recipient and kind<>'observer') then raise exception 'Личная беседа доступна участникам текущей игры';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_game::text||least(auth.uid()::text,p_recipient::text)||greatest(auth.uid()::text,p_recipient::text),0));
 select c.id into v_channel from public.chat_channels c where c.game_id=p_game and c.kind='private' and exists(select 1 from public.channel_members where channel_id=c.id and user_id=auth.uid()) and exists(select 1 from public.channel_members where channel_id=c.id and user_id=p_recipient) and (select count(*) from public.channel_members where channel_id=c.id)=2 limit 1;
 if v_channel is not null then return v_channel;end if;
 select string_agg(full_name,' · ' order by user_id) into v_name from public.game_members where game_id=p_game and user_id in (auth.uid(),p_recipient);
 insert into public.chat_channels(game_id,name,kind,created_by) values(p_game,left(v_name,250),'private',auth.uid()) returning id into v_channel;
 insert into public.channel_members(channel_id,user_id) values(v_channel,auth.uid()),(v_channel,p_recipient);
 return v_channel;
end;$function$;

CREATE OR REPLACE FUNCTION public.cancel_event_invitation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$ declare i public.event_collaboration_invites%rowtype; begin select * into i from public.event_collaboration_invites where id=p_id; if i.id is null then raise exception 'Приглашение недоступно'; end if; perform 1 from public.event_cases where id=i.case_id for update; if i.inviter_id<>auth.uid() and not private.is_game_teacher(i.game_id) then raise exception 'Приглашение недоступно'; end if; if exists(select 1 from public.event_decisions where case_id=i.case_id) then raise exception 'Голосование уже началось'; end if; update public.event_collaboration_invites set status='cancelled',responded_at=now() where id=p_id and status='pending'; end;$function$;
revoke all on function public.has_seen_my_intro() from public,anon;
grant execute on function public.has_seen_my_intro() to authenticated;
revoke all on function public.open_direct_conversation(uuid,uuid) from public,anon;
grant execute on function public.open_direct_conversation(uuid,uuid) to authenticated;
revoke all on function public.cancel_event_invitation(uuid) from public,anon;
grant execute on function public.cancel_event_invitation(uuid) to authenticated;
