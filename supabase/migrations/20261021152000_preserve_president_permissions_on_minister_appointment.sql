-- Stage 9: prevent overwriting the active Presidential primary role with a ministry title.
-- All appointment status, votes, decrees, roles and procedures remain unchanged.
CREATE OR REPLACE FUNCTION public.appoint_government_nominee(p_nomination_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$;
declare
 n public.government_nominations%rowtype;
 v_uid uuid:=(select auth.uid());
 v_role text;
 v_unit_key text;
 v_doc uuid;
begin
 select * into n from public.government_nominations where id=p_nomination_id for update;
 if n.id is null then raise exception 'Nomination not found'; end if;
 if n.office_kind='central_bank_chair' then raise exception 'The Chair of the Bank of Russia is appointed by the State Duma vote itself'; end if;
 if v_uid is null or not private.is_game_member(n.game_id) then raise exception 'Game access required';end if;
 v_role:=coalesce(private.game_role(n.game_id,v_uid),'');
 if not private.is_game_teacher(n.game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;
 if n.route in ('president_to_duma','pm_to_duma') and n.status<>'approved' then raise exception 'Duma approval is required before appointment'; end if;
 if n.route='president_after_sf' and n.status<>'consulted' then raise exception 'Federation Council consultation must be recorded first'; end if;

 v_doc:=private.stage8_create_appointment_decree(n.id);

 update public.government_nominations set status='appointed',appointed_at=now(),updated_at=now(),appointment_document_id=coalesce(appointment_document_id,v_doc) where id=n.id;
 if n.candidate_user_id is not null then
  update public.game_members m
  set role_title=case when exists(
    select 1 from public.game_office_assignments a
    where a.game_id=n.game_id and a.user_id=n.candidate_user_id
      and a.status='active'
      and lower(trim(a.role_title))='президент российской федерации'
  ) then 'Президент Российской Федерации' else n.office_title end
  where m.game_id=n.game_id and m.user_id=n.candidate_user_id;
  if n.office_key like 'ministry_%' then
   v_unit_key:=substring(n.office_key from 10);
   update public.institution_units set head_user_id=n.candidate_user_id
   where game_id=n.game_id and unit_kind='ministry' and unit_key=v_unit_key;
  end if;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(n.game_id,n.stage_no,'Формирование Правительства','notice','Назначение · '||n.office_title,n.candidate_name,v_uid);
end;
$function$;


CREATE OR REPLACE FUNCTION public.appoint_government_nominee_after_three_rejections(p_nomination_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$;
declare
 n public.government_nominations%rowtype;
 v_uid uuid:=(select auth.uid());
 v_role text;
 v_rejections integer;
 v_unit_key text;
 v_doc uuid;
begin
 select * into n from public.government_nominations where id=p_nomination_id for update;
 if n.id is null then raise exception 'Nomination not found'; end if;
 if n.status<>'rejected' then raise exception 'Only a rejected nomination can be appointed under the three-rejection rule'; end if;
 if n.office_kind not in ('prime_minister','deputy_pm','duma_minister') then raise exception 'The three-rejection appointment rule does not apply to this office'; end if;
 if v_uid is null or not private.is_game_member(n.game_id) then raise exception 'Game access required';end if;
 v_role:=coalesce(private.game_role(n.game_id,v_uid),'');
 if not private.is_game_teacher(n.game_id) and v_role not like '%президент%' then raise exception 'President role required'; end if;

 select count(*)::integer into v_rejections
 from public.government_nominations
 where game_id=n.game_id and office_key=n.office_key and status='rejected';
 if v_rejections<3 then raise exception 'Three Duma rejections are required'; end if;

 v_doc:=private.stage8_create_appointment_decree(n.id);

 update public.government_nominations
 set status='appointed',appointed_at=now(),decided_at=coalesce(decided_at,now()),updated_at=now(),
     appointment_document_id=coalesce(appointment_document_id,v_doc),
     note=trim(both from concat_ws(E'\n',nullif(note,''),'Назначено Президентом после трёх отклонений Государственной Думой.'))
 where id=n.id;

 if n.candidate_user_id is not null then
  update public.game_members m
  set role_title=case when exists(
    select 1 from public.game_office_assignments a
    where a.game_id=n.game_id and a.user_id=n.candidate_user_id
      and a.status='active'
      and lower(trim(a.role_title))='президент российской федерации'
  ) then 'Президент Российской Федерации' else n.office_title end
  where m.game_id=n.game_id and m.user_id=n.candidate_user_id;
  if n.office_key like 'ministry_%' then
   v_unit_key:=substring(n.office_key from 10);
   update public.institution_units set head_user_id=n.candidate_user_id
   where game_id=n.game_id and unit_kind='ministry' and unit_key=v_unit_key;
  end if;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(n.game_id,n.stage_no,'Формирование Правительства','notice','Назначение после трёх отклонений · '||n.office_title,n.candidate_name,v_uid);
end;
$function$;



-- Correct only a current Presidential primary profile backed by the active office register.
-- Do not modify minister nominations, official appointments, documents, scores or ballots.
DO $repair$
DECLARE
  v_game uuid := '52297def-d24d-4ba9-8049-5078b1b3bd45'::uuid;
  v_count integer;
  v_changes integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.game_office_assignments a
  JOIN public.game_members m ON m.game_id=a.game_id AND m.user_id=a.user_id
  WHERE a.game_id=v_game AND a.status='active'
    AND lower(trim(a.role_title))='президент российской федерации'
    AND m.kind='student' AND m.roster_archived_at IS NULL;
  IF v_count<>1 THEN
    RAISE EXCEPTION 'Presidential incumbent cannot be uniquely resolved; no role repaired';
  END IF;
  UPDATE public.game_members m
  SET role_title='Президент Российской Федерации'
  FROM public.game_office_assignments a
  WHERE a.game_id=v_game AND a.status='active'
    AND lower(trim(a.role_title))='президент российской федерации'
    AND a.game_id=m.game_id AND a.user_id=m.user_id
    AND m.kind='student' AND m.roster_archived_at IS NULL
    AND m.role_title IS DISTINCT FROM 'Президент Российской Федерации';
  GET DIAGNOSTICS v_changes=ROW_COUNT;
  IF v_changes>1 THEN
    RAISE EXCEPTION 'Unexpected multiple presidential role changes';
  END IF;
  IF v_changes=1 THEN
    INSERT INTO public.audit_log(game_id,actor_id,action,entity_type,payload)
    VALUES(v_game,NULL,'restore_president_primary_role_after_ministry','game_members',
       jsonb_build_object('reason','active office assignment had been overwritten by ministry appointment',
         'changed_profile_count',v_changes,'appointment_records_unchanged',true));
  END IF;
END $repair$;
