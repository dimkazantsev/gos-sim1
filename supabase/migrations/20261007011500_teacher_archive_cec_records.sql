-- Teacher-safe archival for CEC candidate dossiers and documents.
alter table public.presidential_candidates add column if not exists archived_at timestamptz;
alter table public.presidential_candidate_documents add column if not exists archived_at timestamptz;

create index if not exists presidential_candidates_active_idx on public.presidential_candidates(game_id,archived_at,created_at);
create index if not exists presidential_candidate_documents_active_idx on public.presidential_candidate_documents(candidate_id,archived_at,doc_kind);

create or replace function public.archive_presidential_candidate(p_candidate_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id for update;
 if c.id is null then return; end if;
 if not private.is_game_teacher(c.game_id) then raise exception 'Teacher access required'; end if;
 update public.presidential_candidate_documents
 set archived_at=coalesce(archived_at,now()),is_submitted=false,submitted_at=null,updated_at=now()
 where candidate_id=c.id and archived_at is null;
 update public.presidential_candidates set archived_at=now(),updated_at=now() where id=c.id;
end;$$;
revoke all on function public.archive_presidential_candidate(uuid) from public,anon;
grant execute on function public.archive_presidential_candidate(uuid) to authenticated;

create or replace function public.archive_presidential_candidate_document(p_document_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.presidential_candidate_documents%rowtype;
begin
 select * into d from public.presidential_candidate_documents where id=p_document_id for update;
 if d.id is null then return; end if;
 if not private.is_game_teacher(d.game_id) then raise exception 'Teacher access required'; end if;
 update public.presidential_candidate_documents set archived_at=now(),is_submitted=false,submitted_at=null,updated_at=now() where id=d.id;
end;$$;
revoke all on function public.archive_presidential_candidate_document(uuid) from public,anon;
grant execute on function public.archive_presidential_candidate_document(uuid) to authenticated;

create or replace function public.add_presidential_candidate_document(
 p_candidate_id uuid,p_doc_kind text,p_title text,p_storage_path text,p_file_name text,p_mime_type text default null,p_file_size bigint default null
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id and archived_at is null;
 if c.id is null then raise exception 'Candidate not found';end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier access required';end if;
 if p_doc_kind not in ('party_decision','party_egrul','group_petition','signature_sheets','consent','passport','income','real_estate','expenses') then raise exception 'Unsupported document kind';end if;
 if c.nomination_type='party' and p_doc_kind in ('group_petition','signature_sheets') then raise exception 'Self-nomination document is not applicable';end if;
 if c.nomination_type='self' and p_doc_kind in ('party_decision','party_egrul') then raise exception 'Party nomination document is not applicable';end if;
 insert into public.presidential_candidate_documents(game_id,candidate_id,doc_kind,title,storage_path,file_name,mime_type,file_size,uploaded_by,status,note,reviewed_by,is_submitted,submitted_at,extracted_text,extraction_status,auto_check,archived_at)
 values(c.game_id,c.id,p_doc_kind,coalesce(nullif(trim(p_title),''),p_file_name),p_storage_path,p_file_name,p_mime_type,p_file_size,v_uid,'submitted',null,null,false,null,null,'pending','{}'::jsonb,null)
 on conflict(candidate_id,doc_kind) do update set
  title=excluded.title,storage_path=excluded.storage_path,file_name=excluded.file_name,mime_type=excluded.mime_type,file_size=excluded.file_size,
  uploaded_by=v_uid,status='submitted',note=null,reviewed_by=null,is_submitted=false,submitted_at=null,
  extracted_text=null,extraction_status='pending',auto_check='{}'::jsonb,archived_at=null,updated_at=now()
 returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.add_presidential_candidate_document(uuid,text,text,text,text,text,bigint) from public,anon;
grant execute on function public.add_presidential_candidate_document(uuid,text,text,text,text,text,bigint) to authenticated;

update public.presidential_candidates
set archived_at=coalesce(archived_at,now()),updated_at=now()
where id in ('5c4d09fb-15a8-40eb-9e68-2c09c1296216','4459a691-b30e-411a-ba2f-46634abead60')
  and display_name in ('вафывафывафыва','ыава');
