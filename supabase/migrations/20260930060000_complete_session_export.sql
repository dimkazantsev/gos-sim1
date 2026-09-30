-- Include join tables and retired cases in a portable data backup.
create or replace function public.export_game_data(p_game uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t record;tables jsonb:='{}'::jsonb;rows jsonb;record_game jsonb;
begin
 if not private.is_game_teacher(p_game) then raise exception 'Доступ преподавателя обязателен';end if;
 select to_jsonb(g) into record_game from public.games g where id=p_game;
 if record_game is null then raise exception 'Игра не найдена';end if;
 for t in select table_name from information_schema.columns where table_schema='public' and column_name='game_id'
 and table_name not in ('invite_codes','member_login_emails') and table_name in(select tablename from pg_tables where schemaname='public') order by table_name loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from public.%I x where x.game_id=$1',t.table_name) into rows using p_game;
  tables:=tables||jsonb_build_object(t.table_name,rows);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) into rows from public.game_ballots b join public.game_votes v on v.id=b.vote_id where v.game_id=p_game;
 tables:=tables||jsonb_build_object('game_ballots',rows);
 select coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) into rows from public.channel_members m join public.chat_channels c on c.id=m.channel_id where c.game_id=p_game;
 tables:=tables||jsonb_build_object('channel_members',rows);
 return jsonb_build_object('format','GOS-SIMS','schema',2,'exported_at',now(),'game',record_game,'tables',tables,'note','Пароли, коды приглашений и адреса входа исключены. Файлы находятся в архиве Media.');
end;$$;

-- Two legacy tables lack cascading game foreign keys. Remove only the selected
-- session's rows, after the same owner/admin, code and media checks as before.
create or replace function public.delete_game_permanently(p_game uuid,p_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare target public.games%rowtype;remaining bigint;
begin
 select * into target from public.games where id=p_game for update;
 if target.id is null then raise exception 'Игра не найдена';end if;
 if target.owner_id<>auth.uid() and not private.is_platform_admin() then raise exception 'Удаление доступно владельцу или администратору';end if;
 if upper(trim(p_code))<>target.game_code then raise exception 'Введите точный код сеанса';end if;
 if target.status<>'archived' then raise exception 'Сначала сохраните архив и остановите сеанс';end if;
 select count(*) into remaining from storage.objects where bucket_id in ('game-assets','game-media') and name like p_game::text||'/%';
 if remaining>0 then raise exception 'Остались не удалённые файлы: %',remaining;end if;
 delete from public.member_login_emails where game_id=p_game;
 delete from public.retired_event_cases where game_id=p_game;
 delete from public.games where id=p_game;
 return true;
end;$$;
