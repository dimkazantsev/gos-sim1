create or replace function public.appoint_government_nominee_after_three_rejections(p_nomination_id uuid)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 n public.government_nominations%rowtype;
 v_uid uuid:=(select auth.uid());
 v_role text;
 v_rejections integer;
 v_unit_key text;
begin
 select * into n
 from public.government_nominations
 where id=p_nomination_id
 for update;

 if n.id is null then raise exception 'Nomination not found'; end if;
 if n.status<>'rejected' then raise exception 'Only a rejected nomination can be appointed under the three-rejection rule'; end if;
 if n.office_kind not in ('prime_minister','deputy_pm','duma_minister') then
   raise exception 'The three-rejection appointment rule does not apply to this office';
 end if;

 v_role:=private.game_role(n.game_id,v_uid);
 if not private.is_game_teacher(n.game_id) and v_role not like '%президент%' then
   raise exception 'President role required';
 end if;

 select count(*)::integer into v_rejections
 from public.government_nominations
 where game_id=n.game_id
   and office_key=n.office_key
   and status='rejected';

 if v_rejections<3 then
   raise exception 'Three Duma rejections are required';
 end if;

 update public.government_nominations
 set status='appointed',
     appointed_at=now(),
     decided_at=coalesce(decided_at,now()),
     updated_at=now(),
     note=trim(both from concat_ws(E'\n',nullif(note,''),'Назначено Президентом после трёх отклонений Государственной Думой.'))
 where id=n.id;

 if n.candidate_user_id is not null then
   update public.game_members
   set role_title=n.office_title
   where game_id=n.game_id and user_id=n.candidate_user_id;

   if n.office_key like 'ministry_%' then
     v_unit_key:=substring(n.office_key from 10);
     update public.institution_units
     set head_user_id=n.candidate_user_id
     where game_id=n.game_id
       and unit_kind='ministry'
       and unit_key=v_unit_key;
   end if;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(
   n.game_id,8,'Формирование Правительства','notice',
   'Назначение после трёх отклонений · '||n.office_title,
   n.candidate_name,
   v_uid
 );
end;
$$;

revoke all on function public.appoint_government_nominee_after_three_rejections(uuid) from public,anon;
grant execute on function public.appoint_government_nominee_after_three_rejections(uuid) to authenticated;
