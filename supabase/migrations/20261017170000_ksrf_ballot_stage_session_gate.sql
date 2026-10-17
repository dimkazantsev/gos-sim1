-- Enforce KSRF meeting readiness at ballot and vote database write boundaries.
-- Applies only to stages 2/3 and only KSRF, without touching other organs.
CREATE OR REPLACE FUNCTION private.guard_stage_bound_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
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
 -- Stage 2/3 KSRF actions require BOTH an approved agenda AND personal check-in.
 -- Retain stage-window checks above and teacher administrative override.
 if v_stage in (2,3) then
  if tg_table_name='game_votes' then
   if new.institution_key='ksrf' then
    perform private.require_game_meeting_registration(v_game,auth.uid(),v_stage,'ksrf');
   end if;
  elsif tg_table_name='game_ballots' then
   if exists(select 1 from public.game_votes gv where gv.id=v_vote and gv.institution_key='ksrf') then
    perform private.require_game_meeting_registration(v_game,auth.uid(),v_stage,'ksrf');
   end if;
  end if;
 end if;
 return new;
end $function$

