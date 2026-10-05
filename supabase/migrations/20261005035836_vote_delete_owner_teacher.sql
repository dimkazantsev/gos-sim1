-- Secure vote deletion for the vote author and the game teacher.
-- Applied to production as migration 20261005035836.

drop policy if exists "guests_cannot_delete" on public.game_votes;
drop policy if exists "game_votes_delete_owner_or_teacher" on public.game_votes;

create policy "game_votes_delete_owner_or_teacher"
on public.game_votes
for delete
to authenticated
using (
  created_by = (select auth.uid())
  or private.is_game_teacher(game_id)
);

-- Clients delete votes only through the permission-checked RPC below.
revoke delete on table public.game_votes from authenticated;

create or replace function public.delete_procedural_vote(p_vote_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v public.game_votes%rowtype;
begin
  select * into v
  from public.game_votes
  where id = p_vote_id
  for update;

  if v.id is null or v_uid is null or not private.is_game_member(v.game_id) then
    raise exception 'Нет доступа к голосованию';
  end if;

  if not (
    v.created_by = v_uid
    or private.is_game_teacher(v.game_id)
  ) then
    raise exception 'Удалить голосование может только его автор или преподаватель';
  end if;

  if v.status = 'open' then
    update public.parliamentary_election_rules
       set vote_id = null, status = 'draft', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.regional_election_rules
       set vote_id = null, status = 'draft', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.ghost_voting_policies
       set vote_id = null, status = 'draft', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.presidential_system_proposals
       set vote_id = null, status = 'draft', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.government_nominations
       set vote_id = null, status = 'submitted', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.municipal_projects
       set vote_id = null, status = 'submitted', updated_at = now()
     where vote_id = v.id and status = 'vote_open';

    update public.government_program_agenda
       set vote_id = null, status = 'presenting', completed_at = null, result_note = null
     where vote_id = v.id and status = 'decision';

    update public.state_programs
       set government_vote_id = null, status = 'ready', updated_at = now()
     where government_vote_id = v.id and status = 'government_vote';

    update public.party_agreements
       set target_vote_id = null,
           status = case when status in ('proposed','accepted') then 'expired' else status end,
           resolved_at = case when status in ('proposed','accepted') then now() else resolved_at end
     where target_vote_id = v.id;
  end if;

  update public.budget_faction_amendments
     set vote_id = null
   where vote_id = v.id;

  delete from public.game_votes where id = v.id;

  return found;
end;
$function$;

revoke all on function public.delete_procedural_vote(uuid) from public;
revoke all on function public.delete_procedural_vote(uuid) from anon;
grant execute on function public.delete_procedural_vote(uuid) to authenticated;
