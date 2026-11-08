-- Archived students do not receive or retain a share of the party's seats.
-- Preserve all Goust Voting / representation deductions and the existing
-- teacher authorization, quota and historical-vote guarantees.
do $archive_mandates$
declare src text;patched text;party_row record;
begin
 select pg_get_functiondef('private.rebalance_party_mandates(uuid)'::regprocedure) into src;
 if position('m.roster_archived_at is null' in src)=0 then
  if position('m.team=p.name' in src)=0 or position('kind=''student'' and team=p.name' in src)=0 then
   raise exception 'Unexpected party mandate allocator; manual review required';
  end if;
  patched:=replace(src,'m.team=p.name','m.team=p.name and m.roster_archived_at is null');
  patched:=replace(patched,'kind=''student'' and team=p.name','kind=''student'' and team=p.name and roster_archived_at is null');
  execute patched;
 end if;

 select pg_get_functiondef('public.set_student_mandates(uuid,jsonb)'::regprocedure) into src;
 if position('m.roster_archived_at is null' in src)=0 then
  if position('and team=p.name)' in src)=0 or position('m.team=p.name' in src)=0 then
   raise exception 'Unexpected mandate editing RPC; manual review required';
  end if;
  patched:=replace(src,'m.team=p.name','m.team=p.name and m.roster_archived_at is null');
  patched:=replace(patched,'and team=p.name)','and team=p.name and roster_archived_at is null)');
  execute patched;
 end if;

 -- Keep existing trigger function and its privileges, add archive transitions.
 if not exists (
  select 1 from pg_trigger t where t.tgrelid='public.game_members'::regclass
   and t.tgname='trg_rebalance_member_party'
   and pg_get_triggerdef(t.oid) like '%roster_archived_at%'
 ) then
  drop trigger if exists trg_rebalance_member_party on public.game_members;
  create trigger trg_rebalance_member_party
   after insert or delete or update of team,party_joined_at,roster_archived_at
   on public.game_members for each row
   execute function private.rebalance_member_party_trigger();
 end if;

 -- Correct only factions with stale archived-member allocations.
 -- Never change an electorate while its State Duma vote is open.
 for party_row in
  select distinct p.id,p.game_id
  from public.game_parties p
  join public.party_member_mandates a on a.party_id=p.id
  join public.game_members m on m.game_id=p.game_id and m.user_id=a.user_id
  where m.roster_archived_at is not null
    and not private.has_open_duma_mandate_vote(p.game_id)
 loop
  perform private.rebalance_party_mandates(party_row.id);
 end loop;
end $archive_mandates$;
