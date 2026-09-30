-- Capture roles assigned through existing game procedures, only when a concrete member changes.
-- Member UPDATE remains teacher-only under RLS; existing appointment RPCs enforce their own authority.
create or replace function private.capture_assigned_game_role() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare assigned_role text;actor uuid;
begin
 if new.kind<>'student' or nullif(trim(new.role_title),'') is null then return new;end if;
 select coalesce(auth.uid(),owner_id) into actor from public.games where id=new.game_id;
 for assigned_role in select trim(r) from unnest(string_to_array(new.role_title,' · ')) r loop
  if length(assigned_role) not between 2 and 180 or lower(assigned_role) in ('участник','студент','гость','наблюдатель','преподаватель','руководитель симуляции') then continue;end if;
  insert into public.game_office_assignments as o(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
  values(new.game_id,new.user_id,assigned_role,'active',actor,actor,'Назначение через процедуру игры; роль доступна для учебной ротации',true)
  on conflict(game_id,user_id,role_title) where status<>'ended'
  do update set status='active',approved_by=actor,legal_basis=excluded.legal_basis,educational_exception=true where o.status='pending';
 end loop;
 if position(' · ' in new.role_title)>0 then
  update public.game_members set role_title=split_part(new.role_title,' · ',1) where game_id=new.game_id and user_id=new.user_id;
 end if;
 return new;
end;$$;
revoke all on function private.capture_assigned_game_role() from public,anon,authenticated;
drop trigger if exists capture_assigned_game_role on public.game_members;
create trigger capture_assigned_game_role after insert or update of role_title,kind on public.game_members
for each row execute function private.capture_assigned_game_role();
