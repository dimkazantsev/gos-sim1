-- Party document visibility and latest-version registration (2026-10-15)
drop policy if exists party_documents_insert on public.party_documents;
create policy party_documents_insert on public.party_documents for insert to authenticated
with check (
 uploaded_by=(select auth.uid())
 and not private.party_registration_published(party_id)
 and (
   private.is_game_teacher(game_id)
   or exists (
     select 1 from public.game_parties p
     join public.game_members gm on gm.game_id=p.game_id and gm.team=p.name
     where p.id=party_documents.party_id and gm.user_id=(select auth.uid())
   )
 )
);

drop policy if exists party_documents_read on public.party_documents;
create policy party_documents_read on public.party_documents for select to authenticated
using (private.is_game_member(game_id) and (
 private.is_game_teacher(game_id)
 or exists (select 1 from public.game_parties p join public.game_members gm on gm.game_id=p.game_id and gm.team=p.name where p.id=party_documents.party_id and gm.user_id=(select auth.uid()))
 or (doc_kind in ('charter','program','symbol','congress_minutes') and status='accepted'
    and private.party_registration_published(party_id))
));

CREATE OR REPLACE FUNCTION public.submit_party_registration(p_party_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.game_parties%rowtype;v_uid uuid:=(select auth.uid());v_missing text;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if p.id is null then raise exception 'Party not found'; end if;
 if not private.is_game_teacher(p.game_id) and p.leader_user_id is distinct from v_uid then raise exception 'Party leader access required'; end if;
 if nullif(trim(coalesce(p.name,'')),'') is null or nullif(trim(coalesce(p.ideology,'')),'') is null then raise exception 'Party name and ideology are required'; end if;
 select string_agg(x.kind,', ') into v_missing
 from (values('application'),('charter'),('program'),('fee'),('symbol'),('congress_minutes')) x(kind)
 where not exists(select 1 from public.party_documents d where d.party_id=p.id and d.doc_kind=x.kind and d.status <> 'revision');
 if v_missing is not null then raise exception 'Registration package is incomplete: %',v_missing; end if;
 update public.game_parties set registration_status='submitted',registration_note=null,registration_submitted_at=now() where id=p.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p.game_id,1,'Регистрация партии','notice','Партия подала пакет на регистрацию',p.name,v_uid);
end;$function$


CREATE OR REPLACE FUNCTION public.review_party_registration(p_party_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.game_parties%rowtype;v_uid uuid:=(select auth.uid());v_not_accepted text;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if p.id is null then raise exception 'Party not found'; end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Ministry of Justice / teacher access required'; end if;
 if p_status not in ('registered','revision','rejected') then raise exception 'Unsupported registration decision'; end if;
 if p_status='registered' then
  select string_agg(x.kind,', ') into v_not_accepted
  from (values('application'),('charter'),('program'),('fee'),('symbol'),('congress_minutes')) x(kind)
  where not exists(select 1 from public.party_documents d where d.party_id=p.id and d.doc_kind=x.kind and d.status='accepted' and not exists(select 1 from public.party_documents newer where newer.party_id=d.party_id and newer.doc_kind=d.doc_kind and (newer.created_at>d.created_at or (newer.created_at=d.created_at and newer.id>d.id))));
  if v_not_accepted is not null then raise exception 'Accept every required document before registration: %',v_not_accepted; end if;
 end if;
 update public.game_parties
 set registration_status=p_status,registration_note=nullif(trim(coalesce(p_note,'')),''),
     registration_reviewed_at=now(),registration_reviewed_by=v_uid
 where id=p.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p.game_id,1,'Регистрация партии',case when p_status='registered' then 'notice' else 'warning' end,
        case when p_status='registered' then 'Партия зарегистрирована'
             when p_status='revision' then 'Пакет партии возвращён на доработку'
             else 'В регистрации партии отказано' end,
        p.name||coalesce(E'\n'||nullif(trim(coalesce(p_note,'')),''),''),v_uid);
end;$function$

