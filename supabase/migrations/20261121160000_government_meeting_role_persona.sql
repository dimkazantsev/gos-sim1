-- The old generated agenda is updated once inside an atomic migration.
-- Temporarily remove the role-name preservation inside this same transaction;
-- restore the exact protected definition before commit (not visible to clients).
CREATE OR REPLACE FUNCTION private.prepare_formal_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare n bigint;y integer;v_issuer text;suffix text;
begin
 if tg_op='UPDATE' then
  new.metadata:=(coalesce(new.metadata,'{}'::jsonb)-array['act_number','registered_on','signed_name','signed_role','signed_on','signed_by'])
   ||(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(coalesce(old.metadata,'{}'::jsonb)) where key=any(array['act_number','registered_on','signed_name','signed_role','signed_on','signed_by']));
  -- Only the signature-history trigger can add a real signer snapshot.
  if pg_trigger_depth()>1 then
   new.metadata:=new.metadata||coalesce(current_setting('app.formal_signature_snapshot',true),'{}')::jsonb;
  end if;
  -- For Ministry of Justice replies the signature office comes from the issuing
  -- institution, never from an unrelated active role of the game moderator.
  if new.subject_key='minjust' and new.doc_type in ('justice_response','party_certificate')
     and new.metadata ? 'signed_role' then
   new.metadata:=jsonb_set(new.metadata,'{signed_role}',to_jsonb('Директор Департамента по делам некоммерческих организаций Министерства юстиции Российской Федерации'::text),true);
  end if;
  return new;
 end if;
 v_issuer:=coalesce(nullif(trim(new.metadata->>'issuer_name'),''),new.subject_label);
 y:=extract(year from now() at time zone 'Asia/Novosibirsk');
 insert into private.formal_number_counters values(new.game_id,v_issuer,new.doc_type,y,1)
 on conflict(game_id,issuer,doc_type,year) do update set last_number=private.formal_number_counters.last_number+1 returning last_number into n;
 suffix:=case new.doc_type when 'fz_bill' then '-ФЗ' when 'fkz_bill' then '-ФКЗ' when 'federal_budget' then '-ФЗ' when 'gd_resolution' then '-ГД' when 'sf_resolution' then '-СФ' when 'government_order' then '-р' when 'president_order' then '-рп' else '' end;
 new.metadata:=(coalesce(new.metadata,'{}'::jsonb)-array['signed_name','signed_role','signed_on','signed_by','signature_name','signature_title'])
  ||jsonb_build_object('issuer_name',v_issuer,'act_number',n::text||suffix,'registered_on',now(),'number_year',y);
 return new;
end;$function$
;

-- Generated government agenda/minutes: use the existing Prime Minister's
-- role-specific nominee name, without an extra browser request or new entities.
-- Existing parliamentary documents retain the registered participant name.
UPDATE public.formal_documents d
SET metadata=coalesce(d.metadata,'{}'::jsonb)
 || jsonb_build_object(
  'acting_role_name',n.candidate_name,
  'acting_user_id',d.author_id,
  'acting_office_title',n.office_title
 ),updated_at=clock_timestamp()
FROM public.government_nominations n
JOIN public.game_office_assignments a ON a.game_id=n.game_id
 AND a.user_id=n.candidate_user_id AND a.role_title=n.office_title
 AND a.status='active'
JOIN public.game_members m ON m.game_id=n.game_id AND m.user_id=n.candidate_user_id
WHERE d.game_id=n.game_id
 AND d.author_id=n.candidate_user_id
 AND d.subject_key='government'
 AND d.doc_type IN ('meeting_agenda','minutes')
 AND d.metadata->>'institution_key'='government'
 AND n.office_kind='prime_minister' AND n.status='appointed'
 AND n.candidate_name IS DISTINCT FROM m.full_name
 AND d.metadata->>'acting_role_name' IS DISTINCT FROM n.candidate_name;

CREATE OR REPLACE FUNCTION private.validate_document_acting_office()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_office public.game_office_assignments%rowtype;
 v_uid uuid:=auth.uid();
 v_acting_id uuid;
 v_acting_user uuid;
 v_acting_role text;
 v_legacy text;
 v_role_name text;
begin
 -- Never trust a role name supplied by the client.
 new.metadata:=coalesce(new.metadata,'{}'::jsonb)-'acting_role_name';
 if not(new.metadata ? 'acting_office_title') then
   -- Generated government meeting records have no manually chosen office.
   -- Use the authenticated author's existing confirmed PM appointment.
   if new.subject_key='government'
      and new.doc_type in ('meeting_agenda','minutes')
      and new.metadata->>'institution_key'='government'
      and new.author_id is not null then
     select n.candidate_name,n.office_title into v_role_name,v_acting_role
     from public.government_nominations n
     join public.game_office_assignments a on a.game_id=n.game_id
       and a.user_id=n.candidate_user_id and a.role_title=n.office_title
       and a.status='active'
     join public.game_members m on m.game_id=n.game_id and m.user_id=n.candidate_user_id
     where n.game_id=new.game_id and n.candidate_user_id=new.author_id
       and n.office_kind='prime_minister' and n.status='appointed'
       and n.candidate_name is distinct from m.full_name
     order by n.appointed_at desc limit 1;
     if v_role_name is not null then
       new.metadata:=new.metadata||jsonb_build_object(
         'acting_role_name',v_role_name,
         'acting_user_id',new.author_id,
         'acting_office_title',v_acting_role);
     end if;
   end if;
   return new;
 end if;
 v_acting_role:=nullif(btrim(new.metadata->>'acting_office_title'),'');
 if v_acting_role is null then return new; end if;
 v_acting_id:=nullif(new.metadata->>'acting_office_id','')::uuid;
 v_acting_user:=nullif(new.metadata->>'acting_user_id','')::uuid;

 -- A teacher's administrative representation has no particular signatory;
 -- the existing RPC still controls which institutional subject can be used.
 if v_acting_user is null and v_acting_id is null then
   if not private.is_game_teacher(new.game_id) then
     raise exception 'Appointment must identify an authorized person' using errcode='42501';
   end if;
   return new;
 end if;

 if v_uid is null or (v_acting_user is distinct from v_uid
    and not private.is_game_teacher(new.game_id)) then
   raise exception 'Cannot represent this participant' using errcode='42501';
 end if;

 if v_acting_id is not null then
   select * into v_office from public.game_office_assignments
   where id=v_acting_id and game_id=new.game_id and user_id=v_acting_user
     and status='active';
   if not found or v_office.role_title is distinct from v_acting_role then
     raise exception 'Office assignment is not active' using errcode='42501';
   end if;
 elsif new.subject_key='ksrf' and v_acting_role='Представитель КСРФ' then
   if not exists(select 1 from public.game_members
     where game_id=new.game_id and user_id=v_acting_user and kind='student' and roster_archived_at is null)
   then raise exception 'No valid membership' using errcode='42501'; end if;
   return new;
 else
   select role_title into v_legacy from public.game_members
   where game_id=new.game_id and user_id=v_acting_user and kind='student' and roster_archived_at is null;
   if not found or not v_acting_role=any(string_to_array(v_legacy,' · ')) then
     raise exception 'The legacy office is no longer available' using errcode='42501';
   end if;
 end if;
 if not private.acting_office_supports_subject(v_acting_role,new.subject_key) then
   raise exception 'This office cannot represent the document subject' using errcode='42501';
 end if;
 -- Once, at document creation: reuse existing, confirmed office and nomination.
 select n.candidate_name into v_role_name
 from public.government_nominations n
 join public.game_members m on m.game_id=n.game_id and m.user_id=n.candidate_user_id
 where n.game_id=new.game_id and n.candidate_user_id=v_acting_user
   and n.office_title=v_acting_role and n.status='appointed'
   and n.candidate_name is distinct from m.full_name
 order by n.appointed_at desc limit 1;
 if v_role_name is not null then
   new.metadata:=new.metadata||jsonb_build_object('acting_role_name',v_role_name);
 end if;
 return new;
end $function$
;


-- Restore the original role-name protection for all future updates.
CREATE OR REPLACE FUNCTION private.prepare_formal_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare n bigint;y integer;v_issuer text;suffix text;
begin
 if tg_op='UPDATE' then
  new.metadata:=(coalesce(new.metadata,'{}'::jsonb)-array['act_number','registered_on','signed_name','signed_role','signed_on','signed_by','acting_role_name'])
   ||(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(coalesce(old.metadata,'{}'::jsonb)) where key=any(array['act_number','registered_on','signed_name','signed_role','signed_on','signed_by','acting_role_name']));
  -- Only the signature-history trigger can add a real signer snapshot.
  if pg_trigger_depth()>1 then
   new.metadata:=new.metadata||coalesce(current_setting('app.formal_signature_snapshot',true),'{}')::jsonb;
  end if;
  -- For Ministry of Justice replies the signature office comes from the issuing
  -- institution, never from an unrelated active role of the game moderator.
  if new.subject_key='minjust' and new.doc_type in ('justice_response','party_certificate')
     and new.metadata ? 'signed_role' then
   new.metadata:=jsonb_set(new.metadata,'{signed_role}',to_jsonb('Директор Департамента по делам некоммерческих организаций Министерства юстиции Российской Федерации'::text),true);
  end if;
  return new;
 end if;
 v_issuer:=coalesce(nullif(trim(new.metadata->>'issuer_name'),''),new.subject_label);
 y:=extract(year from now() at time zone 'Asia/Novosibirsk');
 insert into private.formal_number_counters values(new.game_id,v_issuer,new.doc_type,y,1)
 on conflict(game_id,issuer,doc_type,year) do update set last_number=private.formal_number_counters.last_number+1 returning last_number into n;
 suffix:=case new.doc_type when 'fz_bill' then '-ФЗ' when 'fkz_bill' then '-ФКЗ' when 'federal_budget' then '-ФЗ' when 'gd_resolution' then '-ГД' when 'sf_resolution' then '-СФ' when 'government_order' then '-р' when 'president_order' then '-рп' else '' end;
 new.metadata:=(coalesce(new.metadata,'{}'::jsonb)-array['signed_name','signed_role','signed_on','signed_by','signature_name','signature_title'])
  ||jsonb_build_object('issuer_name',v_issuer,'act_number',n::text||suffix,'registered_on',now(),'number_year',y);
 return new;
end;$function$
;
