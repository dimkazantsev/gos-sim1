-- Correct stage 4 order: Duma Chair -> committee chair nominees/vote -> committee staffing.
-- Legacy assignments/elections remain intact. This migration only guards new actions.
do $migration$
declare v_sql text;v_old text;
begin
 v_sql:=pg_get_functiondef('public.create_committee_chair_election(uuid,text)'::regprocedure);
 v_old:='if p_vote_mode is null or p_vote_mode not in (''open'',''secret'') then raise exception ''Unsupported vote mode'';end if;';
 if position(v_old in v_sql)=0 then raise exception 'Committee chair creation changed; review required';end if;
 v_sql:=replace(v_sql,v_old,
  'if not exists(select 1 from public.office_elections where game_id=u.game_id and office_key=''gd_chair'' and status=''finished'') then raise exception ''Сначала изберите Председателя Государственной Думы'';end if;'||chr(10)||' '||v_old);
 execute v_sql;

 v_sql:=pg_get_functiondef('public.nominate_office_candidate(uuid,uuid)'::regprocedure);
 v_old:='select 1 from public.institution_assignments a'||chr(10)||
     '     where a.game_id=e.game_id and a.unit_id=v_unit and a.unit_kind=''committee'' and a.user_id=p_user_id';
 if position(v_old in v_sql)=0 then raise exception 'Committee candidate gate changed; review required';end if;
 v_sql:=replace(v_sql,v_old,
 'select 1 from public.party_member_mandates a'||chr(10)||
 '     where a.game_id=e.game_id and a.user_id=p_user_id and a.base_mandates>0');
 v_old:='Committee chair candidate must already be a member of that committee';
 if position(v_old in v_sql)=0 then raise exception 'Committee candidate message changed';end if;
 v_sql:=replace(v_sql,v_old,'Кандидат должен быть депутатом Государственной Думы');
 execute v_sql;

 v_sql:=pg_get_functiondef('public.assign_institution_member(uuid,uuid)'::regprocedure);
 v_old:='if u.unit_kind=''committee'' then'||chr(10)||'   v_party:=';
 if position(v_old in v_sql)=0 then raise exception 'Committee assignment gate changed; review required';end if;
 v_sql:=replace(v_sql,v_old,
 'if u.unit_kind=''committee'' then'||chr(10)||
 '   if u.head_user_id is null then raise exception ''Сначала изберите председателя комитета'';end if;'||chr(10)||
 '   if not exists(select 1 from public.party_member_mandates where game_id=u.game_id and user_id=p_user_id and base_mandates>0) then raise exception ''Участник не получил депутатских мандатов'';end if;'||chr(10)||
 '   v_party:=');
 v_old:='if v_party is null or not exists(select 1 from public.game_parties where id=v_party and leader_user_id=v_uid) then raise exception ''Faction leader access required''; end if;';
 if position(v_old in v_sql)=0 then raise exception 'Committee chair assignment authority changed';end if;
 v_sql:=replace(v_sql,v_old,
 'if v_uid is distinct from u.head_user_id and (v_party is null or not exists(select 1 from public.game_parties where id=v_party and leader_user_id=v_uid)) then raise exception ''Полномочия председателя комитета или руководителя фракции отсутствуют'';end if;');
 v_old:='if v_target_party is distinct from v_party then raise exception ''Faction leader may assign only members of their own faction''; end if;';
 if position(v_old in v_sql)=0 then raise exception 'Faction matching gate changed';end if;
 v_sql:=replace(v_sql,v_old,
 'if v_uid is distinct from u.head_user_id and v_target_party is distinct from v_party then raise exception ''Руководитель фракции назначает только участников своей фракции'';end if;');
 execute v_sql;
end $migration$;
