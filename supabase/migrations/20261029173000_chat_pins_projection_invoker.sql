-- ГОС.ID, Шаг 2/9: закрепления и сообщения одного чата за один RPC.
-- Оба исходных SELECT выполняются от имени вызвавшего пользователя с RLS.
-- Права на каналы, публикации, авторство, историю и медиа не изменяются.
create or replace function public.get_chat_pins_projection(p_channel_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null or not private.can_access_channel(p_channel_id) then
    raise exception 'Нет доступа к чату.' using errcode = '42501';
  end if;

  with recent_pins as materialized (
    select p.id,p.game_id,p.channel_id,p.message_id,p.pinned_by,p.pinned_at
    from public.chat_pins p
    where p.channel_id = p_channel_id
    order by p.pinned_at desc
    limit 12
  )
  select jsonb_build_object(
    'pins',coalesce((
      select jsonb_agg(to_jsonb(p) order by p.pinned_at desc)
      from recent_pins p
    ),'[]'::jsonb),
    'messages',coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at asc,m.id asc)
      from public.chat_messages m
      where m.channel_id = p_channel_id
        and m.id in (select p.message_id from recent_pins p)
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_chat_pins_projection(uuid) from public, anon;
grant execute on function public.get_chat_pins_projection(uuid) to authenticated;
