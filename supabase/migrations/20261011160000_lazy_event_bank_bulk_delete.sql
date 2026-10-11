-- Safe teacher-only mass removal from a game-specific event bank.
-- Archive complete rows before deletion; protect all referenced/played cases.
create or replace function public.delete_unused_event_cases(
 p_game_id uuid,p_case_ids uuid[]
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare n integer; requested integer;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Требуются права преподавателя';
 end if;
 requested:=coalesce(array_length(p_case_ids,1),0);
 if requested<1 or requested>500 or
    requested<>(select count(distinct x) from unnest(p_case_ids) x) then
  raise exception 'Нужно выбрать от 1 до 500 различных ситуаций';
 end if;
 perform 1 from public.event_cases e
  where e.game_id=p_game_id and e.id=any(p_case_ids)
  for update;
 if (select count(*) from public.event_cases e
     where e.game_id=p_game_id and e.id=any(p_case_ids) and e.status='ready')<>requested then
   raise exception 'Состав банка изменился. Обновите список';
 end if;
 if exists(
  select 1 from public.event_assignments x where x.game_id=p_game_id and x.case_id=any(p_case_ids)
  union all select 1 from public.event_decisions x where x.game_id=p_game_id and x.case_id=any(p_case_ids)
  union all select 1 from public.event_case_outcomes x where x.game_id=p_game_id and x.case_id=any(p_case_ids)
  union all select 1 from public.event_collaboration_invites x where x.game_id=p_game_id and x.case_id=any(p_case_ids)
  union all select 1 from public.event_discussion_messages x where x.game_id=p_game_id and x.case_id=any(p_case_ids)
  union all select 1 from public.event_authority_evidence x where x.game_id=p_game_id and x.case_id=any(p_case_ids)
  union all select 1 from public.budget_transfer_requests x where x.game_id=p_game_id and x.event_case_id=any(p_case_ids)
  union all select 1 from private.budget_deferred_risks x where x.game_id=p_game_id and x.case_id=any(p_case_ids)
 ) then raise exception 'Назначенные или используемые ситуации удалять запрещено';end if;
 insert into public.retired_event_cases(game_id,case_key,snapshot)
 select e.game_id,e.case_key,to_jsonb(e)
 from public.event_cases e
 where e.game_id=p_game_id and e.id=any(p_case_ids)
 on conflict(game_id,case_key) do update set snapshot=excluded.snapshot,archived_at=now();
 delete from public.event_cases e where e.game_id=p_game_id and e.id=any(p_case_ids);
 get diagnostics n=row_count;
 if n<>requested then raise exception 'Удалены не все записи — отмена операции';end if;
 return n;
end;
$$;
revoke all on function public.delete_unused_event_cases(uuid,uuid[]) from public, anon;
grant execute on function public.delete_unused_event_cases(uuid,uuid[]) to authenticated;

-- Do not recreate voluntarily removed cases when the teacher verifies the bank.
create or replace function private.seed_authored_event_bank(p_game uuid)
returns integer language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $$
declare added integer;
begin
 if not exists(select 1 from public.games where id=p_game) then raise exception 'Игра недоступна';end if;
 insert into public.event_cases(game_id,case_key,title,situation,category,seriousness,audience,allowed_roles,
  decision_options,effect_plan,comic_scene,source_note,verified,status)
 select p_game,cat.case_key,cat.content->>'title',cat.content->>'situation',cat.content->>'category',cat.content->>'seriousness',
  cat.content->>'audience',array(select jsonb_array_elements_text(cat.content->'allowed_roles')),
  cat.content->'decision_options',cat.content->'effect_plan',cat.content->'comic_scene',cat.content->>'source_note',false,'ready'
 from private.authored_event_catalog cat
 where not exists(select 1 from public.retired_event_cases r where r.game_id=p_game and r.case_key=cat.case_key)
 on conflict(game_id,case_key) do nothing;
 get diagnostics added=row_count;
 return added;
end;
$$;
