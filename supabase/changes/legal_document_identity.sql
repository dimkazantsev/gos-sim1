-- Registry identities are generated under a row lock, independently for each authority/type/year.
create table if not exists private.formal_number_counters (
 game_id uuid not null references public.games(id) on delete cascade,
 issuer text not null,doc_type text not null,year integer not null,last_number bigint not null,
 primary key(game_id,issuer,doc_type,year)
);
revoke all on private.formal_number_counters from public,anon,authenticated;
create or replace function private.prepare_formal_identity() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare n bigint;y integer;issuer text;suffix text;
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
 issuer:=coalesce(nullif(trim(new.metadata->>'issuer_name'),''),new.subject_label);
 y:=extract(year from now() at time zone 'Asia/Novosibirsk');
 insert into private.formal_number_counters values(new.game_id,issuer,new.doc_type,y,1)
 on conflict(game_id,issuer,doc_type,year) do update set last_number=private.formal_number_counters.last_number+1 returning last_number into n;
 suffix:=case new.doc_type when 'fz_bill' then '-ФЗ' when 'fkz_bill' then '-ФКЗ' when 'federal_budget' then '-ФЗ' when 'gd_resolution' then '-ГД' when 'sf_resolution' then '-СФ' when 'government_order' then '-р' when 'president_order' then '-рп' else '' end;
 new.metadata:=(coalesce(new.metadata,'{}'::jsonb)-array['signed_name','signed_role','signed_on','signed_by','signature_name','signature_title'])
  ||jsonb_build_object('issuer_name',issuer,'act_number',n::text||suffix,'registered_on',now(),'number_year',y);
 return new;
end;$$;
drop trigger if exists prepare_formal_identity on public.formal_documents;
create trigger prepare_formal_identity before insert or update of metadata on public.formal_documents for each row execute function private.prepare_formal_identity();
revoke all on function private.prepare_formal_identity() from public,anon,authenticated;

create or replace function private.capture_formal_document_signature() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare sig text;person text;office text;snapshot jsonb;
begin
 if new.actor_id is null then return new;end if;
 if coalesce(new.to_status,'')<>'signed' and coalesce(trim(new.action),'') !~* '^подпис'
  and coalesce(trim(new.note),'') !~* '^подписан(о|а)' then return new;end if;
 select gm.full_name,gm.role_title into person,office from public.game_members gm where gm.game_id=new.game_id and gm.user_id=new.actor_id;
 snapshot:=jsonb_build_object('signed_name',person,'signed_role',office,'signed_on',new.created_at,'signed_by',new.actor_id);
 perform set_config('app.formal_signature_snapshot',snapshot::text,true);
 update public.formal_documents set metadata=coalesce(metadata,'{}'::jsonb)||snapshot where id=new.document_id;
 perform set_config('app.formal_signature_snapshot','{}',true);
 select p.signature_path into sig from public.game_profiles p where p.game_id=new.game_id and p.user_id=new.actor_id;
 if sig is not null then
  insert into public.formal_document_signatures(document_id,game_id,history_id,signer_id,signature_path,signed_at)
  values(new.document_id,new.game_id,new.id,new.actor_id,sig,new.created_at) on conflict(history_id) do nothing;
 end if;
 return new;
end;$$;
revoke all on function private.capture_formal_document_signature() from public,anon,authenticated;

-- Public party materials are public to this game's participants, never to unrelated accounts.
alter policy party_documents_read on public.party_documents using (
 private.is_game_member(game_id) and (
  private.is_game_teacher(game_id) or exists(select 1 from public.game_parties p join public.game_members gm on gm.game_id=p.game_id and gm.team=p.name where p.id=party_documents.party_id and gm.user_id=(select auth.uid()))
  or (doc_kind in ('charter','program','symbol','congress_minutes') and status<>'revision')
 )
);
