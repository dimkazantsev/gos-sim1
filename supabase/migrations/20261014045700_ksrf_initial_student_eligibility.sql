-- KSRF is a game institution, not an administrator role. Its initial
-- membership is available to active students, while per-faction ballots
-- remain one vote per elected party chair.
do $migration$
declare v_sql text;v_before text;v_after text;
begin
 v_sql:=pg_get_functiondef('private.can_create_formal_subject(uuid,uuid,text)'::regprocedure);
 if position('when p_subject=''ksrf''' in v_sql)=0 then
  v_before:='when p_subject=''president''';
  v_after:='when p_subject=''ksrf'' then exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and gm.kind=''student'' and gm.roster_archived_at is null)'||chr(10)||' '||v_before;
  if position(v_before in v_sql)=0 then raise exception 'Formal subject function changed; review required';end if;
  execute replace(v_sql,v_before,v_after);
 end if;
 v_sql:=pg_get_functiondef('private.process_actor_label(uuid,text)'::regprocedure);
 if position('elsif p_actor_key=''ksrf''' in v_sql)=0 then
  v_before:='elsif p_actor_key=''participant'' then v_label:=gm.full_name;';
  v_after:='elsif p_actor_key=''ksrf'' and (gm.kind=''student'' or private.is_game_teacher(p_game_id)) then v_label:=''КСРФ'';'||chr(10)||' '||v_before;
  if position(v_before in v_sql)=0 then raise exception 'Actor permission function changed; review required';end if;
  execute replace(v_sql,v_before,v_after);
 end if;
end $migration$;

create or replace function public.get_formal_subjects(p_game_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'public','private','pg_temp'
as $function$
declare result jsonb:='[]';k text;
begin
 if not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре' using errcode='42501';end if;
 foreach k in array array['ksrf','president','gd_deputy','gd','sf','sf_member','government','region','ks','vs','ministry','municipality'] loop
  if private.can_create_formal_subject(p_game_id,auth.uid(),k) then
   result:=result||jsonb_build_array(k);
  end if;
 end loop;
 return result;
end $function$;
