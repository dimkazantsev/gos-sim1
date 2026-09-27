-- Complete lifecycle of binding pre-parliamentary faction agreements.

create or replace function private.party_agreement_vote_close_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
  if new.status='closed' and old.status is distinct from new.status then
    perform private.resolve_party_agreements_for_vote(new.id);
  end if;
  return new;
end;
$$;
revoke execute on function private.party_agreement_vote_close_trigger() from public,anon,authenticated;

drop trigger if exists trg_party_agreement_vote_close on public.game_votes;
create trigger trg_party_agreement_vote_close
after update of status on public.game_votes
for each row execute function private.party_agreement_vote_close_trigger();

create or replace function private.party_agreement_stage_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
begin
  if new.stage_no>=4 and new.status='open'
     and (old.status is distinct from new.status) then
    update public.party_agreements
       set status='expired',resolved_at=now()
     where game_id=new.game_id
       and status in ('proposed','accepted');
  end if;
  return new;
end;
$$;
revoke execute on function private.party_agreement_stage_trigger() from public,anon,authenticated;

drop trigger if exists trg_party_agreement_stage_open on public.game_stages;
create trigger trg_party_agreement_stage_open
after update of status on public.game_stages
for each row execute function private.party_agreement_stage_trigger();
