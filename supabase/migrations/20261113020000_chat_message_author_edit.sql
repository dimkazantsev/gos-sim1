-- Author-only text edits. A single authenticated RPC updates text and mention links;
-- no new tables, indexes, timers, subscriptions or extra round trips.
create or replace function public.edit_chat_message(
 p_message_id uuid,
 p_text text,
 p_mentioned_users uuid[] default '{}'::uuid[]
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_uid uuid := (select auth.uid());
 v_game uuid;
 v_channel uuid;
 v_author uuid;
 v_kind text;
 v_previous text;
 v_channel_kind text;
 v_value text := btrim(coalesce(p_text,''));
begin
 if v_uid is null then raise exception 'Требуется авторизация.'; end if;
 if p_message_id is null or v_value = '' or char_length(v_value) > 20000 then
  raise exception 'Сообщение должно содержать от 1 до 20000 символов.';
 end if;
 if cardinality(coalesce(p_mentioned_users,'{}'::uuid[])) > 20 then
  raise exception 'Слишком много упоминаний.';
 end if;
 select m.game_id,m.channel_id,m.author_id,m.kind::text,m.text
 into v_game,v_channel,v_author,v_kind,v_previous
 from public.chat_messages m where m.id=p_message_id for update;
 if not found or v_author is distinct from v_uid or v_kind <> 'text'
    or not private.can_access_channel(v_channel)
    or exists (
     select 1 from public.game_members gm
     where gm.game_id=v_game and gm.user_id=v_uid and gm.kind='observer'
    ) then
  raise exception 'Недостаточно прав для изменения сообщения.';
 end if;
 select c.kind::text into v_channel_kind
 from public.chat_channels c
 where c.id=v_channel and c.game_id=v_game;
 if v_channel_kind is null then
  raise exception 'Канал сообщения недоступен.';
 end if;
 if v_previous is not distinct from v_value then return v_previous; end if;
 update public.chat_messages set text=v_value where id=p_message_id;
 -- Keep existing read states for unchanged mentions; remove only obsolete links.
 delete from public.chat_mentions mn
 where mn.message_id=p_message_id
   and not (mn.mentioned_user_id=any(coalesce(p_mentioned_users,'{}'::uuid[])));
 insert into public.chat_mentions(game_id,channel_id,message_id,author_id,mentioned_user_id)
 select v_game,v_channel,p_message_id,v_uid,x.uid
 from (select distinct unnest(coalesce(p_mentioned_users,'{}'::uuid[])) as uid) x
 join public.game_members gm on gm.game_id=v_game and gm.user_id=x.uid and gm.kind<>'observer'
 where x.uid<>v_uid
   and (v_channel_kind='public' or exists (
      select 1 from public.channel_members cm where cm.channel_id=v_channel and cm.user_id=x.uid
   ))
 on conflict (message_id,mentioned_user_id) do nothing;
 return v_value;
end;
$$;
revoke all on function public.edit_chat_message(uuid,text,uuid[]) from public,anon;
grant execute on function public.edit_chat_message(uuid,text,uuid[]) to authenticated;
