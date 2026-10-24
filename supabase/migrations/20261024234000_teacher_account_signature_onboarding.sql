-- Preserve all existing prerequisites; only make the signature check account-aware.
-- The checklist and final completion use exactly the same physical-file validation.
CREATE OR REPLACE FUNCTION private.profile_signature_exists(
 p_game uuid,p_user uuid,p_kind text,p_game_path text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $function$
 SELECT p_user=(select auth.uid()) AND (
  (p_kind='teacher' AND EXISTS(
    SELECT 1
    FROM public.teacher_profiles tp JOIN storage.objects o
      ON o.bucket_id='teacher-assets'
     AND tp.signature_path='teacher-assets/'||o.name
    WHERE tp.user_id=p_user
      AND o.name ~ ('^'||p_user::text||'/signature-[0-9a-f-]{36}[.]png$')
  ))
  OR
  (p_game_path LIKE p_game::text||'/profiles/'||p_user::text||'/signature-%'
   AND EXISTS(
     SELECT 1 FROM storage.objects o
      WHERE o.bucket_id='game-assets' AND o.name=p_game_path
   )
  )
 );
$function$;
REVOKE ALL ON FUNCTION private.profile_signature_exists(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.complete_my_game_profile(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare m public.game_members%rowtype;p public.game_profiles%rowtype;u record;
begin
 select * into m from public.game_members where game_id=p_game and user_id=auth.uid();
 if m.user_id is null or m.kind='observer' then raise exception 'Участник или преподаватель обязателен';end if;
 select * into p from public.game_profiles where game_id=p_game and user_id=auth.uid();
 select email,email_confirmed_at,encrypted_password into u from auth.users where id=auth.uid();
 if p.intro_seen_at is null then raise exception 'Сначала посмотрите приветственный комикс';end if;
 if not trim(m.full_name) ~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+'
 then raise exception 'Укажите ФИО полностью';end if;
 if coalesce(p.gender,'unspecified')='unspecified' then raise exception 'Укажите пол';end if;
 if length(trim(coalesce(p.bio,'')))<15 then raise exception 'Добавьте описание не короче 15 символов';end if;
 if not private.profile_signature_exists(p_game,auth.uid(),m.kind::text,p.signature_path)
 then raise exception 'Загрузите собственную игровую подпись';end if;
 if u.email is null or u.email_confirmed_at is null or nullif(u.encrypted_password,'') is null
 then raise exception 'Подтвердите почту и установите личный пароль';end if;
 update public.game_profiles set onboarding_completed_at=coalesce(onboarding_completed_at,now())
 where game_id=p_game and user_id=auth.uid();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_game_profile_setup(p_game uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 m public.game_members%rowtype;
 p public.game_profiles%rowtype;
 account record;
 missing text[] := array[]::text[];
begin
 if auth.uid() is null or not private.is_game_member(p_game) then
  raise exception 'Нет доступа к игре';
 end if;
 select * into m from public.game_members where game_id=p_game and user_id=auth.uid();
 if m.user_id is null or m.kind='observer' then
  raise exception 'Настройка профиля доступна участникам и преподавателю';
 end if;
 select * into p from public.game_profiles where game_id=p_game and user_id=auth.uid();
 if p.onboarding_completed_at is null then
  if trim(coalesce(m.full_name,'')) !~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+' then missing:=array_append(missing,'name');end if;
  if coalesce(p.gender,'unspecified')='unspecified' then missing:=array_append(missing,'gender');end if;
  if length(trim(coalesce(p.bio,'')))<15 then missing:=array_append(missing,'bio');end if;
  if not private.profile_signature_exists(p_game,auth.uid(),m.kind::text,p.signature_path)
  then missing:=array_append(missing,'signature');end if;
  select email,email_confirmed_at,encrypted_password,is_anonymous
    into account from auth.users where id=auth.uid();
  if account.email is null or account.email_confirmed_at is null or coalesce(account.is_anonymous,false) then
   missing:=array_append(missing,'email');
  end if;
  if nullif(account.encrypted_password,'') is null then
   missing:=array_append(missing,'password');
  end if;
 end if;
 return jsonb_build_object(
  'completed',p.onboarding_completed_at is not null,
  'prompt_seen',p.profile_setup_prompt_seen_at is not null or p.onboarding_completed_at is not null,
  'missing',to_jsonb(missing)
 );
end;$function$
;
