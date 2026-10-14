-- Cross-module guard for records with an explicit stage. The first stage guard
-- covers parties and NPA; this one protects votes, ballots and state programs.
-- Do not infer a stage for general political-process posts without stage metadata.
create or replace function private.guard_stage_bound_write()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public','private','pg_temp'
as $fn$
declare v_game uuid;v_stage integer;v_vote uuid;
begin
 if tg_table_name='game_ballots' then
  v_vote:=new.vote_id;
  select gv.game_id,gv.stage_no into v_game,v_stage
   from public.game_votes gv where gv.id=v_vote;
  if v_game is null then raise exception 'Unknown vote' using errcode='23503';end if;
 else
  v_game:=new.game_id;
  v_stage:=new.stage_no;
  if tg_op='UPDATE' and (new.game_id is distinct from old.game_id
    or new.stage_no is distinct from old.stage_no) then
   raise exception 'Cannot move a record between stages' using errcode='42501';
  end if;
 end if;
 if auth.uid() is null or private.is_game_teacher(v_game) then return new;end if;
 if not exists(select 1 from public.game_members m
   where m.game_id=v_game and m.user_id=auth.uid() and m.kind='student'
    and m.roster_archived_at is null) then
  raise exception 'Student membership required' using errcode='42501';
 end if;
 -- A global vote without a stage remains governed by its own role and vote RPC.
 if v_stage is null then return new;end if;
 if not exists(select 1 from public.game_stages s where s.game_id=v_game
   and s.stage_no=v_stage and s.status='open'
   and (s.deadline is null or s.deadline>clock_timestamp())) then
  raise exception 'Этап завершён или ещё не открыт. Изменения недоступны.' using errcode='42501';
 end if;
 return new;
end $fn$;
revoke all on function private.guard_stage_bound_write() from public,anon,authenticated;

drop trigger if exists guard_vote_stage_write on public.game_votes;
create trigger guard_vote_stage_write before insert or update on public.game_votes
 for each row execute function private.guard_stage_bound_write();
drop trigger if exists guard_ballot_stage_write on public.game_ballots;
create trigger guard_ballot_stage_write before insert or update on public.game_ballots
 for each row execute function private.guard_stage_bound_write();
drop trigger if exists guard_state_program_stage_write on public.state_programs;
create trigger guard_state_program_stage_write before insert or update on public.state_programs
 for each row execute function private.guard_stage_bound_write();
