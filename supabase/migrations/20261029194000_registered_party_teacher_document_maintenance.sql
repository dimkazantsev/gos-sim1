-- ГОС.ID: a teacher can replace or remove outdated party dossiers after registration.
-- Never open these privileges to students or guests. Approved registration
-- and its issued certificate are not rolled back by a later correction.
-- Before deletion, the whole removed row is preserved in private audit; for
-- registered/certified parties the historical original remains in Storage.
-- Teacher corrections are administrative work, independent of the first-stage deadline.
-- Ordinary student submissions retain their existing stage guard.
create or replace function private.enforce_party_dossier_stage()
returns trigger language plpgsql security definer set search_path to ''
as $fn$
begin
 if auth.uid() is not null and not private.is_game_teacher(new.game_id)
    and not private.stage_one_party_active(new.game_id) then
  raise exception 'Первый этап ещё не открыт.' using errcode='42501';
 end if;
 return new;
end $fn$;
revoke all on function private.enforce_party_dossier_stage() from public,anon,authenticated;

-- A teacher may submit a replacement at any time. Party members cannot submit
-- new registration documents once the party is registered.
drop policy if exists party_documents_insert on public.party_documents;
create policy party_documents_insert on public.party_documents for insert to authenticated
with check (
 uploaded_by=(select auth.uid()) and
 (private.is_game_teacher(game_id) or exists(
   select 1 from public.game_parties p join public.game_members gm
   on gm.game_id=p.game_id and gm.team=p.name
   where p.id=party_id and p.game_id=party_documents.game_id
    and gm.user_id=(select auth.uid()) and gm.kind='student'
    and gm.roster_archived_at is null and p.registration_status<>'registered'
 ))
);

-- Storage and table permissions must agree. No cross-party student writes and
-- no document uploads by members after registration.
drop policy if exists game_assets_party_insert on storage.objects;
create policy game_assets_party_insert on storage.objects for insert to authenticated
with check (
 bucket_id='game-assets' and split_part(name,'/',2)='parties'
 and private.is_game_member((split_part(name,'/',1))::uuid)
 and not private.is_game_observer((split_part(name,'/',1))::uuid)
 and (
   private.is_game_teacher((split_part(name,'/',1))::uuid)
   or exists(
     select 1 from public.game_parties gp
     join public.game_members gm on gm.game_id=gp.game_id and gm.team=gp.name
     where gp.id=(split_part(storage.objects.name,'/',3))::uuid
       and gp.game_id=(split_part(storage.objects.name,'/',1))::uuid
       and gm.user_id=(select auth.uid())
       and gm.kind='student' and gm.roster_archived_at is null
       and (split_part(storage.objects.name,'/',4)<>'docs' or gp.registration_status<>'registered')
   )
 )
);

create or replace function private.party_document_version_guard()
returns trigger language plpgsql security definer set search_path to 'public','private','pg_temp'
as $fn$
declare v_last uuid;v_registered text;
begin
 if tg_op='INSERT' then
  if new.status not in ('submitted','draft') then
   raise exception 'Новый документ должен поступить на рассмотрение' using errcode='23514';
  end if;
  select registration_status into v_registered from public.game_parties
   where id=new.party_id and game_id=new.game_id for update;
  if v_registered is null or (v_registered='registered' and not private.is_game_teacher(new.game_id)) then
   raise exception 'После регистрации партии новый пакет не принимается' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('party-document:'||new.party_id::text||':'||new.doc_kind,0));
  select greatest(coalesce(max(d.version_no),0),coalesce((
   select max(a.version_no) from private.party_document_deletion_audit a
   where a.party_id=new.party_id and a.doc_kind=new.doc_kind
  ),0))+1 into new.version_no
  from public.party_documents d where d.party_id=new.party_id and d.doc_kind=new.doc_kind;
  return new;
 end if;
 if row(new.game_id,new.party_id,new.doc_kind,new.title,new.storage_path,new.file_name,new.mime_type,new.file_size,new.uploaded_by,new.version_no,new.created_at)
    is distinct from row(old.game_id,old.party_id,old.doc_kind,old.title,old.storage_path,old.file_name,old.mime_type,old.file_size,old.uploaded_by,old.version_no,old.created_at)
 then raise exception 'История попыток неизменяема; загрузите новую версию' using errcode='42501';end if;
 if new.status is distinct from old.status then
  select id into v_last from public.party_documents
   where party_id=new.party_id and doc_kind=new.doc_kind
   order by version_no desc limit 1;
  if v_last is distinct from new.id then raise exception 'Рассматривать можно только последнюю версию' using errcode='23514';end if;
  if old.status not in ('submitted','draft') then raise exception 'Повторное рассмотрение завершённой попытки недоступно' using errcode='23514';end if;
  if new.status not in ('accepted','revision') then raise exception 'Недопустимый результат рассмотрения' using errcode='23514';end if;
  if new.status='revision' and length(btrim(coalesce(new.note,'')))<5 then
   raise exception 'Укажите основание доработки документа' using errcode='23514';
  end if;
 end if;
 return new;
end $fn$;
revoke all on function private.party_document_version_guard() from public,anon,authenticated;


create or replace function public.teacher_delete_party_document(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','private','pg_temp'
as $fn$
declare
 v_game uuid;
 v_party uuid;
 v_registration text;
 v_doc public.party_documents%rowtype;
 v_party_name text;
 v_actor uuid := auth.uid();
 v_keep_history boolean;
begin
 if v_actor is null then
  raise exception 'Требуется вход преподавателя' using errcode='42501';
 end if;
 -- No payload is returned to unauthorized callers, even when an ID exists.
 select d.game_id,d.party_id into v_game,v_party
 from public.party_documents d where d.id=p_document_id;
 if not found then return jsonb_build_object('deleted',false);end if;
 if not private.is_game_teacher(v_game) then
  raise exception 'Только преподаватель вправе удалять регистрационные документы' using errcode='42501';
 end if;
 -- The party row serializes the deletion with registration and new versions.
 select p.registration_status,p.name into v_registration,v_party_name
 from public.game_parties p where p.id=v_party and p.game_id=v_game for update;
 if not found then return jsonb_build_object('deleted',false);end if;
 -- Keep the original binary where a certificate or registration already exists.
 -- Removing the current dossier row never destroys the signed historical record.
 v_keep_history := v_registration='registered' or exists(
  select 1 from public.formal_documents f where f.game_id=v_game
   and f.doc_type='party_certificate' and f.metadata->>'party_id'=v_party::text
 );
 select * into v_doc from public.party_documents
 where id=p_document_id and game_id=v_game and party_id=v_party for update;
 if not found then return jsonb_build_object('deleted',false);end if;
 insert into private.party_document_deletion_audit(
  document_id,game_id,party_id,doc_kind,version_no,deleted_by,row_snapshot)
 values(v_doc.id,v_doc.game_id,v_doc.party_id,v_doc.doc_kind,v_doc.version_no,v_actor,to_jsonb(v_doc));
 delete from public.party_documents where id=v_doc.id;
 -- Existing examination messages remain historic; notify the party about the removal.
 insert into public.chat_messages(game_id,channel_id,author_id,kind,text)
 select v_game,c.id,v_actor,'system',
   'Преподаватель удалил версию В'||v_doc.version_no||' документа «'||left(v_doc.title,140)||'». Документ исключён из досье.'
 from public.chat_channels c
 where c.game_id=v_game and c.kind='team' and c.name='Фракция · '||v_party_name
 limit 1;
 return jsonb_build_object('deleted',true,'storage_path',case when v_keep_history then null else v_doc.storage_path end,'document_id',v_doc.id,'historical_file_retained',v_keep_history);
end $fn$;
revoke all on function public.teacher_delete_party_document(uuid) from public, anon;
grant execute on function public.teacher_delete_party_document(uuid) to authenticated;
