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

