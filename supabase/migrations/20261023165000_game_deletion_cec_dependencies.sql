-- Complete irreversible deletion of one archived and explicitly confirmed game.
-- The 2026-10 CEC tables do not cascade from games; their rows must be
-- removed in child-to-parent order *inside the same transaction*.
-- Do not call this RPC from migrations: it must only run after an authenticated
-- owner/admin supplied the exact code, and after media has been removed.
create or replace function public.delete_game_permanently(p_game uuid,p_code text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
 target public.games%rowtype;
 remaining bigint;
begin
 select * into target from public.games where id=p_game for update;
 if target.id is null then raise exception 'Игра не найдена';end if;
 if target.owner_id<>auth.uid() and not private.is_platform_admin()
 then raise exception 'Удаление доступно владельцу или администратору';end if;
 if upper(trim(p_code))<>target.game_code then raise exception 'Введите точный код сеанса';end if;
 if target.status<>'archived' then raise exception 'Сначала сохраните архив и остановите сеанс';end if;

 -- Never remove database records while game media still exists.
 select count(*) into remaining from storage.objects
 where bucket_id in ('game-assets','game-media')
   and name like p_game::text||'/%';
 if remaining>0 then raise exception 'Остались не удалённые файлы: %',remaining;end if;

 -- First, referrals referencing complaints. Then remove the complaints
 -- that reference games and presidential candidates. Both tables have
 -- NO ACTION foreign keys, so the generic games cascade alone fails.
 delete from public.presidential_cec_court_referrals where game_id=p_game;
 delete from public.presidential_cec_complaints where game_id=p_game;

 -- Existing private login and retired event cleanup stays scoped to this game.
 delete from public.member_login_emails where game_id=p_game;
 delete from public.retired_event_cases where game_id=p_game;
 delete from public.games where id=p_game;
 return true;
end
$function$;

revoke all on function public.delete_game_permanently(uuid,text) from public,anon;
grant execute on function public.delete_game_permanently(uuid,text) to authenticated;
