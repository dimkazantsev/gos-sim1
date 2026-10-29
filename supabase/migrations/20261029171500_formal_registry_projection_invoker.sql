-- ГОС.ID · Шаг 2/9: объединённое чтение реестра НПА и истории документов.
-- Только транспорт данных: не менять тела, версии, подписи, маршруты и записи.
-- SECURITY INVOKER сохраняет SELECT/RLS каждой таблицы для вызывающей роли.
create or replace function public.get_formal_registry_projection(
  p_game_id uuid,
  p_document_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if auth.uid() is null or not private.is_game_member(p_game_id) then
    raise exception 'Нет доступа к игре.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'documents', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.updated_at desc)
      from (
        select * from public.formal_documents
        where game_id = p_game_id
          and (p_document_ids is null or id = any(p_document_ids))
      ) d
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.created_at desc)
      from (
        select * from public.formal_document_history
        where game_id = p_game_id
          and (p_document_ids is null or document_id = any(p_document_ids))
      ) h
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_formal_registry_projection(uuid, uuid[]) from public, anon;
grant execute on function public.get_formal_registry_projection(uuid, uuid[]) to authenticated;
