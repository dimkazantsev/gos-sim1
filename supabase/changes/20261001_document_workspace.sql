-- Document workspace: saved revisions, institutional delivery and explicit signing.
create table public.formal_document_revisions (
 id uuid primary key default gen_random_uuid(), game_id uuid not null references public.games(id) on delete cascade,
 document_id uuid not null references public.formal_documents(id) on delete cascade,
 revision integer not null, title text not null, body_text text, metadata jsonb not null,
 editor_id uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 unique(document_id,revision)
);
create index formal_revisions_game_doc on public.formal_document_revisions(game_id,document_id);
alter table public.formal_document_revisions enable row level security;
create policy formal_revisions_read on public.formal_document_revisions for select to authenticated using(private.is_game_member(game_id));
grant select on public.formal_document_revisions to authenticated;

create table public.formal_document_deliveries (
 id uuid primary key default gen_random_uuid(), game_id uuid not null references public.games(id) on delete cascade,
 document_id uuid not null references public.formal_documents(id) on delete cascade,
 sender_id uuid not null references auth.users(id), recipient_id uuid not null references auth.users(id),
 destination text not null, note text, delivery_kind text not null check(delivery_kind in ('copy','procedure')),
 created_at timestamptz not null default clock_timestamp()
);
create index formal_deliveries_inbox on public.formal_document_deliveries(game_id,recipient_id,created_at desc);
create index formal_deliveries_document on public.formal_document_deliveries(document_id);
alter table public.formal_document_deliveries enable row level security;
create policy formal_deliveries_read on public.formal_document_deliveries for select to authenticated
 using(private.is_game_member(game_id) and (sender_id=(select auth.uid()) or recipient_id=(select auth.uid()) or private.is_game_teacher(game_id)));
grant select on public.formal_document_deliveries to authenticated;

create or replace function private.formal_user_roles(p_game uuid,p_user uuid) returns setof text
language sql stable security definer set search_path=public,private,pg_temp as $$
 select lower(coalesce(gm.role_title,'')) from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and gm.kind<>'observer'
 union select lower(a.role_title) from public.game_office_assignments a
 where a.game_id=p_game and a.user_id=p_user and a.status='active'
 and exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and gm.kind<>'observer')
$$;
revoke all on function private.formal_user_roles(uuid,uuid) from public,anon,authenticated;

create or replace function private.matches_formal_owner(p_game uuid,p_user uuid,p_owner text,p_author uuid) returns boolean
language sql stable security definer set search_path=public,private,pg_temp as $$
 select case
 when p_user=(select auth.uid()) and private.is_game_teacher(p_game) then true
 when not exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and gm.kind<>'observer') then false
 when exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and gm.kind='teacher') then p_owner='teacher'
 when p_owner='author' then p_user=p_author
 when p_owner in ('system','teacher') then false
 else exists(select 1 from private.formal_user_roles(p_game,p_user) r where case p_owner
 when 'president' then r like '%президент%'
 when 'gd_staff' then r like '%председател%' and r like '%дум%'
 when 'gd_council' then (r like '%совет%' or r like '%председател%') and r like '%дум%'
 when 'committee' then r like '%комитет%' or r like '%депутат%'
 when 'gd' then r like '%депутат%' or (r like '%государственн%' and r like '%дум%')
 when 'sf' then r like '%сенатор%' or r like '%совет федерац%'
 when 'government' then r like '%правительств%' or r like '%министр%'
 when 'ministry' then r like '%министр%' or r like '%министерств%'
 when 'municipality' then r like '%муницип%' or r like '%глава города%' or r like '%администрац%'
 else false end) end
$$;
revoke all on function private.matches_formal_owner(uuid,uuid,text,uuid) from public,anon,authenticated;

create or replace function private.formal_vote_required(p_document public.formal_documents) returns boolean
language sql immutable set search_path=public,private,pg_temp as $$
 select p_document.status_code='president_veto'
 or (p_document.workflow_key in ('bill','budget') and p_document.status_code in ('reading1','reading2','reading3'))
 or (p_document.workflow_key in ('government_act','gd_resolution','sf_resolution') and p_document.status_code='agenda')
 or (p_document.workflow_key='municipal_act' and p_document.status_code='meeting')
$$;
revoke all on function private.formal_vote_required(public.formal_documents) from public,anon,authenticated;

create or replace function public.get_formal_document_tools(p_document_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;u uuid:=auth.uid();manage boolean;open_vote boolean;editable boolean;signable boolean;next_step jsonb;
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or not private.is_game_member(d.game_id) then raise exception 'Документ недоступен';end if;
 manage:=private.matches_formal_owner(d.game_id,u,d.current_owner_key,d.author_id);
 open_vote:=exists(select 1 from public.game_votes where formal_document_id=d.id and status='open');
 editable:=not open_vote and (private.is_game_teacher(d.game_id) or (manage and d.current_owner_key<>'system' and d.status_code not in ('signed','published','adopted','rejected')));
 next_step:=d.workflow_steps->(d.current_step+1);
 signable:=not open_vote and not private.formal_vote_required(d) and
 ((manage and coalesce(d.workflow_steps->d.current_step->>'action','') ilike '%подпис%')
 or ((private.is_game_teacher(d.game_id) or d.metadata->>'signed_by'=u::text)
 and d.status_code in ('signed','published','adopted') and d.metadata ? 'revision_changed_at'
 and (not (d.metadata ? 'signed_on') or (d.metadata->>'revision_changed_at')::timestamptz>(d.metadata->>'signed_on')::timestamptz)));
 return jsonb_build_object('can_edit',editable,'can_manage',manage,'can_sign',signable,
 'can_copy',exists(select 1 from public.game_members where game_id=d.game_id and user_id=u and kind<>'observer'),
 'vote_required',private.formal_vote_required(d),'open_vote',open_vote,'next_owner',next_step->>'owner','next_action',d.workflow_steps->d.current_step->>'action');
end;$$;
revoke all on function public.get_formal_document_tools(uuid) from public,anon;
grant execute on function public.get_formal_document_tools(uuid) to authenticated;

create or replace function public.update_formal_draft(p_document_id uuid,p_title text,p_body_text text,p_metadata jsonb default null) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;u uuid:=auth.uid();access jsonb;rev integer;meta jsonb;change_note text;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 access:=public.get_formal_document_tools(p_document_id);
 if not (access->>'can_edit')::boolean then raise exception 'Редактирование недоступно. Завершите открытое голосование или проверьте полномочия';end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Введите название документа';end if;
 if length(coalesce(p_body_text,''))>1000000 then raise exception 'Текст документа слишком большой';end if;
 meta:=d.metadata;
 if p_metadata ? 'issuer_name' then meta:=meta||jsonb_build_object('issuer_name',left(trim(p_metadata->>'issuer_name'),300));end if;
 if p_metadata ? 'place' then meta:=meta||jsonb_build_object('place',left(trim(p_metadata->>'place'),150));end if;
 if trim(p_title)=d.title and p_body_text is not distinct from d.body_text and meta=d.metadata then return;end if;
 rev:=coalesce((d.metadata->>'revision')::integer,1);
 insert into public.formal_document_revisions(game_id,document_id,revision,title,body_text,metadata,editor_id)
 values(d.game_id,d.id,rev,d.title,d.body_text,d.metadata,u);
 meta:=meta||jsonb_build_object('revision',rev+1,'revision_changed_at',clock_timestamp(),'revision_changed_by',u);
 update public.formal_documents set title=trim(p_title),body_text=p_body_text,metadata=meta,updated_at=clock_timestamp() where id=d.id;
 change_note:=nullif(left(trim(coalesce(p_metadata->>'edit_note','')),2000),'');
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,u,'Сохранена редакция '||(rev+1),d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,change_note);
end;$$;
revoke all on function public.update_formal_draft(uuid,text,text,jsonb) from public,anon;
grant execute on function public.update_formal_draft(uuid,text,text,jsonb) to authenticated;

create or replace function public.sign_formal_document(p_document_id uuid,p_note text default null) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;access jsonb;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 access:=public.get_formal_document_tools(p_document_id);
 if not (access->>'can_sign')::boolean then raise exception 'Подписание этой редакции сейчас недоступно';end if;
 if d.status_code in ('signed','published','adopted') then
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,auth.uid(),'Подписана редакция '||coalesce(d.metadata->>'revision','1'),d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,p_note);
 else perform public.advance_formal_document(d.id,'advance',coalesce(nullif(p_note,''),'Подписано уполномоченным лицом'));end if;
end;$$;
revoke all on function public.sign_formal_document(uuid,text) from public,anon;
grant execute on function public.sign_formal_document(uuid,text) to authenticated;

create or replace function public.send_formal_document(p_document_id uuid,p_destination text,p_recipient_id uuid default null,p_note text default null,p_move boolean default false) returns integer
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;access jsonb;next_owner text;r record;n integer:=0;before_status text;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 access:=public.get_formal_document_tools(p_document_id);
 if not (access->>'can_copy')::boolean then raise exception 'Направление документа недоступно';end if;
 if length(trim(coalesce(p_note,'')))>2000 then raise exception 'Сопроводительный текст слишком длинный';end if;
 next_owner:=access->>'next_owner';before_status:=d.status_code;
 if p_move and (not (access->>'can_manage')::boolean or p_destination is distinct from next_owner or next_owner in ('author','system') or next_owner is null) then
 raise exception 'Передача по процедуре возможна только следующему ответственному органу';end if;
 if not p_move and p_destination not in ('person','president','gd','gd_staff','gd_council','committee','sf','government','ministry','municipality','teacher') then raise exception 'Выберите адресата';end if;
 for r in select gm.user_id,gm.full_name from public.game_members gm
 where gm.game_id=d.game_id and gm.kind<>'observer'
 and (p_recipient_id is null or gm.user_id=p_recipient_id)
 and (p_destination='person' or (p_destination='teacher' and gm.kind='teacher')
 or (gm.kind='student' and exists(select 1 from private.formal_user_roles(d.game_id,gm.user_id) rt where case p_destination
 when 'president' then rt like '%президент%'
 when 'gd' then rt like '%депутат%' or rt like '%государственн%дум%'
 when 'gd_staff' then rt like '%председател%дум%'
 when 'gd_council' then (rt like '%совет%' or rt like '%председател%') and rt like '%дум%'
 when 'committee' then rt like '%комитет%' or rt like '%депутат%'
 when 'sf' then rt like '%сенатор%' or rt like '%совет федерац%'
 when 'government' then rt like '%правительств%' or rt like '%министр%'
 when 'ministry' then rt like '%министр%'
 when 'municipality' then rt like '%муницип%' or rt like '%глава города%' or rt like '%администрац%'
 else false end)))
 loop
 insert into public.formal_document_deliveries(game_id,document_id,sender_id,recipient_id,destination,note,delivery_kind)
 values(d.game_id,d.id,auth.uid(),r.user_id,p_destination,nullif(trim(p_note),''),case when p_move then 'procedure' else 'copy' end);n:=n+1;
 end loop;
 if n=0 then raise exception 'У выбранного адресата нет назначенных участников игры';end if;
 if p_move then perform public.advance_formal_document(d.id,'advance',p_note);end if;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 select d.id,d.game_id,auth.uid(),case when p_move then 'Документ передан адресатам по процедуре' else 'Направлена копия документа' end,before_status,f.status_code,d.current_owner_key,f.current_owner_key,
 concat_ws(' · ',p_destination,'Получателей: '||n,case when p_recipient_id is not null then (select full_name from public.game_members where game_id=d.game_id and user_id=p_recipient_id) end,nullif(trim(p_note),''))
 from public.formal_documents f where f.id=d.id;
 return n;
end;$$;
revoke all on function public.send_formal_document(uuid,text,uuid,text,boolean) from public,anon;
grant execute on function public.send_formal_document(uuid,text,uuid,text,boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.advance_formal_document(p_document_id uuid, p_action text DEFAULT 'advance'::text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 d public.formal_documents%rowtype;
 v_uid uuid:=(select auth.uid());
 v_next integer;
 v_step jsonb;
 v_from_status text;
 v_from_owner text;
 v_ready jsonb;
begin
 if p_action not in ('advance','return','reject') then raise exception 'Неизвестное действие';end if;
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null then raise exception 'Document not found'; end if;
 if v_uid is null or not private.is_game_member(d.game_id) then raise exception 'Game access required'; end if;
 if not private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id) then raise exception 'Current stage belongs to another institution'; end if;

 v_from_status:=d.status_code; v_from_owner:=d.current_owner_key;

 if p_action='return' then
  if d.workflow_key='budget' and d.status_code in ('budget_committee','budget_council') then
   v_next:=1;
   update public.formal_documents
   set current_step=v_next,status_code='revision',
       status_label='Возвращён Правительству на доработку',
       current_owner_key='government',updated_at=now()
   where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,v_uid,'Проект бюджета возвращён Правительству на доработку',v_from_status,'revision',v_from_owner,'government',p_note);
  else
   v_next:=0;v_step:=d.workflow_steps->v_next;
   update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён на доработку',current_owner_key='author',updated_at=now() where id=d.id;
   insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
   values(d.id,d.game_id,v_uid,'Возвращён на доработку',v_from_status,'revision',v_from_owner,'author',p_note);
  end if;
 elsif p_action='reject' then
  update public.formal_documents set status_code='rejected',status_label='Отклонён',current_owner_key='system',updated_at=now() where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,'Отклонён',v_from_status,'rejected',v_from_owner,'system',p_note);
 else
  if private.formal_vote_required(d) then raise exception 'Эта стадия завершается результатом голосования';end if;
  if exists(select 1 from public.game_votes where formal_document_id=d.id and status='open') then raise exception 'Сначала завершите открытое голосование';end if;
  if d.workflow_key='bill' and d.status_code in ('draft','revision') then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'submission_ready')::boolean,false)
   then raise exception 'Bill submission package is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;
  end if;
  if d.workflow_key='bill' and d.status_code='committee' then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'committee_ready')::boolean,false)
   then raise exception 'Committee review is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'review_issues')),'; '); end if;
  end if;
  if d.workflow_key='budget' and d.status_code='budget_committee'
     and not private.budget_preliminary_ready(d.id)
  then raise exception 'Complete the Budget Committee preliminary review before sending the project to the State Duma Council'; end if;

  v_next:=d.current_step+1;
  if v_next>=jsonb_array_length(d.workflow_steps) then raise exception 'Workflow already completed'; end if;
  v_step:=d.workflow_steps->v_next;
  update public.formal_documents
  set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
      current_owner_key=v_step->>'owner',updated_at=now()
  where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,coalesce(d.workflow_steps->d.current_step->>'action','Передан далее'),v_from_status,v_step->>'code',v_from_owner,v_step->>'owner',p_note);
 end if;
end;$function$
;
CREATE OR REPLACE FUNCTION private.capture_formal_document_signature()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare sig text;person text;office text;snapshot jsonb;signed_time timestamptz:=clock_timestamp();
begin
 if new.action like 'Сохранена редакция %' then return new;end if;
 if new.actor_id is null then return new;end if;
 if coalesce(new.to_status,'')<>'signed' and coalesce(trim(new.action),'') !~* '^подпис'
  and coalesce(trim(new.note),'') !~* '^подписан(о|а)' then return new;end if;
 select gm.full_name,gm.role_title into person,office from public.game_members gm where gm.game_id=new.game_id and gm.user_id=new.actor_id;
 select coalesce((select a.role_title from public.game_office_assignments a where a.game_id=new.game_id and a.user_id=new.actor_id and a.status='active' and case new.from_owner when 'president' then lower(a.role_title) like '%президент%' when 'ministry' then lower(a.role_title) like '%министр%' when 'government' then lower(a.role_title) like '%правительств%' when 'municipality' then lower(a.role_title) like '%муницип%' when 'gd' then lower(a.role_title) like '%дум%' else false end order by a.created_at desc limit 1),office) into office;
 snapshot:=jsonb_build_object('signed_name',person,'signed_role',office,'signed_on',signed_time,'signed_by',new.actor_id);
 perform set_config('app.formal_signature_snapshot',snapshot::text,true);
 update public.formal_documents set metadata=coalesce(metadata,'{}'::jsonb)||snapshot where id=new.document_id;
 perform set_config('app.formal_signature_snapshot','{}',true);
 select p.signature_path into sig from public.game_profiles p where p.game_id=new.game_id and p.user_id=new.actor_id;
 if sig is not null then
  insert into public.formal_document_signatures(document_id,game_id,history_id,signer_id,signature_path,signed_at)
  values(new.document_id,new.game_id,new.id,new.actor_id,sig,signed_time) on conflict(history_id) do nothing;
 end if;
 return new;
end;$function$
;
