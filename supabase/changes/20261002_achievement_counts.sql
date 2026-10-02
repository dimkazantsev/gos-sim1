create or replace function public.get_achievement_catalog_counts(p_game_id uuid) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к наградам этой игры.';end if;
 return (select jsonb_build_object('total',count(*),'open',count(*) filter(where not coalesce(s.hidden,c.hidden)),'hidden',count(*) filter(where coalesce(s.hidden,c.hidden))) from private.achievement_catalog c left join game_achievement_settings s on s.game_id=p_game_id and s.achievement_id=c.id);
end$$;
revoke all on function public.get_achievement_catalog_counts(uuid) from public,anon;
grant execute on function public.get_achievement_catalog_counts(uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.claim_achievement_notification(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare a game_achievements%rowtype;c private.achievement_catalog%rowtype;begin
 if not exists(select 1 from game_members where game_id=p_game_id and user_id=auth.uid() and kind='student') then return null;end if;
 select * into a from game_achievements where game_id=p_game_id and user_id=auth.uid() and notified_at is null order by earned_at,achievement_id limit 1 for update skip locked;
 if not found then return null;end if;
 update game_achievements set notified_at=clock_timestamp() where game_id=a.game_id and user_id=a.user_id and achievement_id=a.achievement_id;
 select * into c from private.achievement_catalog where id=a.achievement_id;return jsonb_build_object('id',c.id,'title',c.title,'description',c.description,'hidden',coalesce((select hidden from game_achievement_settings where game_id=p_game_id and achievement_id=c.id),c.hidden));
end$function$
