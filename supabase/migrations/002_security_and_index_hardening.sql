-- Security and index hardening applied to the live Supabase project.
revoke all on table public.invite_codes from anon, authenticated;

revoke execute on function public.create_game_session(text,text,text,text,text) from public, anon;
grant execute on function public.create_game_session(text,text,text,text,text) to authenticated;

revoke execute on function public.join_game_with_code(text,text,text,text) from public, anon;
grant execute on function public.join_game_with_code(text,text,text,text) to authenticated;

revoke execute on function private.is_game_member(uuid) from public, anon, authenticated;
revoke execute on function private.is_game_teacher(uuid) from public, anon, authenticated;
revoke execute on function private.can_access_channel(uuid) from public, anon, authenticated;

drop policy if exists messages_insert on public.chat_messages;
create policy messages_insert on public.chat_messages
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and private.can_access_channel(channel_id)
  and exists (
    select 1 from public.chat_channels c
    where c.id = chat_messages.channel_id
      and c.game_id = chat_messages.game_id
  )
);

create index if not exists games_owner_idx on public.games(owner_id);
create index if not exists invite_codes_game_idx on public.invite_codes(game_id);
create index if not exists chat_channels_game_idx on public.chat_channels(game_id);
create index if not exists chat_channels_created_by_idx on public.chat_channels(created_by);
create index if not exists chat_messages_game_idx on public.chat_messages(game_id);
create index if not exists chat_messages_author_idx on public.chat_messages(author_id);
create index if not exists channel_members_user_idx on public.channel_members(user_id);
create index if not exists game_documents_game_idx on public.game_documents(game_id);
create index if not exists game_documents_created_by_idx on public.game_documents(created_by);
create index if not exists game_events_created_by_idx on public.game_events(created_by);
create index if not exists player_actions_author_idx on public.player_actions(author_id);
create index if not exists player_actions_reviewed_by_idx on public.player_actions(reviewed_by);
create index if not exists missions_game_idx on public.missions(game_id);
create index if not exists missions_assigned_to_idx on public.missions(assigned_to);
create index if not exists audit_log_actor_idx on public.audit_log(actor_id);
