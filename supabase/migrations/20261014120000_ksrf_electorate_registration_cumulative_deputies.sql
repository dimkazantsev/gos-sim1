-- KSRF membership, one ballot per faction, mandatory registration, and additive GD rights.
-- Fail closed if older functions differ: do not overwrite unknown newer implementations.
begin;
do $migration$
declare
 v_sql text;
 v_old text;
begin
 v_sql:=pg_get_functiondef('private.snapshot_vote_electorate()'::regprocedure);
 v_old:='(''all'',''factions'',''gd'',''government''';
 if position(v_old in v_sql)=0 then raise exception 'Electorate body whitelist changed; inspect before migration';end if;
 v_sql:=replace(v_sql,v_old,'(''all'',''factions'',''ksrf'',''gd'',''government''');
 v_old:='not in (''gd'',''all'',''factions'')';
 if position(v_old in v_sql)=0 then raise exception 'Electorate voting mode logic changed';end if;
 v_sql:=replace(v_sql,v_old,'not in (''gd'',''all'',''factions'',''ksrf'')');
 v_old:='new.group_name:=selected_group;';
 if position(v_old in v_sql)=0 then raise exception 'Electorate label placement changed';end if;
 v_sql:=replace(v_sql,v_old,'if new.institution_key=''ksrf'' then label:=''КСРФ'';end if;'||chr(10)||' '||v_old);
 execute v_sql;

 v_sql:=pg_get_functiondef('private.vote_member_matches(uuid,uuid,text)'::regprocedure);
 v_old:='p_institution=''ksrf'''||chr(10)||'        and ('||chr(10)||'          exists(';
 if position(v_old in v_sql)=0 then raise exception 'KSRF membership logic changed; review required';end if;
 v_sql:=replace(v_sql,v_old,'p_institution=''ksrf'''||chr(10)||'        and ('||chr(10)||'          gm.kind=''student'' or exists(');
 execute v_sql;

 v_sql:=pg_get_functiondef('private.vote_member_has_office(uuid,uuid,text)'::regprocedure);
 v_old:='and private.role_is_available(p_game,p_user) and private.role_matches_voting_body(o.role_title,p_institution));';
 if position(v_old in v_sql)=0 then raise exception 'Voting office predicate changed; review required';end if;
 v_sql:=replace(v_sql,v_old,
  'and private.role_is_available(p_game,p_user) and private.role_matches_voting_body(o.role_title,p_institution))'||chr(10)||
  ' or (p_institution=''gd'' and private.role_is_available(p_game,p_user) and exists('||chr(10)||
  ' select 1 from public.party_member_mandates pm join public.game_members gm on gm.game_id=pm.game_id and gm.user_id=pm.user_id'||chr(10)||
  ' where pm.game_id=p_game and pm.user_id=p_user and pm.base_mandates>0 and gm.kind=''student'' and gm.roster_archived_at is null));');
 execute v_sql;

 v_sql:=pg_get_functiondef('public.open_parliamentary_rule_vote(uuid)'::regprocedure);
 v_old:='if r.status<>''draft'' then raise exception ''Proposal is not a draft''; end if;';
 if position(v_old in v_sql)=0 then raise exception 'Parliamentary rule procedure changed; review required';end if;
 v_sql:=replace(v_sql,v_old,
 'if not private.is_game_teacher(r.game_id) and not exists('||chr(10)||
 ' select 1 from public.institution_session_registrations reg where reg.game_id=r.game_id and reg.institution_key=''ksrf'' and reg.stage_no=2 and reg.user_id=v_uid'||chr(10)||
 ') then raise exception ''Сначала зарегистрируйтесь на заседание КСРФ'';end if;'||chr(10)||' '||v_old);
 execute v_sql;
end $migration$;
commit;
