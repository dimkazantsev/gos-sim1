-- ГОС.ID · Чтение входа v5: не сканировать холодные коллекции.
-- Встреча: один SECURITY INVOKER RPC сохраняет проверку членства и RLS.
-- Исключены из обязательного ответа: events, evaluations, documents.
-- События, оценки и прежние игровые документы читаются адресно при открытии
-- связанных разделов. Голосования и кризисы остаются для главного экрана.
-- V4 не меняется и используется только при несовпадении версий клиента/БД.
create or replace function public.get_game_entry_v5(p_game_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then
  raise exception 'Нет доступа к игре.' using errcode='42501';
 end if;
 return jsonb_build_object(
  'game', (select to_jsonb(g) from public.games g where g.id=p_game_id),
  'metrics', (select coalesce(jsonb_agg(to_jsonb(x) order by x.label),'[]'::jsonb)
   from public.state_metrics x where x.game_id=p_game_id),
  'channels', (select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb)
   from public.chat_channels x where x.game_id=p_game_id),
  'stages', (select coalesce(jsonb_agg(to_jsonb(x) order by x.stage_no),'[]'::jsonb)
   from public.game_stages x where x.game_id=p_game_id),
  'votes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.opened_at desc),'[]'::jsonb)
   from public.game_votes x where x.game_id=p_game_id),
  'crises', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
   from public.game_crises x where x.game_id=p_game_id),
  'profiles', (select coalesce(jsonb_agg((to_jsonb(x)-'bio')||jsonb_build_object('bio',null)),'[]'::jsonb)
   from public.game_profiles x where x.game_id=p_game_id),
  'formal_documents', (select coalesce(jsonb_agg(((to_jsonb(x)-'body_text')-'metadata')
   ||jsonb_build_object('body_text',null,'metadata','{}'::jsonb) order by x.updated_at desc),'[]'::jsonb)
   from public.formal_documents x where x.game_id=p_game_id),
  'member', (select to_jsonb(m) from public.game_members m
   where m.game_id=p_game_id and m.user_id=auth.uid()),
  'roster', (select coalesce(jsonb_agg(to_jsonb(m) order by m.full_name),'[]'::jsonb)
   from (select game_id,user_id,full_name,group_name,kind,role_title,team,score,joined_at,
       party_joined_at,roster_archived_at
    from public.game_members where game_id=p_game_id) m),
  'parties', (select coalesce(jsonb_agg(to_jsonb(p) order by p.support desc,p.created_at,p.id),'[]'::jsonb)
   from (select id,game_id,created_by,name,support,mandates,regions,budget,leader_user_id,
       color,logo_path,ghost_loss_current,ghost_active,ghost_started_at,
       representation_penalty,regional_seat_penalty,ghost_risk_weight,presidential_rating_modifier,
       registration_status,registration_submitted_at,registration_reviewed_at,registration_reviewed_by,
       mandate_allocation_mode,regional_seats_awarded,created_at,rating
    from public.game_parties where game_id=p_game_id) p),
  'intro', public.has_seen_my_intro()
 );
end;
$function$;
revoke all on function public.get_game_entry_v5(uuid) from public,anon;
grant execute on function public.get_game_entry_v5(uuid) to authenticated;
