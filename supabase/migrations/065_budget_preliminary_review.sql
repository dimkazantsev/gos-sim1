-- Stage 13: preliminary State Duma review before first reading of the federal budget.
create table if not exists public.budget_preliminary_reviews(
 document_id uuid primary key references public.formal_documents(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 documents_compliant boolean not null default false,
 sent_to_all_committees boolean not null default false,
 accounts_chamber_reviewed boolean not null default false,
 committee_conclusion text not null default '',
 decision text not null default 'draft' check(decision in ('draft','accept','return')),
 note text,
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
create index if not exists budget_preliminary_reviews_game_idx on public.budget_preliminary_reviews(game_id,decision);
alter table public.budget_preliminary_reviews enable row level security;
revoke all privileges on table public.budget_preliminary_reviews from anon,authenticated;
grant select on table public.budget_preliminary_reviews to authenticated;
drop policy if exists budget_preliminary_reviews_read on public.budget_preliminary_reviews;
create policy budget_preliminary_reviews_read on public.budget_preliminary_reviews for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='budget_preliminary_reviews')
 then alter publication supabase_realtime add table public.budget_preliminary_reviews; end if;
end $$;

create or replace function private.budget_workflow_v2()
returns jsonb language sql immutable set search_path='' as $$
select '[
 {"code":"draft","label":"Проект федерального бюджета","owner":"author","action":"Внести в Правительство"},
 {"code":"government","label":"Правительство / Минфин","owner":"government","action":"Внести проект в Государственную Думу"},
 {"code":"budget_registered","label":"Зарегистрирован в Государственной Думе","owner":"gd_staff","action":"Направить в Комитет по бюджету"},
 {"code":"budget_committee","label":"Предварительная проверка Комитетом по бюджету","owner":"committee","action":"Передать заключение в Совет ГД"},
 {"code":"budget_council","label":"Совет Государственной Думы","owner":"gd_council","action":"Принять к рассмотрению и назначить I чтение"},
 {"code":"reading1","label":"I чтение бюджета","owner":"gd","action":"Принять основные характеристики"},
 {"code":"amendments","label":"Поправки ко II чтению","owner":"committee","action":"Передать на II чтение"},
 {"code":"reading2","label":"II чтение бюджета","owner":"gd","action":"Принять поправки"},
 {"code":"reading3","label":"III чтение бюджета","owner":"gd","action":"Принять бюджет в целом"},
 {"code":"sf","label":"Совет Федерации","owner":"sf","action":"Рассмотреть бюджет"},
 {"code":"president","label":"Президент Российской Федерации","owner":"president","action":"Подписать бюджет"},
 {"code":"published","label":"Подписан и опубликован","owner":"system","action":null}
]'::jsonb;
$$;
revoke execute on function private.budget_workflow_v2() from public,anon,authenticated;

create or replace function private.apply_budget_workflow_v2()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if new.workflow_key='budget' then
  new.workflow_steps:=private.budget_workflow_v2();
  if new.current_step=0 then
   new.status_code:='draft';new.status_label:='Проект федерального бюджета';new.current_owner_key:='author';
  end if;
 end if;
 return new;
end;$$;
revoke execute on function private.apply_budget_workflow_v2() from public,anon,authenticated;
drop trigger if exists trg_budget_workflow_v2 on public.formal_documents;
create trigger trg_budget_workflow_v2 before insert on public.formal_documents for each row execute function private.apply_budget_workflow_v2();

update public.formal_documents
set workflow_steps=private.budget_workflow_v2(),
    current_step=case when status_code='government' then 1 else 0 end,
    status_code=case when status_code='government' then 'government' else 'draft' end,
    status_label=case when status_code='government' then 'Правительство / Минфин' else 'Проект федерального бюджета' end,
    current_owner_key=case when status_code='government' then 'government' else 'author' end,
    updated_at=now()
where workflow_key='budget' and status_code in ('draft','government');

create or replace function private.can_review_budget_preliminary(p_document uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(
  select 1 from public.formal_documents d where d.id=p_document and d.workflow_key='budget' and (
   private.is_game_teacher(d.game_id)
   or private.matches_formal_owner(d.game_id,p_user,'committee',d.author_id)
   or private.matches_formal_owner(d.game_id,p_user,'gd_staff',d.author_id)
   or private.matches_formal_owner(d.game_id,p_user,'gd_council',d.author_id)
  )
 );
$$;
revoke execute on function private.can_review_budget_preliminary(uuid,uuid) from public,anon,authenticated;

create or replace function public.save_budget_preliminary_review(
 p_document_id uuid,p_documents_compliant boolean,p_sent_to_all_committees boolean,p_accounts_chamber_reviewed boolean,
 p_committee_conclusion text,p_decision text,p_note text default null
) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or d.workflow_key<>'budget' then raise exception 'Federal budget document not found'; end if;
 if not private.can_review_budget_preliminary(d.id,v_uid) then raise exception 'Budget Committee / Duma staff / teacher access required'; end if;
 if p_decision not in ('draft','accept','return') then raise exception 'Unsupported preliminary review decision'; end if;
 if p_decision='accept' and (
   not coalesce(p_documents_compliant,false) or not coalesce(p_sent_to_all_committees,false)
   or not coalesce(p_accounts_chamber_reviewed,false) or length(trim(coalesce(p_committee_conclusion,'')))<10
 ) then raise exception 'Complete compliance review, committee distribution, Accounts Chamber review and committee conclusion before acceptance'; end if;
 insert into public.budget_preliminary_reviews(document_id,game_id,documents_compliant,sent_to_all_committees,accounts_chamber_reviewed,committee_conclusion,decision,note,updated_by,updated_at)
 values(d.id,d.game_id,coalesce(p_documents_compliant,false),coalesce(p_sent_to_all_committees,false),coalesce(p_accounts_chamber_reviewed,false),trim(coalesce(p_committee_conclusion,'')),p_decision,nullif(trim(coalesce(p_note,'')),''),v_uid,now())
 on conflict(document_id) do update set documents_compliant=excluded.documents_compliant,sent_to_all_committees=excluded.sent_to_all_committees,accounts_chamber_reviewed=excluded.accounts_chamber_reviewed,committee_conclusion=excluded.committee_conclusion,decision=excluded.decision,note=excluded.note,updated_by=v_uid,updated_at=now();
end;$$;
revoke all on function public.save_budget_preliminary_review(uuid,boolean,boolean,boolean,text,text,text) from public,anon;
grant execute on function public.save_budget_preliminary_review(uuid,boolean,boolean,boolean,text,text,text) to authenticated;

create or replace function private.budget_preliminary_ready(p_document uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(select 1 from public.budget_preliminary_reviews where document_id=p_document and documents_compliant and sent_to_all_committees and accounts_chamber_reviewed and length(trim(committee_conclusion))>=10 and decision='accept');
$$;
revoke execute on function private.budget_preliminary_ready(uuid) from public,anon,authenticated;

create or replace function public.advance_formal_document(p_document_id uuid,p_action text default 'advance',p_note text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_next integer;v_step jsonb;v_from_status text;v_from_owner text;v_ready jsonb;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null then raise exception 'Document not found'; end if;
 if v_uid is null or not private.is_game_member(d.game_id) then raise exception 'Game access required'; end if;
 if not private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id) then raise exception 'Current stage belongs to another institution'; end if;
 v_from_status:=d.status_code;v_from_owner:=d.current_owner_key;
 if p_action='return' then
  if d.workflow_key='budget' and d.status_code in ('budget_committee','budget_council') then
   v_next:=1;
   update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён Правительству на доработку',current_owner_key='government',updated_at=now() where id=d.id;
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
  if d.workflow_key='bill' and d.status_code in ('draft','revision') then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'submission_ready')::boolean,false) then raise exception 'Bill submission package is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;
  end if;
  if d.workflow_key='bill' and d.status_code='committee' then
   v_ready:=private.bill_dossier_readiness_json(d.id);
   if not coalesce((v_ready->>'committee_ready')::boolean,false) then raise exception 'Committee review is incomplete: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'review_issues')),'; '); end if;
  end if;
  if d.workflow_key='budget' and d.status_code='budget_committee' and not private.budget_preliminary_ready(d.id)
  then raise exception 'Complete the Budget Committee preliminary review before sending the project to the State Duma Council'; end if;
  v_next:=d.current_step+1;
  if v_next>=jsonb_array_length(d.workflow_steps) then raise exception 'Workflow already completed'; end if;
  v_step:=d.workflow_steps->v_next;
  update public.formal_documents set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',current_owner_key=v_step->>'owner',updated_at=now() where id=d.id;
  insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
  values(d.id,d.game_id,v_uid,coalesce(d.workflow_steps->d.current_step->>'action','Передан далее'),v_from_status,v_step->>'code',v_from_owner,v_step->>'owner',p_note);
 end if;
end;$$;
revoke all on function public.advance_formal_document(uuid,text,text) from public,anon;
grant execute on function public.advance_formal_document(uuid,text,text) to authenticated;

create or replace function public.resolve_budget_conciliation(p_document_id uuid,p_action text,p_note text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_step jsonb;v_next integer;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null or d.workflow_key<>'budget' or d.status_code<>'budget_conciliation' then raise exception 'Budget is not in conciliation'; end if;
 if not (private.is_game_teacher(d.game_id) or private.vote_member_matches(d.game_id,v_uid,'gd') or private.vote_member_matches(d.game_id,v_uid,'government') or private.vote_member_matches(d.game_id,v_uid,'sf')) then raise exception 'Conciliation commission role required'; end if;
 if p_action='agreed' then
  select ordinality-1 into v_next from jsonb_array_elements(d.workflow_steps) with ordinality x(step,ordinality) where step->>'code'='reading1' limit 1;
  if v_next is null then raise exception 'First-reading step not found'; end if;
  v_step:=d.workflow_steps->v_next;
  update public.formal_documents set current_step=v_next,status_code=v_step->>'code',status_label='Повторное I чтение после согласительной комиссии',current_owner_key=v_step->>'owner',updated_at=now() where id=d.id;
 elsif p_action='government_revision' then
  select ordinality-1 into v_next from jsonb_array_elements(d.workflow_steps) with ordinality x(step,ordinality) where step->>'code'='government' limit 1;
  if v_next is null then v_next:=1; end if;
  update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён Правительству на доработку',current_owner_key='government',updated_at=now() where id=d.id;
 else raise exception 'Unsupported conciliation action'; end if;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 select d.id,d.game_id,v_uid,case when p_action='agreed' then 'Согласительная комиссия выработала согласованный вариант' else 'Бюджет возвращён Правительству на доработку' end,d.status_code,fd.status_code,d.current_owner_key,fd.current_owner_key,p_note from public.formal_documents fd where fd.id=d.id;
end;$$;
revoke all on function public.resolve_budget_conciliation(uuid,text,text) from public,anon;
grant execute on function public.resolve_budget_conciliation(uuid,text,text) to authenticated;

create or replace function public.start_budget_rejection_branch(p_document_id uuid,p_action text,p_note text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_uid uuid:=(select auth.uid());v_next integer;
begin
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null or d.workflow_key<>'budget' or d.status_code<>'reading1' then raise exception 'Budget is not at rejected first reading branch'; end if;
 if not exists(select 1 from public.game_votes v where v.formal_document_id=d.id and v.formal_step_code='reading1' and v.status='closed' and v.result_code='rejected') then raise exception 'No rejected first-reading vote found'; end if;
 if not (private.is_game_teacher(d.game_id) or private.can_close_procedural_vote(d.game_id,v_uid,'gd',d.id)) then raise exception 'Presiding State Duma authority required'; end if;
 if p_action='conciliation' then
  update public.formal_documents set status_code='budget_conciliation',status_label='Согласительная комиссия после отклонения в I чтении',current_owner_key='committee',updated_at=now() where id=d.id;
 elsif p_action='government_revision' then
  select ordinality-1 into v_next from jsonb_array_elements(d.workflow_steps) with ordinality x(step,ordinality) where step->>'code'='government' limit 1;
  if v_next is null then v_next:=1; end if;
  update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён Правительству на доработку после I чтения',current_owner_key='government',updated_at=now() where id=d.id;
 else raise exception 'Unsupported budget rejection branch'; end if;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 select d.id,d.game_id,v_uid,case when p_action='conciliation' then 'После отклонения бюджета в I чтении создана согласительная комиссия' else 'После отклонения бюджета в I чтении проект возвращён Правительству' end,d.status_code,fd.status_code,d.current_owner_key,fd.current_owner_key,p_note from public.formal_documents fd where fd.id=d.id;
end;$$;
revoke all on function public.start_budget_rejection_branch(uuid,text,text) from public,anon;
grant execute on function public.start_budget_rejection_branch(uuid,text,text) to authenticated;