-- Guest views remain readable; previous ALL restrictive policies also blocked SELECT.
do $$
declare t text;
begin
 foreach t in array ARRAY[
 'player_actions','political_posts','chat_messages','formal_documents','game_votes',
 'game_ballots','game_events','game_parties','party_documents','event_cases',
 'event_assignments','event_decisions','game_activity'
 ] loop
  execute format('drop policy if exists guests_cannot_write on public.%I',t);
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='game_id') then
   execute format('create policy guests_cannot_insert on public.%I as restrictive for insert to authenticated with check (not exists(select 1 from public.game_members gm where gm.game_id=%I.game_id and gm.user_id=auth.uid() and gm.kind=''observer''))',t,t);
   execute format('create policy guests_cannot_update on public.%I as restrictive for update to authenticated using (not exists(select 1 from public.game_members gm where gm.game_id=%I.game_id and gm.user_id=auth.uid() and gm.kind=''observer'')) with check(not exists(select 1 from public.game_members gm where gm.game_id=%I.game_id and gm.user_id=auth.uid() and gm.kind=''observer''))',t,t,t);
   execute format('create policy guests_cannot_delete on public.%I as restrictive for delete to authenticated using(not exists(select 1 from public.game_members gm where gm.game_id=%I.game_id and gm.user_id=auth.uid() and gm.kind=''observer''))',t,t);
  end if;
 end loop;
end;
$$;