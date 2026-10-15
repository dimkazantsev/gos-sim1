-- ГОС.ID: versioned, confidential party-registration dossiers.
-- Existing documents are retained; approved historical attempts are never rewritten.
alter table public.party_documents add column if not exists version_no integer;
with versions as (
 select id,row_number() over(partition by party_id,doc_kind order by created_at,id)::integer as n
 from public.party_documents
)
update public.party_documents d set version_no=v.n from versions v where d.id=v.id and d.version_no is null;
alter table public.party_documents alter column version_no set not null;
create unique index if not exists party_documents_version_unique on public.party_documents(party_id,doc_kind,version_no);
create index if not exists party_documents_latest_idx on public.party_documents(party_id,doc_kind,version_no desc);

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
   where id=new.party_id and game_id=new.game_id;
  if v_registered is null or v_registered='registered' then
   raise exception 'После регистрации партии новый пакет не принимается' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('party-document:'||new.party_id::text||':'||new.doc_kind,0));
  select coalesce(max(version_no),0)+1 into new.version_no from public.party_documents
   where party_id=new.party_id and doc_kind=new.doc_kind;
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
drop trigger if exists party_documents_version_guard on public.party_documents;
create trigger party_documents_version_guard before insert or update on public.party_documents
 for each row execute function private.party_document_version_guard();
revoke all on function private.party_document_version_guard() from public,anon,authenticated;

-- Resolve the latest version outside the caller's RLS expression to avoid
-- recursive policy evaluation of party_documents.
create or replace function private.latest_party_document_version(p_party uuid,p_kind text)
returns integer language sql stable security definer set search_path to 'public','private','pg_temp'
as $fn$
 select max(version_no) from public.party_documents where party_id=p_party and doc_kind=p_kind
$fn$;
revoke all on function private.latest_party_document_version(uuid,text) from public,anon;
grant execute on function private.latest_party_document_version(uuid,text) to authenticated;

-- Guard ALL paths to the registered status, including older direct review RPCs.
create or replace function private.party_registration_latest_guard()
returns trigger language plpgsql security definer set search_path to 'public','private','pg_temp'
as $fn$
declare v_missing text;
begin
 if new.registration_status='registered' and old.registration_status is distinct from 'registered' then
  select string_agg(k.kind,', ') into v_missing
  from (values('application'),('charter'),('program'),('fee'),('symbol'),('congress_minutes')) k(kind)
  where not exists (
   select 1 from public.party_documents d where d.party_id=new.id and d.doc_kind=k.kind
    and d.version_no=(select max(v.version_no) from public.party_documents v
      where v.party_id=d.party_id and v.doc_kind=d.doc_kind)
    and d.status='accepted'
  );
  if v_missing is not null then
   raise exception 'Последние версии документов не приняты: %',v_missing using errcode='23514';
  end if;
 end if;
 return new;
end $fn$;
drop trigger if exists party_registration_latest_guard on public.game_parties;
create trigger party_registration_latest_guard before update of registration_status on public.game_parties
 for each row execute function private.party_registration_latest_guard();
revoke all on function private.party_registration_latest_guard() from public,anon,authenticated;

-- Legal release requires BOTH a registered decision and an issued certificate.
create or replace function private.party_registration_published(p_party uuid)
returns boolean language sql stable security definer set search_path to 'public','private','pg_temp'
as $fn$
 select exists(select 1 from public.game_parties p where p.id=p_party
  and p.registration_status='registered'
  and exists(select 1 from public.formal_documents f where f.game_id=p.game_id
   and f.doc_type='party_certificate' and f.metadata->>'party_id'=p.id::text))
$fn$;
revoke all on function private.party_registration_published(uuid) from public,anon;
grant execute on function private.party_registration_published(uuid) to authenticated;

-- Every party member sees the attempt and the teacher's verdict in the party chat.
create or replace function private.party_document_review_chat_notice()
returns trigger language plpgsql security definer set search_path to 'public','private','pg_temp'
as $fn$
declare v_party_name text;v_message text;v_author uuid:=auth.uid();
begin
 if tg_op='UPDATE' and new.status is not distinct from old.status then return new;end if;
 select name into v_party_name from public.game_parties where id=new.party_id and game_id=new.game_id;
 if v_party_name is null then return new;end if;
 if tg_op='INSERT' then
  v_message:='В Минюст направлена версия В'||new.version_no||' документа «'||left(new.title,140)||'». Ожидается рассмотрение.';
 else
  v_message:='Минюст рассмотрел версию В'||new.version_no||' документа «'||left(new.title,140)||'»: '||
   (case when new.status='accepted' then 'ПРИНЯТА.' else 'НА ДОРАБОТКУ.' end)||
   (case when length(btrim(coalesce(new.note,'')))>0 then E'\nЗамечания: '||left(new.note,1400) else '' end)||
   (case when new.status='revision' then E'\nЗагрузите исправленный документ как следующую версию.' else '' end);
 end if;
 insert into public.chat_messages(game_id,channel_id,author_id,kind,text)
 select new.game_id,c.id,coalesce(v_author,new.uploaded_by),'system',v_message
 from public.chat_channels c
 where c.game_id=new.game_id and c.kind='team' and c.name='Фракция · '||v_party_name
 limit 1;
 return new;
end $fn$;
drop trigger if exists party_document_review_chat_notice on public.party_documents;
create trigger party_document_review_chat_notice after insert or update of status on public.party_documents
 for each row execute function private.party_document_review_chat_notice();
revoke all on function private.party_document_review_chat_notice() from public,anon,authenticated;

-- Keep the entire attempt history; never allow a student or teacher to delete
-- an individual submission and erase a revision record.
drop policy if exists party_documents_delete on public.party_documents;
create policy party_documents_delete on public.party_documents for delete to authenticated using(false);
drop policy if exists party_documents_insert on public.party_documents;
create policy party_documents_insert on public.party_documents for insert to authenticated
 with check (
  uploaded_by=(select auth.uid()) and
  (private.is_game_teacher(game_id) or exists(
    select 1 from public.game_parties p join public.game_members gm
     on gm.game_id=p.game_id and gm.team=p.name
    where p.id=party_id and p.game_id=party_documents.game_id
     and gm.user_id=(select auth.uid()) and gm.kind='student' and gm.roster_archived_at is null))
  and exists(select 1 from public.game_parties p where p.id=party_id and p.game_id=party_documents.game_id and p.registration_status<>'registered')
 );
drop policy if exists party_documents_read on public.party_documents;
create policy party_documents_read on public.party_documents for select to authenticated
using (
 private.is_game_member(game_id) and (
  private.is_game_teacher(game_id)
  or exists(select 1 from public.game_parties p join public.game_members m
   on m.game_id=p.game_id and m.team=p.name
   where p.id=party_id and p.game_id=party_documents.game_id
    and m.user_id=(select auth.uid()) and m.kind='student' and m.roster_archived_at is null)
  or (
   status='accepted' and doc_kind in ('charter','program','symbol','congress_minutes')
   and version_no=private.latest_party_document_version(party_documents.party_id,party_documents.doc_kind)
   and exists(select 1 from public.game_parties p where p.id=party_id and p.game_id=party_documents.game_id
    and p.registration_status='registered' and exists(
     select 1 from public.formal_documents f where f.game_id=p.game_id
      and f.doc_type='party_certificate' and f.metadata->>'party_id'=p.id::text
    ))
  )
 )
);

-- Supabase Storage policies are permissive (OR). The old news visibility policy
-- allowed any non-news asset; scope it to news, then protect party /docs objects.
drop policy if exists game_assets_news_visibility on storage.objects;
create policy game_assets_news_visibility on storage.objects for select to authenticated
 using (
  bucket_id='game-assets' and split_part(name,'/',2)='news' and (
   split_part(name,'/',3)=(select auth.uid())::text
   or private.is_game_teacher((split_part(name,'/',1))::uuid)
   or exists(select 1 from public.political_post_media pm join public.political_posts pp on pp.id=pm.post_id
    where pm.storage_path=storage.objects.name and pp.deleted_at is null and private.is_game_member(pp.game_id))
  )
 );
drop policy if exists game_assets_read on storage.objects;
create policy game_assets_read on storage.objects for select to authenticated
using (
 bucket_id='game-assets' and
 case
 when name ~ '^[^/]+/parties/[^/]+/docs/' then
  private.is_game_teacher((split_part(name,'/',1))::uuid)
  or exists(
   select 1 from public.game_parties p join public.game_members m on m.game_id=p.game_id and m.team=p.name
   where p.id=(split_part(name,'/',3))::uuid
    and p.game_id=(split_part(name,'/',1))::uuid and m.user_id=(select auth.uid())
    and m.kind='student' and m.roster_archived_at is null
  )
  or exists(
   select 1 from public.party_documents d join public.game_parties p on p.id=d.party_id
   where d.storage_path=storage.objects.name and p.registration_status='registered'
    and d.status='accepted' and d.doc_kind in ('charter','program','symbol','congress_minutes')
    and d.version_no=private.latest_party_document_version(d.party_id,d.doc_kind)
    and exists(select 1 from public.formal_documents f where f.game_id=p.game_id
     and f.doc_type='party_certificate' and f.metadata->>'party_id'=p.id::text)
    and private.is_game_member(p.game_id)
  )
 when name ~ '^[^/]+/profiles/[^/]+/signature-[^/]+[.]png$' then
  (split_part(name,'/',3)=(select auth.uid())::text
   or private.is_game_teacher((split_part(name,'/',1))::uuid)
   or exists(select 1 from public.formal_document_signatures fs where fs.signature_path=storage.objects.name and private.is_game_member(fs.game_id)))
 else private.is_game_member((split_part(name,'/',1))::uuid)
 end
);


-- Storage INSERT, like DB INSERT, must be impossible after registration;
-- otherwise a client could leave orphan file versions behind.
drop policy if exists game_assets_party_insert on storage.objects;
create policy game_assets_party_insert on storage.objects for insert to authenticated
with check (
 bucket_id='game-assets' and split_part(name,'/',2)='parties'
 and private.is_game_member((split_part(name,'/',1))::uuid)
 and not private.is_game_observer((split_part(name,'/',1))::uuid)
 and (
  private.is_game_teacher((split_part(name,'/',1))::uuid)
  or exists(select 1 from public.game_parties gp join public.game_members gm
   on gm.game_id=gp.game_id and gm.team=gp.name
   where gp.id=(split_part(name,'/',3))::uuid and gp.game_id=(split_part(name,'/',1))::uuid
    and gm.user_id=(select auth.uid()) and gm.kind='student' and gm.roster_archived_at is null)
 )
 and (
  split_part(name,'/',4)<>'docs' or exists(
   select 1 from public.game_parties gp where gp.id=(split_part(name,'/',3))::uuid
    and gp.game_id=(split_part(name,'/',1))::uuid and gp.registration_status<>'registered'
  )
 )
);


-- Signed Minjust correspondence is a private party notification until
-- the actual registration certificate exists. The game-wide formal register
-- and political wall must not leak preliminary refusal/revision letters.
drop policy if exists formal_documents_read on public.formal_documents;
create policy formal_documents_read on public.formal_documents for select to authenticated
using (
 private.is_game_member(game_id) and (
  doc_type not in ('justice_response','party_certificate') or not coalesce(metadata ? 'party_id',false)
  or private.is_game_teacher(game_id)
  or exists(
   select 1 from public.game_parties p
   where p.game_id=formal_documents.game_id and p.id::text=formal_documents.metadata->>'party_id'
    and (private.party_registration_published(p.id)
     or exists(select 1 from public.game_members m where m.game_id=p.game_id
      and m.user_id=(select auth.uid()) and m.kind='student'
      and m.team=p.name and m.roster_archived_at is null))
  )
 )
);
drop policy if exists political_posts_read on public.political_posts;
create policy political_posts_read on public.political_posts for select to authenticated
using (
 deleted_at is null and private.is_game_member(game_id)
 and (
  actor_key is distinct from 'minjust' or not coalesce(context ? 'party_id',false)
  or private.is_game_teacher(game_id)
  or exists(select 1 from public.game_parties p
   where p.game_id=political_posts.game_id and p.id::text=political_posts.context->>'party_id'
    and (private.party_registration_published(p.id)
     or exists(select 1 from public.game_members m where m.game_id=p.game_id
      and m.user_id=(select auth.uid()) and m.kind='student'
      and m.team=p.name and m.roster_archived_at is null)))
 )
);
