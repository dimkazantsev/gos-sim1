-- Secure deletion of formal NPA documents.
-- Applied to production as migration 20261005041236.

drop policy if exists "guests_cannot_delete" on public.formal_documents;
revoke delete on table public.formal_documents from authenticated;

create or replace function public.delete_formal_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
declare
  v_uid uuid := (select auth.uid());
  d public.formal_documents%rowtype;
  v_teacher boolean;
  v_vote record;
  v_deleted boolean := false;
begin
  select * into d
  from public.formal_documents
  where id = p_document_id
  for update;

  if d.id is null or v_uid is null or not private.is_game_member(d.game_id) then
    raise exception 'Документ недоступен';
  end if;

  v_teacher := private.is_game_teacher(d.game_id);

  if not (v_teacher or d.author_id = v_uid) then
    raise exception 'Удалить НПА может только его автор или преподаватель';
  end if;

  if exists (
    select 1
    from public.game_votes
    where formal_document_id = d.id
      and status = 'open'
  ) and not v_teacher then
    raise exception 'Сначала завершите или удалите открытое голосование по этому НПА';
  end if;

  if v_teacher then
    for v_vote in
      select id
      from public.game_votes
      where formal_document_id = d.id
        and status = 'open'
      order by opened_at
    loop
      perform public.delete_procedural_vote(v_vote.id);
    end loop;
  end if;

  delete from public.formal_documents
  where id = d.id;

  v_deleted := found;

  return jsonb_build_object(
    'deleted', v_deleted,
    'id', d.id,
    'registry_no', d.registry_no
  );
end;
$function$;

revoke all on function public.delete_formal_document(uuid) from public;
revoke all on function public.delete_formal_document(uuid) from anon;
grant execute on function public.delete_formal_document(uuid) to authenticated;
