-- Enforce read-only observer status even for SECURITY DEFINER procedures and API calls.
create or replace function private.prevent_observer_mutation()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare target_game uuid;uid uuid:=auth.uid();
begin
 if uid is null then return case when tg_op='DELETE' then old else new end;end if;
 target_game:=case when tg_op='DELETE' then old.game_id else new.game_id end;
 if exists(select 1 from public.game_members where game_id=target_game and user_id=uid and kind='observer')
 then raise exception 'Guests can view the game but cannot change it';end if;
 return case when tg_op='DELETE' then old else new end;
end;
$$;
do $$
declare t text;
begin
 foreach t in array array[
  'player_actions','political_posts','chat_messages','formal_documents','game_votes',
  'game_ballots','game_events','game_parties','party_documents','event_cases',
  'event_assignments','event_decisions','game_activity','game_profiles','game_stages',
  'state_metrics','state_metric_history','game_evaluations','stage_assessments',
  'party_agreements','party_invitations','party_member_mandates','game_crises',
  'game_documents','formal_document_history','game_presence','political_decisions'
 ] loop
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='game_id') then
  execute format('drop trigger if exists guard_observer_write on public.%I',t);
  execute format('create trigger guard_observer_write before insert or update or delete on public.%I for each row execute function private.prevent_observer_mutation()',t);
 end if;
 end loop;
end;
$$;