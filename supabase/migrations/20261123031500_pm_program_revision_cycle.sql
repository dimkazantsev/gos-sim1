-- ГОС.ID: возврат госпрограммы Председателем Правительства с письменными замечаниями.
-- Используются существующие статусы и одна дополнительная колонка паспорта.
ALTER TABLE public.state_programs ADD COLUMN IF NOT EXISTS pm_revision_reason text;
COMMENT ON COLUMN public.state_programs.pm_revision_reason IS
 'Замечания Председателя Правительства. При повторной отправке переводят доработанную программу сразу к Председателю.';

-- Существующие блокировки строки, авторизация и проверка готовности сохранены.
CREATE OR REPLACE FUNCTION public.advance_state_program(p_program_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.state_programs%rowtype;v_uid uuid:=(select auth.uid());v_is_pm boolean;v_ready jsonb;
begin
 perform private.lock_active_program_actor((select game_id from public.state_programs where id=p_program_id));
 select * into p from public.state_programs where id=p_program_id for update;
 if p.id is null then raise exception 'Program not found'; end if;
 if v_uid is null or not private.is_game_member(p.game_id) or private.is_game_observer(p.game_id) then raise exception 'Game participant access required';end if;
 if not private.is_game_teacher(p.game_id) and not private.role_is_available(p.game_id,v_uid) then raise exception 'Участник недоступен для согласования';end if;
 select exists(select 1 from private.formal_user_roles(p.game_id,v_uid) r where r ~* '^председатель[[:space:]]+правительства([[:space:]]|$)') into v_is_pm;
 if p_action='pm_ready' and p.signed_at is not null then
  if not private.is_game_teacher(p.game_id) and not v_is_pm then raise exception 'Prime Minister access required';end if;
  return;
 end if;
 if p_action='submit_minister' then
  if p.status not in ('draft','revision') then raise exception 'Program is not awaiting submission';end if;
  if not private.can_edit_state_program(p.id,v_uid) then raise exception 'Program editing access required'; end if;
  v_ready:=private.state_program_readiness_json(p.id);
  if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Program is not ready: %',array_to_string(array(select jsonb_array_elements_text(v_ready->'issues')),'; '); end if;
  update public.state_programs set status=case when p.status='revision' and nullif(btrim(p.pm_revision_reason),'') is not null then 'pm_review' else 'minister_review' end,updated_at=now() where id=p.id;
 elsif p_action in ('minister_approve','minister_revision') then
  if p.status<>'minister_review' then raise exception 'Program is not awaiting minister review';end if;
  if not private.is_game_teacher(p.game_id) and p.responsible_minister_id is distinct from v_uid then raise exception 'Responsible minister access required'; end if;
  if p_action='minister_approve' then
   v_ready:=private.state_program_readiness_json(p.id);
   if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Программа не готова: %',v_ready->'issues';end if;
  end if;
  update public.state_programs set status=case when p_action='minister_approve' then 'pm_review' else 'revision' end,updated_at=now() where id=p.id;
 elsif p_action in ('pm_ready','pm_revision') then
  if p_action='pm_revision' then raise exception 'Укажите причину возврата в форме Председателя Правительства';end if;
  if p.status<>'pm_review' then raise exception 'Program is not awaiting Prime Minister review';end if;
  if not private.is_game_teacher(p.game_id) and not v_is_pm then raise exception 'Prime Minister access required'; end if;
  if p_action='pm_ready' then
   v_ready:=private.state_program_readiness_json(p.id);
   if not coalesce((v_ready->>'ready')::boolean,false) then raise exception 'Программа не готова к подписи: %',v_ready->'issues';end if;
  end if;
  update public.state_programs set status=case when p_action='pm_ready' then 'ready' else 'revision' end,updated_at=now() where id=p.id;
  -- Preliminary PM approval transfers the unsigned programme to the Government agenda.
  -- The PM signs and publishes only after a passed vote.
 else raise exception 'Unsupported program action'; end if;
end;$function$;

CREATE OR REPLACE FUNCTION public.request_state_program_revision(p_program_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_temp AS $fn$
DECLARE
 p public.state_programs%rowtype;
 v_uid uuid:=(select auth.uid());
 v_reason text:=btrim(coalesce(p_reason,''));
 v_is_pm boolean;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Войдите в игру';END IF;
 IF char_length(v_reason) NOT BETWEEN 10 AND 1500
 THEN RAISE EXCEPTION 'Укажите причину возврата (от 10 до 1500 символов)';END IF;
 PERFORM private.lock_active_program_actor((SELECT game_id FROM public.state_programs WHERE id=p_program_id));
 SELECT * INTO p FROM public.state_programs WHERE id=p_program_id FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Программа не найдена';END IF;
 IF NOT private.is_game_member(p.game_id) OR private.is_game_observer(p.game_id)
    OR (NOT private.is_game_teacher(p.game_id) AND NOT private.role_is_available(p.game_id,v_uid))
 THEN RAISE EXCEPTION 'Нет доступа к программе';END IF;
 SELECT EXISTS(SELECT 1 FROM private.formal_user_roles(p.game_id,v_uid) r
    WHERE r ~* '^председатель[[:space:]]+правительства([[:space:]]|$)')
 INTO v_is_pm;
 IF NOT private.is_game_teacher(p.game_id) AND NOT v_is_pm
 THEN RAISE EXCEPTION 'Только Председатель Правительства может вернуть программу';END IF;
 IF p.status<>'pm_review' OR p.signed_at IS NOT NULL
 THEN RAISE EXCEPTION 'Возврат доступен только до согласования и подписания программы';END IF;
 UPDATE public.state_programs
 SET status='revision',pm_revision_reason=v_reason,updated_at=now()
 WHERE id=p.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.request_state_program_revision(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_state_program_revision(uuid,text) TO authenticated;
