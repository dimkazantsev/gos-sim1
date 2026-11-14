
-- A trigger shares several tables; branch by table name before referencing NEW's columns.
create or replace function private.prevent_observer_mutation()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp
as $body$
declare target_game uuid;uid uuid:=auth.uid();active_observer boolean;view_title text;
begin
 if uid is null then return case when tg_op='DELETE' then old else new end;end if;
 target_game:=case when tg_op='DELETE' then old.game_id else new.game_id end;
 select roster_archived_at is null into active_observer
 from public.game_members where game_id=target_game and user_id=uid and kind='observer';
 if found then
  if not active_observer then
   raise exception 'Guests can view the game but cannot change it' using errcode='42501';
  end if;
  if tg_table_name='game_presence' then
   if tg_op in ('INSERT','UPDATE') then
    if new.user_id=uid and new.current_view in
       ('dashboard','stages','parties','votes','documents','actions','grades','profile','events','budget','chat')
    then return new;end if;
   end if;
  elsif tg_table_name='game_activity' then
   if tg_op='INSERT' then
    if new.actor_id=uid and new.event_type='navigation'
       and new.view_key in
        ('dashboard','stages','parties','votes','documents','actions','grades','profile','events','budget','chat')
       and coalesce(new.payload,'{}'::jsonb)='{}'::jsonb then
     view_title:=case new.view_key when 'dashboard' then 'Обзор игры'
      when 'stages' then 'Этапы' when 'parties' then 'Партия'
      when 'votes' then 'Голосование' when 'documents' then 'НПА / Формальные институты'
      when 'actions' then 'Политический процесс' when 'grades' then 'Оценки'
      when 'profile' then 'Мой профиль' when 'events' then 'Ситуационные решения'
      when 'budget' then 'Бюджет' when 'chat' then 'Командный чат' end;
     if exists(select 1 from public.game_activity a
      where a.game_id=target_game and a.actor_id=uid and a.event_type='navigation'
       and a.created_at>clock_timestamp()-interval '8 seconds') then return null;end if;
     new.created_at:=clock_timestamp();new.label:='Открыл раздел «'||view_title||'»';
     new.payload:='{}'::jsonb;return new;
    end if;
   end if;
  end if;
  raise exception 'Guests can view the game but cannot change it' using errcode='42501';
 end if;
 return case when tg_op='DELETE' then old else new end;
end;$body$;
