-- Baseline offices accumulate. Joining KSRF never removes earlier or later offices.
-- All students become GD deputies when the game reaches stage 4.
-- Mandate voting weight still comes exclusively from party_member_mandates.

create or replace function private.seed_republic_base_offices_for_game(p_game uuid)
returns void language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $function$
declare v_owner uuid;v_stage integer;
begin
 select owner_id,current_round into v_owner,v_stage from public.games where id=p_game;
 if v_owner is null then raise exception 'У игры отсутствует уполномоченный руководитель';end if;
 insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 select m.game_id,m.user_id,'Член КСРФ','active',v_owner,v_owner,
 'Автоматическое членство с момента вступления в игру',false
 from public.game_members m where m.game_id=p_game and m.kind='student' and m.roster_archived_at is null
 on conflict(game_id,user_id,role_title) where status<>'ended' do nothing;

 if v_stage>=4 then
  insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
  select m.game_id,m.user_id,'Депутат Государственной Думы','active',v_owner,v_owner,
   'Автоматическое депутатское полномочие после парламентских выборов',false
  from public.game_members m where m.game_id=p_game and m.kind='student' and m.roster_archived_at is null
  on conflict(game_id,user_id,role_title) where status<>'ended' do nothing;
 end if;
end $function$;
revoke all on function private.seed_republic_base_offices_for_game(uuid) from public,anon,authenticated;

create or replace function private.republic_offices_on_join()
returns trigger language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $function$
begin
 if new.kind='student' and new.roster_archived_at is null then
  perform private.seed_republic_base_offices_for_game(new.game_id);
 end if;
 return new;
end $function$;
drop trigger if exists trg_republic_offices_on_join on public.game_members;
create trigger trg_republic_offices_on_join
 after insert or update of kind,roster_archived_at on public.game_members
 for each row execute function private.republic_offices_on_join();

create or replace function private.republic_offices_after_parliament()
returns trigger language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $function$
begin
 if new.current_round>=4 and (old.current_round is null or old.current_round<4) then
  perform private.seed_republic_base_offices_for_game(new.id);
 end if;
 return new;
end $function$;
drop trigger if exists trg_republic_offices_after_parliament on public.games;
create trigger trg_republic_offices_after_parliament
 after update of current_round on public.games for each row
 execute function private.republic_offices_after_parliament();

-- Backfill only already-eligible active students; nothing is deleted.
do $backfill$
declare g record;
begin
 for g in select distinct game_id from public.game_members
    where kind='student' and roster_archived_at is null loop
   perform private.seed_republic_base_offices_for_game(g.game_id);
 end loop;
end $backfill$;
