-- Cumulative support documents for formal NPA workflows.
create table if not exists public.formal_support_documents(
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.formal_documents(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 stage_code text not null,
 category text not null check(category in ('committee_conclusion','decision','protocol','opinion','letter','review','amendment','other')),
 title text not null,
 note text,
 storage_path text,
 file_name text,
 mime_type text,
 file_size bigint,
 created_by uuid references auth.users(id) on delete set null,
 source_key text,
 created_at timestamptz not null default now(),
 unique(document_id,source_key)
);
create index if not exists formal_support_documents_doc_idx on public.formal_support_documents(document_id,created_at);
create index if not exists formal_support_documents_game_idx on public.formal_support_documents(game_id,created_at desc);
alter table public.formal_support_documents enable row level security;
revoke all privileges on table public.formal_support_documents from anon,authenticated;
grant select on table public.formal_support_documents to authenticated;
drop policy if exists formal_support_documents_read on public.formal_support_documents;
create policy formal_support_documents_read on public.formal_support_documents for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='formal_support_documents')
 then alter publication supabase_realtime add table public.formal_support_documents; end if;
end $$;

create or replace function private.can_add_formal_support_document(p_document uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(select 1 from public.formal_documents d where d.id=p_document and (
  private.is_game_teacher(d.game_id) or private.matches_formal_owner(d.game_id,p_user,d.current_owner_key,d.author_id)
 ));
$$;
revoke execute on function private.can_add_formal_support_document(uuid,uuid) from public,anon,authenticated;

create or replace function public.add_formal_support_document(
 p_document_id uuid,p_category text,p_title text,p_note text default null,p_storage_path text default null,
 p_file_name text default null,p_mime_type text default null,p_file_size bigint default null
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null then raise exception 'Document not found'; end if;
 if v_uid is null or not private.can_add_formal_support_document(d.id,v_uid) then raise exception 'Current institution / teacher access required'; end if;
 if p_category not in ('decision','protocol','opinion','letter','review','amendment','other') then raise exception 'Unsupported support document category'; end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Support document title is required'; end if;
 insert into public.formal_support_documents(document_id,game_id,stage_code,category,title,note,storage_path,file_name,mime_type,file_size,created_by)
 values(d.id,d.game_id,d.status_code,p_category,trim(p_title),nullif(trim(coalesce(p_note,'')),''),
  nullif(trim(coalesce(p_storage_path,'')),''),nullif(trim(coalesce(p_file_name,'')),''),
  nullif(trim(coalesce(p_mime_type,'')),''),p_file_size,v_uid) returning id into v_id;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,v_uid,'Добавлен сопроводительный документ',d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,trim(p_title));
 return v_id;
end;
$$;
revoke all on function public.add_formal_support_document(uuid,text,text,text,text,text,text,bigint) from public,anon;
grant execute on function public.add_formal_support_document(uuid,text,text,text,text,text,text,bigint) to authenticated;

create or replace function public.save_bill_committee_conclusion(
 p_document_id uuid,p_rapporteur_user_id uuid,p_legal_compliance text,p_internal_logic text,
 p_affected_acts_completeness text,p_recommendation text,p_finalize boolean default false
) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_next integer;v_step jsonb;v_note text;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null or d.workflow_key<>'bill' then raise exception 'Bill not found'; end if;
 if not private.can_review_bill_submission(d.id,v_uid) then raise exception 'Profile committee / teacher access required'; end if;
 if p_recommendation not in ('draft','proceed','return','reject') then raise exception 'Unsupported committee recommendation'; end if;
 if p_finalize and (length(trim(coalesce(p_legal_compliance,'')))<10 or length(trim(coalesce(p_internal_logic,'')))<10 or length(trim(coalesce(p_affected_acts_completeness,'')))<10 or p_recommendation='draft')
 then raise exception 'Complete all three committee findings and choose a recommendation before finalizing'; end if;
 insert into public.bill_committee_conclusions(document_id,game_id,rapporteur_user_id,legal_compliance,internal_logic,affected_acts_completeness,recommendation,finalized,updated_by,updated_at)
 values(d.id,d.game_id,p_rapporteur_user_id,trim(coalesce(p_legal_compliance,'')),trim(coalesce(p_internal_logic,'')),trim(coalesce(p_affected_acts_completeness,'')),p_recommendation,p_finalize,v_uid,now())
 on conflict(document_id) do update set rapporteur_user_id=excluded.rapporteur_user_id,legal_compliance=excluded.legal_compliance,internal_logic=excluded.internal_logic,affected_acts_completeness=excluded.affected_acts_completeness,recommendation=excluded.recommendation,finalized=excluded.finalized,updated_by=v_uid,updated_at=now();
 if p_finalize then
  v_note:=case p_recommendation when 'proceed' then 'Рекомендация: передать законопроект в Совет Государственной Думы.'
   when 'return' then 'Рекомендация: вернуть законопроект субъекту законодательной инициативы на доработку.'
   when 'reject' then 'Рекомендация: отклонить законопроект.' else 'Итоговое заключение профильного комитета.' end;
  insert into public.formal_support_documents(document_id,game_id,stage_code,category,title,note,created_by,source_key,created_at)
  values(d.id,d.game_id,d.status_code,'committee_conclusion','Заключение профильного комитета',v_note,v_uid,'committee_conclusion',now())
  on conflict(document_id,source_key) do update set stage_code=excluded.stage_code,title=excluded.title,note=excluded.note,created_by=excluded.created_by,created_at=now();
  if d.status_code='committee' then
   if p_recommendation='proceed' then
    v_next:=d.current_step+1;
    if v_next>=jsonb_array_length(d.workflow_steps) then raise exception 'Workflow already completed'; end if;
    v_step:=d.workflow_steps->v_next;
    update public.formal_documents set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',current_owner_key=v_step->>'owner',updated_at=now() where id=d.id;
    insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
    values(d.id,d.game_id,v_uid,'Заключение комитета зафиксировано и документ передан далее',d.status_code,v_step->>'code',d.current_owner_key,v_step->>'owner',v_note);
   elsif p_recommendation='return' then
    update public.formal_documents set current_step=0,status_code='revision',status_label='Возвращён на доработку',current_owner_key='author',updated_at=now() where id=d.id;
    insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
    values(d.id,d.game_id,v_uid,'Заключение комитета: вернуть на доработку',d.status_code,'revision',d.current_owner_key,'author',v_note);
   elsif p_recommendation='reject' then
    update public.formal_documents set status_code='rejected',status_label='Отклонён',current_owner_key='system',updated_at=now() where id=d.id;
    insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
    values(d.id,d.game_id,v_uid,'Заключение комитета: рекомендовано отклонить',d.status_code,'rejected',d.current_owner_key,'system',v_note);
   end if;
  end if;
 end if;
end;
$$;
revoke all on function public.save_bill_committee_conclusion(uuid,uuid,text,text,text,text,boolean) from public,anon;
grant execute on function public.save_bill_committee_conclusion(uuid,uuid,text,text,text,text,boolean) to authenticated;
