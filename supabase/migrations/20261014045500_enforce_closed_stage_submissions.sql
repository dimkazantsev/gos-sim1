-- Enforce stage completion in PostgreSQL, not only disabled UI controls.
-- Teacher / backend (auth.uid() IS NULL) may perform justified corrections.
create or replace function private.guard_stage_submission()
returns trigger language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $fn$
declare
 v_game uuid:=case when tg_op='DELETE' then old.game_id else new.game_id end;
 v_stage integer;
begin
 if auth.uid() is null or private.is_game_teacher(v_game) then
  if tg_op='DELETE' then return old;end if;
  return new;
 end if;
 if tg_table_name='party_documents' or tg_table_name='party_invitations' then
  v_stage:=1;
 elsif tg_table_name='formal_documents' then
  v_stage:=case when tg_op='DELETE' then old.stage_no else new.stage_no end;
 else
  raise exception 'Unsupported stage guard' using errcode='22023';
 end if;
 if not exists(select 1 from public.game_members gm
     where gm.game_id=v_game and gm.user_id=auth.uid() and gm.kind='student'
      and gm.roster_archived_at is null) then
  raise exception 'Student membership required' using errcode='42501';
 end if;
 if not exists(select 1 from public.game_stages st
   where st.game_id=v_game and st.stage_no=v_stage and st.status='open'
    and (st.deadline is null or st.deadline>clock_timestamp())) then
  raise exception 'Этап завершён или ещё не открыт. Изменения недоступны.' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $fn$;
drop trigger if exists guard_party_documents_stage on public.party_documents;
create trigger guard_party_documents_stage before insert or delete on public.party_documents
 for each row execute function private.guard_stage_submission();
drop trigger if exists guard_party_invitations_stage on public.party_invitations;
create trigger guard_party_invitations_stage before insert or update of status on public.party_invitations
 for each row execute function private.guard_stage_submission();
drop trigger if exists guard_formal_documents_stage on public.formal_documents;
create trigger guard_formal_documents_stage before insert or update on public.formal_documents
 for each row execute function private.guard_stage_submission();
