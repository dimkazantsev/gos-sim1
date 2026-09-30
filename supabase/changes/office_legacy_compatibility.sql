create or replace function public.appoint_game_office(p_game uuid,p_user uuid,p_role text,p_basis text,p_exception boolean default false) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_teacher boolean;v_status text;v_id uuid;v_actor text;v_family text;
begin
 if auth.uid() is null or not exists(select 1 from public.game_members where game_id=p_game and user_id=auth.uid() and kind<>'observer') then raise exception 'Нет права назначения';end if;
 if not exists(select 1 from public.game_members where game_id=p_game and user_id=p_user and kind<>'observer') then raise exception 'Участник другой игры недоступен';end if;
 if length(trim(p_role)) not between 2 and 180 or length(trim(p_basis))<10 then raise exception 'Укажите должность и основание назначения';end if;
 v_teacher:=private.is_game_teacher(p_game);v_family:=private.office_family(p_role);
 select role_title into v_actor from public.game_members where game_id=p_game and user_id=auth.uid();
 if not v_teacher and not (
  (private.office_family(v_actor)='president' and v_family in ('government','central_bank')) or
  (lower(v_actor) like '%председатель%правительств%' and v_family='government') or
  (private.office_family(v_actor)='municipality' and v_family='municipality')
 ) then raise exception 'У этой должности нет права инициировать такое назначение';end if;
 if p_exception and not v_teacher then raise exception 'Учебное исключение утверждает преподаватель';end if;
 perform 1 from public.game_members where game_id=p_game and user_id=p_user for update;
 insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis)
 select p_game,p_user,trim(r),'active',auth.uid(),auth.uid(),'Перенос действующей должности текущего этапа без изменения полномочий'
 from public.game_members m cross join lateral unnest(string_to_array(m.role_title,' · ')) r
 where m.game_id=p_game and m.user_id=p_user and m.kind='student' and trim(r) not in ('','Участник','Гость','Преподаватель')
 and not exists(select 1 from public.game_office_assignments o where o.game_id=p_game and o.user_id=p_user and o.role_title=trim(r) and o.status<>'ended')
 on conflict do nothing;
 if not p_exception and exists(select 1 from (select role_title from public.game_office_assignments where game_id=p_game and user_id=p_user and status='active' union select unnest(string_to_array(role_title,' · ')) from public.game_members where game_id=p_game and user_id=p_user and kind='student') o where
  ((private.office_family(o.role_title) in ('gd','sf') and v_family in ('government','president','central_bank','municipality','court')) or
   (v_family in ('gd','sf') and private.office_family(o.role_title) in ('government','president','central_bank','municipality','court')) or
   (v_family in ('gd','sf') and private.office_family(o.role_title) in ('gd','sf') and v_family<>private.office_family(o.role_title))))
 then raise exception 'Несовместимые должности. Статья 97 Конституции РФ. Преподаватель может отдельно утвердить учебное исключение';end if;
 v_status:=case when v_teacher then 'active' else 'pending' end;
 insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 values(p_game,p_user,trim(p_role),v_status,auth.uid(),case when v_teacher then auth.uid() end,trim(p_basis),p_exception) returning id into v_id;
 if v_teacher then update public.game_members set role_title=(select string_agg(role_title,' · ' order by created_at) from public.game_office_assignments where game_id=p_game and user_id=p_user and status='active') where game_id=p_game and user_id=p_user;end if;
 return v_id;
end;$$;
