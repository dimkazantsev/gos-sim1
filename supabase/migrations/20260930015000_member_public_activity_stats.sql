-- Public profiles may expose aggregated participation, never private activity payloads.
create or replace function public.get_member_public_stats(p_game_id uuid,p_user_id uuid)
returns table(accepted_actions bigint,posts bigint,votes_cast bigint,documents_created bigint,activity_entries bigint,events_decided bigint)
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 if not exists(select 1 from public.game_members m where m.game_id=p_game_id and m.user_id=p_user_id)
 then raise exception 'Player is not a member of this game';end if;
 return query select
 (select count(*) from public.player_actions a where a.game_id=p_game_id and a.author_id=p_user_id and a.status='accepted'),
 (select count(*) from public.political_posts p where p.game_id=p_game_id and p.author_id=p_user_id),
 (select count(*) from public.game_ballots b join public.game_votes v on v.id=b.vote_id where v.game_id=p_game_id and b.voter_id=p_user_id),
 (select count(*) from public.formal_documents d where d.game_id=p_game_id and d.author_id=p_user_id),
 (select count(*) from public.game_activity t where t.game_id=p_game_id and t.actor_id=p_user_id),
 (select count(*) from public.event_decisions e where e.game_id=p_game_id and e.actor_id=p_user_id);
end;
$$;
revoke all on function public.get_member_public_stats(uuid,uuid) from public,anon;
grant execute on function public.get_member_public_stats(uuid,uuid) to authenticated;
