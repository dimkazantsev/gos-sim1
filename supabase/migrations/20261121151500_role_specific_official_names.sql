
-- Reuse existing persons and appointments. No new game accounts or tables.
DO $link$
DECLARE
 v_game uuid:='068dac89-00ea-447a-96bf-0cb11d85014a';
 v_pm uuid:='ab1c2aa6-d040-4d94-919b-82322c92992c';
 v_cb uuid:='29f1213b-447d-43fa-9175-5d1ce7a499e2';
 v_rows integer;
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.game_office_assignments a
   JOIN public.game_members m ON m.game_id=a.game_id AND m.user_id=a.user_id
   WHERE a.game_id=v_game AND a.user_id=v_pm AND a.status='active'
     AND a.role_title='Председатель Правительства Российской Федерации'
     AND m.full_name='Столыпина Арина Гламуровна' AND m.kind='student'
     AND m.roster_archived_at IS NULL
 ) THEN RAISE EXCEPTION 'Связь Столыпина — Мишустина не подтверждена'; END IF;
 UPDATE public.government_nominations
 SET candidate_user_id=v_pm,updated_at=clock_timestamp()
 WHERE id='5eebdce0-043a-46c3-b95a-0b53966f336a' AND game_id=v_game
   AND office_kind='prime_minister' AND status='appointed'
   AND office_title='Председатель Правительства Российской Федерации'
   AND candidate_name='Мишустина Арина Гламуровна'
   AND candidate_user_id IS NULL;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>1 AND NOT EXISTS (
   SELECT 1 FROM public.government_nominations WHERE id='5eebdce0-043a-46c3-b95a-0b53966f336a'
    AND game_id=v_game AND candidate_user_id=v_pm AND status='appointed'
 ) THEN RAISE EXCEPTION 'Ошибка привязки Председателя Правительства';END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.game_office_assignments a
   JOIN public.game_members m ON m.game_id=a.game_id AND m.user_id=a.user_id
   WHERE a.game_id=v_game AND a.user_id=v_cb AND a.status='active'
     AND a.role_title='Председатель Центрального банка Российской Федерации'
     AND m.full_name='Вагнер Анастасия Юрьевна' AND m.kind='student'
     AND m.roster_archived_at IS NULL
 ) THEN RAISE EXCEPTION 'Связь Вагнер — Набиуллина не подтверждена'; END IF;
 UPDATE public.government_nominations
 SET candidate_user_id=v_cb,updated_at=clock_timestamp()
 WHERE id='372e906c-6989-421c-be8e-961abd3cef1a' AND game_id=v_game
   AND office_kind='central_bank_chair' AND status='appointed'
   AND office_title='Председатель Центрального банка Российской Федерации'
   AND candidate_name='Набиуллина Анастасия Юрьевна'
   AND candidate_user_id IS NULL;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>1 AND NOT EXISTS (
   SELECT 1 FROM public.government_nominations WHERE id='372e906c-6989-421c-be8e-961abd3cef1a'
    AND game_id=v_game AND candidate_user_id=v_cb AND status='appointed'
 ) THEN RAISE EXCEPTION 'Ошибка привязки Председателя Центрального банка';END IF;
END $link$;

-- A one-time display snapshot for existing official documents only.
UPDATE public.formal_documents d
SET metadata=coalesce(d.metadata,'{}'::jsonb)
 || jsonb_build_object('acting_role_name',n.candidate_name),
 updated_at=clock_timestamp()
FROM public.game_office_assignments a
JOIN public.government_nominations n
 ON n.game_id=a.game_id AND n.candidate_user_id=a.user_id
 AND n.office_title=a.role_title AND n.status='appointed'
JOIN public.game_members m ON m.game_id=a.game_id AND m.user_id=a.user_id
WHERE d.game_id=a.game_id
 AND d.metadata->>'acting_office_id'=a.id::text
 AND d.metadata->>'acting_user_id'=a.user_id::text
 AND a.status='active'
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
 if not(new.metadata ? 'acting_office_title') then return new; end if;
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
