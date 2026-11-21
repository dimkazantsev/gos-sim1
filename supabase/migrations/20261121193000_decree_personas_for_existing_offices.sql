-- Role-based names in ГОС.ID come from existing published, signed presidential decrees.
-- No new people, offices, storage, realtime subscriptions, client queries or tables.
-- The user's original game name remains in game_members; their user_id never changes.
-- The account links and the five exact signed decrees must match before any write.
DO $names$
DECLARE r record; nom public.government_nominations%rowtype; doc public.formal_documents%rowtype;
BEGIN
 FOR r IN SELECT * FROM (values
('0e518ebc-b77e-4d76-8d5d-30e6fc717324'::uuid,'ministry_defence','dd1ef461-28a6-4ca0-a186-e363e4b45d7b'::uuid,'Лавров Михаил Сергеевич','Сердюков Михаил Сергеевич','f14768a4-6700-490c-84de-300a3b15806f'::uuid,'Назначить Сердюкова Михаила Сергеевича Министром'),
('79f01665-e0c9-4247-9f38-6bb14c087d44'::uuid,'ministry_economic','dd1ef461-28a6-4ca0-a186-e363e4b45d7b'::uuid,'Лавров Михаил Сергеевич','Ушаков Михаил Сергеевич','58413287-ae16-4222-8722-df790af7f55b'::uuid,'Назначить Ушакова Михаила Сергеевича Министром'),
('6f26fa58-a76b-43c4-a0ba-affff8974ff2'::uuid,'ministry_foreign','bdf072fd-c4ba-40fb-a359-172a61dab036'::uuid,'Крюшон Декстер Эдуардович','Штефанов Декстер Эдуардович','1fbeb756-49ef-4dd7-99ff-bc7c19084343'::uuid,'Назначить Штефанова Декстера Эдуардовича Министром'),
('8f026451-ec10-4791-9c77-2a14e414c475'::uuid,'ministry_social','8c84173c-8503-443d-a97d-4d34a4dd5b4b'::uuid,'Ковальская Эвелина Александровна','Матвиенко Эвелина Александровна','d78bf73d-a10e-4009-ae03-10d4f7b6efd2'::uuid,'Назначить Матвиенко Эвелину Александровну Заместителем'),
('d2fde1b7-1440-4467-bb5b-ec7e86c3a922'::uuid,'ministry_internal','29f1213b-447d-43fa-9175-5d1ce7a499e2'::uuid,'Вагнер Анастасия Юрьевна','Собянина Анастасия Династиевна','8646ee4a-d0fa-49e1-930c-074ffc2af026'::uuid,'Назначить Собянину Анастасию Династиевну Министром')
) as source(nomination_id, office_key, candidate_user_id, old_name, official_name, decree_id, appointment_line) LOOP
   SELECT * INTO STRICT nom FROM public.government_nominations
   WHERE id=r.nomination_id AND game_id='068dac89-00ea-447a-96bf-0cb11d85014a'
   FOR UPDATE;
   SELECT * INTO STRICT doc FROM public.formal_documents
   WHERE id=r.decree_id AND game_id=nom.game_id FOR SHARE;
   IF nom.office_key IS DISTINCT FROM r.office_key
     OR nom.candidate_user_id IS DISTINCT FROM r.candidate_user_id
     OR nom.appointment_document_id IS DISTINCT FROM r.decree_id
     OR nom.status <> 'appointed'
     OR nom.candidate_name NOT IN (r.old_name,r.official_name)
     OR doc.status_code <> 'published'
     OR doc.metadata->>'purpose' <> 'government_appointment'
     OR doc.metadata->>'nomination_id' IS DISTINCT FROM r.nomination_id::text
     OR doc.metadata->>'signed_by' IS DISTINCT FROM '4dad58f5-0bbf-48e1-b429-7d87b43f9cc3'
     OR doc.metadata->>'signed_on' IS NULL
     OR doc.body_text NOT LIKE '%'||r.appointment_line||'%'
     OR (doc.metadata->>'revision_changed_at' IS NOT NULL
       AND (doc.metadata->>'signed_on')::timestamptz < (doc.metadata->>'revision_changed_at')::timestamptz)
   THEN RAISE EXCEPTION 'Несогласованное назначение или неподписанная редакция: %',r.office_key; END IF;
   UPDATE public.government_nominations
     SET candidate_name=r.official_name,updated_at=clock_timestamp()
     WHERE id=r.nomination_id AND candidate_name IS DISTINCT FROM r.official_name;
 END LOOP;
END $names$;

-- One historical ministry order already uses the defense office and Lavrov's
-- account. Display the confirmed defense-office name while retaining the exact
-- old signed_name/signed_role snapshot and unchanged signed legal text.
-- The metadata write guard is temporarily relaxed only within this atomic migration
-- and restored before commit. Other sessions cannot observe the temporary function.
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

DO $minister_order$
DECLARE d public.formal_documents%rowtype; n public.government_nominations%rowtype;
BEGIN
 SELECT * INTO STRICT d FROM public.formal_documents
  WHERE id='77581f4e-e948-47d5-b0d8-a57e1663536e'
    AND game_id='068dac89-00ea-447a-96bf-0cb11d85014a' FOR UPDATE;
 SELECT * INTO STRICT n FROM public.government_nominations
  WHERE id='0e518ebc-b77e-4d76-8d5d-30e6fc717324' FOR SHARE;
 IF d.doc_type<>'ministry_order' OR d.subject_key<>'ministry'
 OR d.status_code<>'published'
 OR d.metadata->>'acting_user_id' IS DISTINCT FROM n.candidate_user_id::text
 OR d.metadata->>'signed_by' IS DISTINCT FROM n.candidate_user_id::text
 OR d.metadata->>'acting_office_title' IS DISTINCT FROM n.office_title
 OR d.metadata->>'acting_office_id' IS DISTINCT FROM
   (SELECT a.id::text FROM public.game_office_assignments a
    WHERE a.game_id=d.game_id AND a.user_id=n.candidate_user_id
      AND a.role_title=n.office_title AND a.status='active' LIMIT 1)
 OR n.candidate_name IS DISTINCT FROM 'Сердюков Михаил Сергеевич'
 OR d.metadata->>'acting_role_name' NOT IN ('Сердюков Михаил Сергеевич')
   AND d.metadata->>'acting_role_name' IS NOT NULL
 THEN RAISE EXCEPTION 'Приказ не соответствует назначению, исправление остановлено'; END IF;
 IF d.metadata->>'acting_role_name' IS DISTINCT FROM n.candidate_name THEN
   UPDATE public.formal_documents
     SET metadata=jsonb_set(d.metadata,'{acting_role_name}',to_jsonb(n.candidate_name),true),
      updated_at=clock_timestamp()
     WHERE id=d.id;
 END IF;
END $minister_order$;

-- Restore immutable signed identity protections without changing any signatory.
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
