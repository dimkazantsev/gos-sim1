-- Mirrors the production migration formal_subject_senator_and_legacy_import.
-- Keeps a senator as a distinct subject of legislative initiative and imports
-- pre-registry documents into the formal institutions registry idempotently.

create or replace function private.can_create_formal_subject(
  p_game uuid,
  p_user uuid,
  p_subject text
)
returns boolean
language sql
stable
security definer
set search_path=public,private,pg_temp
as $$
select case
  when private.is_game_teacher(p_game) then true
  when p_subject='president' then exists(
    select 1 from public.game_members gm
    where gm.game_id=p_game and gm.user_id=p_user
      and coalesce(gm.role_title,'') ilike '%президент%'
  )
  when p_subject='gd_deputy' then exists(
    select 1 from public.game_members gm
    where gm.game_id=p_game and gm.user_id=p_user
      and coalesce(gm.role_title,'') ilike '%депутат%'
  )
  when p_subject='gd' then exists(
    select 1 from public.game_members gm
    where gm.game_id=p_game and gm.user_id=p_user
      and (
        coalesce(gm.role_title,'') ilike '%председател%дум%'
        or coalesce(gm.role_title,'') ilike '%совет%дум%'
      )
  )
  when p_subject='sf' then exists(
    select 1 from public.game_members gm
    where gm.game_id=p_game and gm.user_id=p_user
      and (
        coalesce(gm.role_title,'') ilike '%председател%совет%федерац%'
        or coalesce(gm.role_title,'') ilike '%совет%федерац%'
      )
  )
  when p_subject='sf_member' then exists(
    select 1 from public.game_members gm
    where gm.game_id=p_game and gm.user_id=p_user
      and coalesce(gm.role_title,'') ilike '%сенатор%'
  )
  when p_subject='government' then exists(
    select 1 from public.game_members gm
    where gm.game_id=p_game and gm.user_id=p_user
      and (
        coalesce(gm.role_title,'') ilike '%правительств%'
        or coalesce(gm.role_title,'') ilike '%министр%'
      )
  )
  when p_subject='region' then exists(
    select 1 from public.game_members gm
    where gm.game_id=p_game and gm.user_id=p_user
      and (
        coalesce(gm.role_title,'') ilike '%регион%'
        or coalesce(gm.role_title,'') ilike '%субъект%'
        or coalesce(gm.role_title,'') ilike '%законодательн%'
      )
  )
  when p_subject='ks' then exists(
    select 1 from public.game_members gm
    where gm.game_id=p_game and gm.user_id=p_user
      and coalesce(gm.role_title,'') ilike '%конституционн%суд%'
  )
  when p_subject='vs' then exists(
    select 1 from public.game_members gm
    where gm.game_id=p_game and gm.user_id=p_user
      and coalesce(gm.role_title,'') ilike '%верховн%суд%'
  )
  when p_subject='ministry' then exists(
    select 1 from public.game_members gm
    where gm.game_id=p_game and gm.user_id=p_user
      and (
        coalesce(gm.role_title,'') ilike '%министр%'
        or coalesce(gm.role_title,'') ilike '%министерств%'
      )
  )
  when p_subject='municipality' then exists(
    select 1 from public.game_members gm
    where gm.game_id=p_game and gm.user_id=p_user
      and (
        coalesce(gm.role_title,'') ilike '%муницип%'
        or coalesce(gm.role_title,'') ilike '%глава города%'
        or coalesce(gm.role_title,'') ilike '%администрац%'
      )
  )
  else false
end;
$$;

insert into public.formal_documents(
  id,
  game_id,
  stage_no,
  registry_no,
  title,
  doc_type,
  subject_key,
  subject_label,
  author_id,
  body_text,
  workflow_key,
  workflow_steps,
  current_step,
  status_code,
  status_label,
  current_owner_key,
  metadata,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  g.game_id,
  12,
  'ИГРА-АРХ-' || lpad(nextval('public.formal_registry_seq')::text,4,'0'),
  g.title,
  'other',
  'archive',
  'Архив прежнего раздела',
  g.created_by,
  g.body,
  'generic',
  private.formal_workflow('generic'),
  2,
  'published',
  'Архивный документ',
  'system',
  jsonb_build_object(
    'legacy_document_id',g.id,
    'legacy_doc_type',g.doc_type
  ),
  g.created_at,
  g.created_at
from public.game_documents g
where g.created_by is not null
  and not exists(
    select 1
    from public.formal_documents f
    where f.metadata->>'legacy_document_id'=g.id::text
  );
