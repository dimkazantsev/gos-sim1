-- ГОС.ID: teacher-only removal of one party dossier file, retaining a private audit trail.
-- Historic versions survive in the audit log; a registered party's legal dossier is immutable.
create table if not exists private.party_document_deletion_audit (
 document_id uuid primary key,
 game_id uuid not null,
 party_id uuid not null,
 doc_kind text not null,
 version_no integer not null,
 deleted_by uuid not null,
 deleted_at timestamptz not null default now(),
 row_snapshot jsonb not null
);
revoke all on table private.party_document_deletion_audit from public, anon, authenticated;
create index if not exists party_document_deletion_audit_versions_idx
 on private.party_document_deletion_audit(party_id,doc_kind,version_no desc);

-- Preserve monotonically increasing version labels even after an authorised deletion.
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
  if v_registered is null or v_registered='registered' then
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
 if v_registration='registered' or exists(
  select 1 from public.formal_documents f where f.game_id=v_game
   and f.doc_type='party_certificate' and f.metadata->>'party_id'=v_party::text
 ) then
  raise exception 'Зарегистрированная партия: удаление юридически оформленных документов запрещено' using errcode='23514';
 end if;
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
 return jsonb_build_object('deleted',true,'storage_path',v_doc.storage_path,'document_id',v_doc.id);
end $fn$;
revoke all on function public.teacher_delete_party_document(uuid) from public, anon;
grant execute on function public.teacher_delete_party_document(uuid) to authenticated;
