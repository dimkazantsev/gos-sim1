create or replace function public.open_government_session(p_session_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.government_sessions%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into s from public.government_sessions where id=p_session_id for update;
 if s.id is null then raise exception 'Заседание не найдено'; end if;
 if not private.can_manage_government_session(s.game_id,v_uid) then raise exception 'Недостаточно прав на открытие заседания'; end if;
 if s.status<>'draft' then raise exception 'Заседание уже открыто или завершено'; end if;
 if not exists(select 1 from public.government_session_questions where session_id=s.id)
    and not exists(select 1 from public.government_program_agenda where session_id=s.id) then
    raise exception 'Добавьте хотя бы один вопрос повестки';
 end if;
 update public.government_sessions set status='open',opened_at=now(),chair_user_id=v_uid where id=s.id;
end;$$;
revoke all on function public.open_government_session(uuid) from public,anon;
grant execute on function public.open_government_session(uuid) to authenticated;