-- Optional reply metadata only; no joins or new polling required for chat history.
alter table public.chat_messages
 add column if not exists reply_to_id uuid,
 add column if not exists reply_author_id uuid,
 add column if not exists reply_excerpt text;

-- Separate function keeps the existing 4-argument send_chat_text RPC unchanged
-- for old open browser tabs. One RPC per reply, with the same mention privileges.
create or replace function public.send_chat_reply(
 p_game uuid,p_channel uuid,p_text text,p_mentioned_users uuid[],p_reply_to uuid
) returns uuid language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare
 v_uid uuid:=(select auth.uid());
 v_id uuid;
 v_kind text;
 v_original_author uuid;
 v_original_kind text;
 v_original_text text;
 v_preview text;
begin
 if v_uid is null or trim(coalesce(p_text,''))='' then raise exception 'Сообщение пустое.';end if;
 if not private.can_access_channel(p_channel) then raise exception 'Нет доступа к диалогу.';end if;
 if not exists(select 1 from public.chat_channels where id=p_channel and game_id=p_game) then
  raise exception 'Диалог не относится к игре.';
 end if;
 if exists(select 1 from public.game_members where game_id=p_game and user_id=v_uid and kind='observer') then
  raise exception 'Гостевой режим доступен только для чтения.';
 end if;
 select author_id,kind::text,text into v_original_author,v_original_kind,v_original_text
 from public.chat_messages
 where id=p_reply_to and game_id=p_game and channel_id=p_channel and created_at>now()-interval '30 days';
 if not found then raise exception 'Исходное сообщение недоступно в этом диалоге.';end if;
 v_preview:=case v_original_kind
  when 'audio' then 'Голосовое сообщение'
  when 'video' then 'Видеосообщение'
  when 'file' then 'Прикреплённый файл'
  else coalesce(nullif(left(trim(coalesce(v_original_text,'')),160),''),'Сообщение')
 end;
 insert into public.chat_messages(game_id,channel_id,author_id,kind,text,reply_to_id,reply_author_id,reply_excerpt)
 values(p_game,p_channel,v_uid,'text',trim(p_text),p_reply_to,v_original_author,v_preview)
 returning id into v_id;
 select kind into v_kind from public.chat_channels where id=p_channel;
 insert into public.chat_mentions(game_id,channel_id,message_id,author_id,mentioned_user_id)
 select p_game,p_channel,v_id,v_uid,x.uid
 from (select distinct unnest(coalesce(p_mentioned_users,'{}'::uuid[])) uid) x
 join public.game_members gm on gm.game_id=p_game and gm.user_id=x.uid and gm.kind<>'observer'
 where x.uid<>v_uid and (v_kind='public' or exists(
  select 1 from public.channel_members cm where cm.channel_id=p_channel and cm.user_id=x.uid
 ))
 on conflict(message_id,mentioned_user_id) do nothing;
 return v_id;
end;$$;

revoke all on function public.send_chat_reply(uuid,uuid,text,uuid[],uuid) from public,anon;
grant execute on function public.send_chat_reply(uuid,uuid,text,uuid[],uuid) to authenticated;
