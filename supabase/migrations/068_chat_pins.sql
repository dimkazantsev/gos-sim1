-- Persistent channel pins for files, audio, video and regular messages.
-- All mutation is through a verified SECURITY DEFINER RPC; ordinary clients
-- can only read pins for channels they are authorised to see.
create table if not exists public.chat_pins (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 channel_id uuid not null references public.chat_channels(id) on delete cascade,
 message_id uuid not null unique references public.chat_messages(id) on delete cascade,
 pinned_by uuid not null references auth.users(id),
 pinned_at timestamptz not null default now()
);
create index if not exists chat_pins_channel_recent_idx
 on public.chat_pins(channel_id,pinned_at desc);

alter table public.chat_pins enable row level security;
revoke all on public.chat_pins from public,anon,authenticated;
grant select on public.chat_pins to authenticated;
drop policy if exists chat_pins_read on public.chat_pins;
create policy chat_pins_read on public.chat_pins for select to authenticated
 using (private.can_access_channel(channel_id));

create or replace function public.set_chat_pin(p_message_id uuid,p_pin boolean)
returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
 v_uid uuid := (select auth.uid());
 v_message public.chat_messages%rowtype;
 v_owner uuid;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 select * into v_message from public.chat_messages where id=p_message_id;
 if v_message.id is null or not private.can_access_channel(v_message.channel_id)
 then raise exception 'Channel unavailable'; end if;
 if p_pin then
   if not exists(select 1 from public.chat_pins where message_id=p_message_id) then
     -- Lock channel to serialize the per-channel quota across simultaneous pins.
     perform 1 from public.chat_channels where id=v_message.channel_id for update;
     if (select count(*) from public.chat_pins where channel_id=v_message.channel_id)>=12
     then raise exception 'Maximum of 12 pinned items per channel'; end if;
     insert into public.chat_pins(game_id,channel_id,message_id,pinned_by)
     values(v_message.game_id,v_message.channel_id,v_message.id,v_uid)
     on conflict(message_id) do nothing;
   end if;
 else
   select pinned_by into v_owner from public.chat_pins where message_id=p_message_id;
   if v_owner is null then return; end if;
   if v_owner<>v_uid and not private.is_game_teacher(v_message.game_id)
   then raise exception 'Only the author of the pin or the teacher can unpin'; end if;
   delete from public.chat_pins where message_id=p_message_id;
 end if;
end;$$;
revoke all on function public.set_chat_pin(uuid,boolean) from public,anon;
grant execute on function public.set_chat_pin(uuid,boolean) to authenticated;

do $$ begin
 if not exists(
  select 1 from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' and tablename='chat_pins'
 ) then
  alter publication supabase_realtime add table public.chat_pins;
 end if;
end $$;
