-- Keep the initial recipient set stable once voting starts.
create or replace function private.guard_event_assignment()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.event_cases%rowtype;assigned integer;
begin
 select * into c from public.event_cases where id=new.case_id for update;
 if c.id is null or c.game_id<>new.game_id then raise exception 'Событие другой игры недоступно';end if;
 if not exists(select 1 from public.game_members where game_id=new.game_id and user_id=new.recipient_id and kind='student')
 then raise exception 'Получателем должен быть участник этой игры';end if;
 if tg_op='INSERT' then
  if c.status<>'ready' or exists(select 1 from public.event_case_outcomes where case_id=c.id)
  then raise exception 'Нельзя назначать архивное или завершённое событие';end if;
  if exists(select 1 from public.event_decisions where case_id=c.id) and not exists(
   select 1 from public.event_assignments where case_id=c.id and recipient_id=new.recipient_id)
  then raise exception 'После начала голосования состав участников не меняется';end if;
  select count(*) into assigned from public.event_assignments where case_id=c.id and recipient_id<>new.recipient_id;
  if (c.audience='single' and assigned>=1) or (c.audience='group' and assigned>=3)
  then raise exception 'Все места в этом событии уже назначены';end if;
 end if;
 if tg_op='UPDATE' and (new.game_id<>old.game_id or new.case_id<>old.case_id or new.recipient_id<>old.recipient_id)
 then raise exception 'Назначение нельзя перенести другому участнику';end if;
 if tg_op='UPDATE' and new.status='pending' and exists(select 1 from public.event_case_outcomes where case_id=c.id)
 then raise exception 'Голосование уже завершено';end if;
 return new;
end;
$$;
