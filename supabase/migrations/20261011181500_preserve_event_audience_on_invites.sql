-- Preserve original case audience when a colleague accepts an invitation.
-- Accompanying guard permits invitees only under the existing collaboration rules.
create or replace function private.guard_event_assignment()
returns trigger language plpgsql security definer set search_path='public','private','pg_temp' as $$
declare c public.event_cases%rowtype; assigned integer; invited boolean;
begin
 select * into c from public.event_cases where id=new.case_id for update;
 if c.id is null or c.game_id<>new.game_id then raise exception 'Событие другой игры недоступно';end if;
 if not exists(select 1 from public.game_members where game_id=new.game_id and user_id=new.recipient_id and kind='student')
 then raise exception 'Получателем должен быть участник этой игры';end if;
 if tg_op='INSERT' then
  if c.status<>'ready' or exists(select 1 from public.event_case_outcomes where case_id=c.id)
  then raise exception 'Нельзя назначать архивное или завершённое событие';end if;
  if exists(select 1 from public.event_decisions where case_id=c.id)
  then raise exception 'После начала голосования состав участников не меняется';end if;
  select count(*) into assigned from public.event_assignments where case_id=c.id and recipient_id<>new.recipient_id;
  invited:=exists(select 1 from public.event_collaboration_invites
    where case_id=c.id and recipient_id=new.recipient_id and status='accepted');
  if c.audience='single' and ((not invited and assigned>=1) or (invited and assigned>=3))
  then raise exception 'Все места в этом событии уже назначены';end if;
  if c.audience='group' and assigned>=3
  then raise exception 'Все места в этом событии уже назначены';end if;
 end if;
 if tg_op='UPDATE' and (new.game_id<>old.game_id or new.case_id<>old.case_id or new.recipient_id<>old.recipient_id)
 then raise exception 'Назначение нельзя перенести другому участнику';end if;
 if tg_op='UPDATE' and new.status='pending' and exists(select 1 from public.event_case_outcomes where case_id=c.id)
 then raise exception 'Голосование уже завершено';end if;
 return new;
end $$;
create or replace function public.respond_event_invitation(p_id uuid,p_accept boolean)
returns void language plpgsql security definer set search_path='public','private','pg_temp' as $$
declare i public.event_collaboration_invites%rowtype;
begin
 select * into i from public.event_collaboration_invites where id=p_id and recipient_id=auth.uid();
 if i.id is null then raise exception 'Приглашение недоступно';end if;
 perform 1 from public.event_cases where id=i.case_id for update;
 select * into i from public.event_collaboration_invites where id=p_id for update;
 if i.status<>'pending' or exists(select 1 from public.event_decisions where case_id=i.case_id)
 then raise exception 'Приглашение уже закрыто';end if;
 if p_accept then
  -- Assignment is first: failure rolls back the invitation transaction too.
  update public.event_collaboration_invites set status='accepted',responded_at=now() where id=p_id;
  insert into public.event_assignments(case_id,game_id,recipient_id,created_by)
  values(i.case_id,i.game_id,auth.uid(),i.inviter_id) on conflict do nothing;
 else
  update public.event_collaboration_invites set status='declined',responded_at=now() where id=p_id;
 end if;
end $$;
