-- QA-only simplified formal-document schema. Never apply as an application migration.
-- The get_formal_registry_projection RPC installed afterwards comes unchanged
-- from the production migration. The RLS below is a deliberately reduced
-- local model and DOES NOT assert coverage of every production RLS policy.
do $guard$
begin
  if exists(select 1 from auth.users limit 1)
     or exists(select 1 from public.games limit 1) then
     raise exception 'QA formal registry requires an empty disposable Supabase';
  end if;
end $guard$;

create schema if not exists private;
create or replace function private.is_game_member(p_game uuid)
returns boolean language sql stable security definer set search_path=''
as $func$
  select auth.uid() is not null and exists(
    select 1 from public.game_members m
    where m.game_id=p_game and m.user_id=auth.uid()
  );
$func$;
create or replace function private.is_game_teacher(p_game uuid)
returns boolean language sql stable security definer set search_path=''
as $func$
  select auth.uid() is not null and exists(
    select 1 from public.game_members m
    where m.game_id=p_game and m.user_id=auth.uid() and m.kind='teacher'
  );
$func$;
revoke all on function private.is_game_member(uuid),private.is_game_teacher(uuid) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_game_member(uuid),private.is_game_teacher(uuid) to authenticated;

create table public.formal_documents(
  id uuid primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  stage_no int not null check(stage_no between 1 and 16),
  registry_no text not null,
  title text not null,
  doc_type text not null,
  author_id uuid not null references auth.users(id),
  body_text text not null,
  status_code text not null,
  source_file_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.formal_document_history(
  id bigserial primary key,
  document_id uuid not null references public.formal_documents(id),
  game_id uuid not null references public.games(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  note text not null,
  created_at timestamptz not null default now()
);

alter table public.formal_documents enable row level security;
alter table public.formal_document_history enable row level security;
create policy qa_formal_read on public.formal_documents for select to authenticated
  using(private.is_game_member(game_id)
    and (doc_type<>'justice_response' or private.is_game_teacher(game_id) or author_id=auth.uid()));
create policy qa_formal_history_read on public.formal_document_history for select to authenticated
  using(private.is_game_member(game_id));
revoke all on public.formal_documents,public.formal_document_history from public,anon,authenticated;
grant select on public.formal_documents,public.formal_document_history to authenticated;
-- The QA private membership helper owns the membership check; direct clients
-- must not read the unscoped disposable membership table.
alter table public.game_members enable row level security;
revoke all on public.game_members from public,anon,authenticated;
create table public.qa_formal_registry_guard(marker text primary key);
insert into public.qa_formal_registry_guard values('gos-id-disposable-formal-registry-100-v1');
revoke all on public.qa_formal_registry_guard from public,anon,authenticated;
grant select on public.qa_formal_registry_guard to service_role;
