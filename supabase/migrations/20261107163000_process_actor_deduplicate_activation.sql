-- ГОС.ID: eliminate duplicate role activation checks on publisher picker reads.
-- The called private.process_actor_label function retains all authorization,
-- formed-actor checks, teacher privileges and exact approved role labels.
-- Preserve historic behaviour: the KSRF publisher was teacher-only in this picker.
-- CREATE OR REPLACE preserves the current EXECUTE grants and owner.
CREATE OR REPLACE FUNCTION public.get_process_actors(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare result jsonb:='[]'::jsonb;k text;label text;a record;
 v_uid uuid:=(select auth.uid());v_teacher boolean;
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 v_teacher:=private.is_game_teacher(p_game_id);
 foreach k in array array['participant','ksrf','office','party','president','government',
 'gd','sf','ministry','municipality','media','minjust','interior',
 'cec','ks','vs','central_bank','accounts'] loop
  if v_teacher and k in ('ministry','minjust','interior') then continue;end if;
  begin
   -- process_actor_label performs the same active-role check and verifies membership.
   -- KSRF was intentionally teacher-only here (active_now('ksrf') is false).
   if not v_teacher and k='ksrf' then continue;end if;
   label:=private.process_actor_label(p_game_id,k);
   if label is not null and btrim(label)<>'' then
    result:=result||jsonb_build_array(jsonb_build_object('key',k,'label',label));
   end if;
  exception when others then null;end;
 end loop;
 -- The five ministries are those established by the game rules, not extra ministries.
 if v_teacher then
  foreach k in array array['portfolio:social','portfolio:economic','portfolio:foreign','portfolio:defence','portfolio:internal'] loop
   label:=private.process_actor_label(p_game_id,k);
   result:=result||jsonb_build_array(jsonb_build_object('key',k,'label',label));
  end loop;
 end if;
 -- Only game-instantiated units, parties and official appointments follow.
 for a in select u.id,u.title from public.institution_units u
  where u.game_id=p_game_id and (v_teacher or u.head_user_id=v_uid or exists(
   select 1 from public.institution_assignments ia where ia.game_id=p_game_id
    and ia.unit_id=u.id and ia.user_id=v_uid))
  order by u.title,u.id loop
  result:=result||jsonb_build_array(jsonb_build_object('key','unit:'||a.id::text,'label',a.title));
 end loop;
 for a in select gp.id,gp.name,gp.mandates from public.game_parties gp
  join public.game_members gm on gm.game_id=p_game_id and gm.user_id=v_uid
  where gp.game_id=p_game_id and gp.registration_status='registered' and (v_teacher or gp.leader_user_id=v_uid
    or lower(gp.name)=lower(coalesce(gm.team,'')) or exists(
      select 1 from public.institution_assignments ia where ia.game_id=p_game_id
       and ia.party_id=gp.id and ia.user_id=v_uid))
  order by gp.name,gp.id loop
  result:=result||jsonb_build_array(jsonb_build_object('key','party:'||a.id::text,'label',a.name));
  if coalesce(a.mandates,0)>0 then
   result:=result||jsonb_build_array(jsonb_build_object('key','faction:'||a.id::text,'label','Фракция «'||a.name||'»'));
  end if;
 end loop;
 for a in select distinct on (lower(btrim(role_title))) id from public.game_office_assignments
  where game_id=p_game_id and (v_teacher or user_id=v_uid) and status='active'
  order by lower(btrim(role_title)),created_at loop
  begin
   label:=private.process_actor_label(p_game_id,'office:'||a.id::text);
   result:=result||jsonb_build_array(jsonb_build_object('key','office:'||a.id::text,'label',label));
  exception when others then null;end;
 end loop;
 return result;
end
$function$;
