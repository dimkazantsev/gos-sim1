-- SINGLE disposable #491 full-chain fixture. Never apply as app migration.
-- Actual production ballot, document, grade, impact and projection functions
-- are installed in separate CI steps, unchanged from their migration sources.
-- Here only supporting tables and RLS are simplified for a single game.
do $guard$begin
 if exists(select 1 from auth.users) or exists(select 1 from public.game_votes) then
   raise exception 'Requires a completely empty disposable Auth/game environment';
 end if;
end;$guard$;
create table public.games(
 id uuid primary key,title text not null,game_code text unique not null,
 owner_id uuid not null references auth.users(id),status text not null default 'running',
 current_round integer not null default 1,created_at timestamptz not null default now()
);
alter table public.game_members add column full_name text;
alter table public.game_members add column team text;
-- Make the 100-client sign-in test use the actual production join_game_as_role
-- function signature. This enum and all supporting tables exist only in the
-- disposable QA database; they are NOT application migrations.
create type public.member_kind as enum ('student','teacher','observer');
alter table public.game_members alter column kind type public.member_kind
 using kind::public.member_kind;
alter table public.game_members add column group_name text;
create extension if not exists pgcrypto with schema extensions;
create table public.invite_codes(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id),
 kind public.member_kind not null,
 code_hash text not null,
 active boolean not null default true
);
create table private.game_group_access_codes(
 game_id uuid not null references public.games(id),
 invite_id uuid not null references public.invite_codes(id),
 group_name text not null
);
create table public.platform_admins(user_id uuid primary key);
create table public.teacher_profiles(user_id uuid primary key);
create table public.audit_log(
 id bigint generated always as identity primary key,
 game_id uuid not null references public.games(id),
 actor_id uuid not null references auth.users(id),
 action text not null,entity_type text not null,
 payload jsonb not null default '{}'::jsonb
);
-- Only service_role prepares disposable invitations. Clients still use the
-- exact production join RPC with real locally signed Auth/JWT.
create or replace function public.qa_unified_seed_invitations(p_game_id uuid)
returns void language plpgsql security definer set search_path='' as $seed$
begin
 if not exists(select 1 from public.qa_unified_chain_guard
   where marker='gos-id-disposable-100x16-jwt-chain-20261030')
 then raise exception 'Disposable QA marker missing'; end if;
 insert into public.invite_codes(game_id,kind,code_hash,active)
 values
 (p_game_id,'student',extensions.crypt('STD-LOCAL-100',extensions.gen_salt('bf',6)),true),
 (p_game_id,'observer',extensions.crypt('GST-LOCAL-100',extensions.gen_salt('bf',6)),true),
 (p_game_id,'teacher',extensions.crypt('TCH-LOCAL-100',extensions.gen_salt('bf',6)),true);
end;$seed$;
revoke all on function public.qa_unified_seed_invitations(uuid) from public,anon,authenticated;
grant execute on function public.qa_unified_seed_invitations(uuid) to service_role;
revoke all on public.invite_codes,public.platform_admins,public.teacher_profiles,public.audit_log from public,anon,authenticated;
revoke all on private.game_group_access_codes from public,anon,authenticated;
create or replace function private.is_game_member(g uuid)
returns boolean language sql stable security definer set search_path='' as $f$
 select auth.uid() is not null and exists(select 1 from public.game_members
 where game_id=g and user_id=auth.uid()) $f$;
create or replace function private.is_game_teacher(g uuid)
returns boolean language sql stable security definer set search_path='' as $f$
 select auth.uid() is not null and exists(select 1 from public.game_members
 where game_id=g and user_id=auth.uid() and kind='teacher') $f$;
revoke all on function private.is_game_member(uuid),private.is_game_teacher(uuid) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_game_member(uuid),private.is_game_teacher(uuid) to authenticated;
alter table public.game_members enable row level security;
revoke all on public.game_members from public,anon,authenticated;
create table public.game_stages(
 game_id uuid not null references public.games(id),stage_no integer not null check(stage_no between 1 and 16),
 status text not null check(status in ('open','completed','locked')),primary key(game_id,stage_no)
);
alter table public.game_stages enable row level security;
create policy qa_stage_read on public.game_stages for select to authenticated using(private.is_game_member(game_id));
create policy qa_stage_teacher_update on public.game_stages for update to authenticated
 using(private.is_game_teacher(game_id)) with check(private.is_game_teacher(game_id));
revoke all on public.game_stages from public,anon,authenticated;
grant select,update(status) on public.game_stages to authenticated;

create table public.formal_documents(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id),
 stage_no integer not null check(stage_no between 1 and 16),
 registry_no text,title text,doc_type text not null,subject_key text,
 author_id uuid references auth.users(id),body_text text,
 status_code text not null,source_file_path text,metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.formal_document_history(
 id bigserial primary key,document_id uuid references public.formal_documents(id),
 game_id uuid not null references public.games(id),actor_id uuid references auth.users(id),
 action text,note text,created_at timestamptz not null default now()
);
alter table public.formal_documents enable row level security;
alter table public.formal_document_history enable row level security;
create policy qa_formal_doc_read on public.formal_documents for select to authenticated
 using(private.is_game_member(game_id) and
 (doc_type<>'justice_response' or private.is_game_teacher(game_id) or author_id=auth.uid()));
create policy qa_formal_history_read on public.formal_document_history for select to authenticated
 using(private.is_game_member(game_id));
revoke all on public.formal_documents,public.formal_document_history from public,anon,authenticated;
grant select on public.formal_documents,public.formal_document_history to authenticated;

create table public.stage_assessments(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id),
 user_id uuid not null references auth.users(id),stage_no integer not null check(stage_no between 1 and 16),
 auto_score integer not null,final_score integer,status text not null,
 evidence_summary jsonb default '{}'::jsonb,rationale text,unique(game_id,user_id,stage_no)
);
alter table public.stage_assessments enable row level security;
revoke all on public.stage_assessments from public,anon,authenticated;
grant select on public.stage_assessments to authenticated;

create table public.impact_rules(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id),
 rule_key text not null,label text not null,event_type text not null,description text,
 conditions jsonb not null default '{}'::jsonb,effects jsonb not null default '{}'::jsonb,
 enabled boolean not null default true,auto_apply boolean not null default true,
 priority integer not null default 100,created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(game_id,rule_key)
);
create table public.impact_ledger(
 id bigserial primary key,game_id uuid not null references public.games(id),
 rule_id uuid references public.impact_rules(id),rule_key text not null,source_type text not null,
 source_id text not null,actor_id uuid references auth.users(id),
 effects jsonb not null default '{}'::jsonb,note text,
 status text not null default 'applied',created_at timestamptz not null default now(),reverted_at timestamptz,
 unique(game_id,rule_key,source_type,source_id)
);
create table public.state_metrics(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id),
 metric_key text not null,value numeric not null,min_value numeric,max_value numeric,unique(game_id,metric_key)
);
create table public.game_parties(id uuid primary key,game_id uuid,name text,support numeric);
create table public.party_support_history(
 id bigserial primary key,game_id uuid,party_id uuid,value numeric,previous_value numeric,
 delta numeric,source_type text,source_id text
);
alter table public.impact_rules enable row level security;
alter table public.impact_ledger enable row level security;
alter table public.state_metrics enable row level security;
create policy qa_rule_read on public.impact_rules for select to authenticated using(private.is_game_member(game_id));
create policy qa_ledger_read on public.impact_ledger for select to authenticated using(private.is_game_member(game_id));
create policy qa_metric_read on public.state_metrics for select to authenticated using(private.is_game_member(game_id));
revoke all on public.impact_rules,public.impact_ledger,public.state_metrics from public,anon,authenticated;
grant select on public.impact_rules,public.impact_ledger,public.state_metrics to authenticated;
create function private.impact_condition_matches(jsonb,jsonb)
returns boolean language sql stable as $f$select true$f$;
create function private.record_metric_change(uuid,text,numeric,text,text,uuid,text)
returns void language plpgsql as $f$begin
 update public.state_metrics set value=$3 where game_id=$1 and metric_key=$2;
end$f$;
create table public.qa_unified_chain_guard(marker text primary key);
insert into public.qa_unified_chain_guard values('gos-id-disposable-100x16-jwt-chain-20261030');
revoke all on public.qa_unified_chain_guard from public,anon,authenticated;
grant select on public.qa_unified_chain_guard to service_role;
