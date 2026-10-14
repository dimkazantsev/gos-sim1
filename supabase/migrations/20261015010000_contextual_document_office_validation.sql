-- Contextual signatory attribution in ГОС.ID.
-- An office is selected per document; no mutation of game_members.role_title.
-- Existing documents without acting_office_* metadata are unaffected.
create or replace function private.acting_office_supports_subject(p_role text,p_subject text)
returns boolean language sql immutable set search_path='' as $$
 select case p_subject
 when 'president' then lower(p_role) like '%президент%'
 when 'gd_deputy' then lower(p_role) like '%депутат%'
 when 'gd' then (lower(p_role) like '%председател%' or lower(p_role) like '%совет%') and lower(p_role) like '%дум%'
 when 'sf_member' then lower(p_role) like '%сенатор%'
 when 'sf' then lower(p_role) like '%совет%федерац%'
 when 'government' then lower(p_role) like '%правительств%' or lower(p_role) like '%министр%' or lower(p_role) like '%министерств%'
 when 'ministry' then lower(p_role) like '%министр%' or lower(p_role) like '%министерств%'
 when 'municipality' then lower(p_role) like '%муницип%' or lower(p_role) like '%глава города%' or lower(p_role) like '%администрац%'
 when 'region' then lower(p_role) like '%регион%' or lower(p_role) like '%субъект%' or lower(p_role) like '%законодательн%'
 when 'ks' then lower(p_role) like '%конституционн%' and lower(p_role) like '%суд%'
 when 'vs' then lower(p_role) like '%верховн%' and lower(p_role) like '%суд%'
 else false end
$$;
revoke all on function private.acting_office_supports_subject(text,text) from public,anon,authenticated;

create or replace function private.validate_document_acting_office()
returns trigger language plpgsql security definer
set search_path to 'public','private','pg_temp' as $$
declare v_office public.game_office_assignments%rowtype;
 v_uid uuid:=auth.uid();
 v_acting_id uuid;
 v_acting_user uuid;
 v_acting_role text;
 v_legacy text;
begin
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
 return new;
end $$;
revoke all on function private.validate_document_acting_office() from public,anon,authenticated;
drop trigger if exists validate_document_acting_office_on_create on public.formal_documents;
create trigger validate_document_acting_office_on_create before insert on public.formal_documents
for each row execute function private.validate_document_acting_office();

-- Only a teacher may adjust a legacy representative role for compatibility.
-- Ordinary participants keep the whole office portfolio and cannot switch.
create or replace function public.select_game_office(p_id uuid)
returns void language plpgsql security definer set search_path to 'public','private','pg_temp' as $$
declare o public.game_office_assignments%rowtype;
begin
 select * into o from public.game_office_assignments where id=p_id;
 if o.id is null or not private.is_game_teacher(o.game_id) then
  raise exception 'Only the administrator can change the legacy representative role'
    using errcode='42501';
 end if;
 perform 1 from public.game_members
  where game_id=o.game_id and user_id=o.user_id for update;
 select * into o from public.game_office_assignments where id=p_id for update;
 if o.status<>'active' or position(' · ' in o.role_title)>0 then
   raise exception 'The office must be active';
 end if;
 update public.game_members set role_title=o.role_title
 where game_id=o.game_id and user_id=o.user_id and kind='student';
end $$;
