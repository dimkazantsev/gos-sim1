-- Export and irreversible deletion of a single owned game; never infer ownership from a displayed name.
create policy games_platform_admin_read on public.games for select to authenticated
 using(private.is_platform_admin());
create policy games_platform_admin_update on public.games for update to authenticated
 using(private.is_platform_admin()) with check(private.is_platform_admin());
create policy game_media_teacher_delete on storage.objects for delete to authenticated
 using(bucket_id='game-media' and private.is_game_teacher((split_part(name,'/',1))::uuid));
create policy game_media_teacher_list on storage.objects for select to authenticated
 using(bucket_id='game-media' and private.is_game_teacher((split_part(name,'/',1))::uuid));
create or replace function public.export_game_data(p_game uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare t record;tables jsonb:='{}'::jsonb;rows jsonb;record_game jsonb;
begin
 if not private.is_game_teacher(p_game) then raise exception 'Teacher access required';end if;
 select to_jsonb(g) into record_game from public.games g where g.id=p_game;
 if record_game is null then raise exception 'Game not found';end if;
 for t in select table_name from information_schema.columns where table_schema='public' and column_name='game_id'
  and table_name not in ('invite_codes','member_login_emails','retired_event_cases')
  and table_name in (select tablename from pg_tables where schemaname='public')
  order by table_name loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from public.%I x where x.game_id=$1',t.table_name)
    into rows using p_game;
  tables:=tables||jsonb_build_object(t.table_name,rows);
 end loop;
 return jsonb_build_object('format','GOS-SIMS','schema',1,'exported_at',now(),
  'game',record_game,'tables',tables,'note',
  'Users must create new Auth accounts after restoration. Invite codes, password hashes and private emails are excluded. Binary files are in the companion media archive.');
end;
$$;
revoke all on function public.export_game_data(uuid) from public,anon;
grant execute on function public.export_game_data(uuid) to authenticated;
create or replace function public.prepare_game_deletion(p_game uuid,p_code text)
returns boolean language plpgsql security definer set search_path=public,private,pg_temp as $$
declare target public.games%rowtype;
begin
 select * into target from public.games where id=p_game for update;
 if target.id is null then raise exception 'Game not found';end if;
 if target.owner_id<>auth.uid() and not private.is_platform_admin()
 then raise exception 'Only game owner or global administrator may remove a session';end if;
 if upper(trim(p_code))<>target.game_code then raise exception 'Type the exact game code';end if;
 update public.games set status='archived',turn_open=false,turn_ends_at=null where id=p_game;
 return true;
end;
$$;
revoke all on function public.prepare_game_deletion(uuid,text) from public,anon;
grant execute on function public.prepare_game_deletion(uuid,text) to authenticated;
create or replace function public.delete_game_permanently(p_game uuid,p_code text)
returns boolean language plpgsql security definer set search_path=public,private,pg_temp as $$
declare target public.games%rowtype;remaining bigint;
begin
 select * into target from public.games where id=p_game for update;
 if target.id is null then raise exception 'Game not found';end if;
 if target.owner_id<>auth.uid() and not private.is_platform_admin()
 then raise exception 'Only game owner or global administrator may remove a session';end if;
 if upper(trim(p_code))<>target.game_code then raise exception 'Type the exact game code';end if;
 if target.status<>'archived' then raise exception 'Archive session and export its data before deleting';end if;
 select count(*) into remaining from storage.objects o where o.bucket_id in ('game-assets','game-media')
  and o.name like p_game::text||'/%';
 if remaining>0 then raise exception 'Media cleanup incomplete: % objects remain',remaining;end if;
 delete from public.games where id=p_game;
 return true;
end;
$$;
revoke all on function public.delete_game_permanently(uuid,text) from public,anon;
grant execute on function public.delete_game_permanently(uuid,text) to authenticated;