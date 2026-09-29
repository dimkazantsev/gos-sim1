-- A pre-uploaded signature must remain private until it is used on a recorded
-- game document. Authenticated game members may still see actual signed NPAs.
drop policy if exists game_assets_read on storage.objects;
create policy game_assets_read on storage.objects for select to authenticated
 using(bucket_id='game-assets' and
  (case
   when name ~ '^[^/]+/profiles/[^/]+/signature-[^/]+[.]png$' then
    (split_part(name,'/',3)=(select auth.uid())::text
     or private.is_game_teacher((split_part(name,'/',1))::uuid)
     or exists(
      select 1 from public.formal_document_signatures fs
       where fs.signature_path=objects.name
       and private.is_game_member(fs.game_id)))
   else private.is_game_member((split_part(name,'/',1))::uuid)
  end));

create or replace function private.capture_formal_document_signature()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare sig text;
begin
 if new.actor_id is null then return new;end if;
 -- Guard against false positives like "Не подписано" in arbitrary audit notes.
 if coalesce(new.to_status,'')<>'signed'
   and coalesce(trim(new.action),'') !~* '^подпис'
   and coalesce(trim(new.note),'') !~* '^подписан(о|а)'
 then return new;end if;
 select p.signature_path into sig from public.game_profiles p
 where p.game_id=new.game_id and p.user_id=new.actor_id;
 if sig is null then return new;end if;
 insert into public.formal_document_signatures(document_id,game_id,history_id,signer_id,signature_path,signed_at)
 values(new.document_id,new.game_id,new.id,new.actor_id,sig,new.created_at)
 on conflict(history_id) do nothing;
 return new;
end;
$$;