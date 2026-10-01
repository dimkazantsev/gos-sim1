alter table public.game_votes add column if not exists group_name text;
alter table public.game_votes add column if not exists electorate_snapshot jsonb;
alter table public.game_votes add column if not exists result_present numeric;
alter table public.game_ballots add column if not exists yes_weight numeric;
alter table public.game_ballots add column if not exists no_weight numeric;
alter table public.game_ballots add column if not exists abstain_weight numeric;
alter table public.game_ballots add constraint ballot_allocation_valid check (
 (yes_weight is null and no_weight is null and abstain_weight is null) or
 (yes_weight is not null and no_weight is not null and abstain_weight is not null
 and yes_weight>=0 and no_weight>=0 and abstain_weight>=0
 and yes_weight=trunc(yes_weight) and no_weight=trunc(no_weight) and abstain_weight=trunc(abstain_weight)
 and yes_weight+no_weight+abstain_weight=weight and weight>0)
);
alter table public.institution_units drop constraint institution_units_unit_kind_check;
alter table public.institution_units add constraint institution_units_unit_kind_check check(unit_kind in ('committee','ministry','public_body'));
alter table public.institution_assignments drop constraint institution_assignments_unit_kind_check;
alter table public.institution_assignments add constraint institution_assignments_unit_kind_check check(unit_kind in ('committee','ministry','public_body'));
create table public.game_voting_body_members (
 game_id uuid not null references public.games(id) on delete cascade,
 unit_id uuid not null references public.institution_units(id) on delete cascade,
 user_id uuid not null,primary key(unit_id,user_id),
 foreign key(game_id,user_id) references public.game_members(game_id,user_id) on delete cascade
);
alter table public.game_voting_body_members enable row level security;
create policy body_members_read on public.game_voting_body_members for select to authenticated using(private.is_game_member(game_id));
grant select on public.game_voting_body_members to authenticated;
revoke all on public.game_voting_body_members from anon;
alter table public.institution_session_registrations drop constraint institution_session_registrations_institution_key_check;
alter table public.institution_session_registrations add constraint institution_session_registrations_institution_key_check check(
 institution_key in ('gd','government','municipality','sf','committee','region','cec','ks','vs','central_bank','accounts') or institution_key ~ '^unit:[0-9a-f-]{36}$'
);

create or replace function private.role_matches_voting_body(p_role text,p_institution text) returns boolean
language sql immutable set search_path=public,private,pg_temp as $$
select case p_institution
 when 'gd' then p_role ~* 'депутат|государственн.*дум'
 when 'government' then p_role ~* 'правительств|министр'
 when 'sf' then p_role ~* 'совет.*федерац|сенатор'
 when 'committee' then p_role ~* 'комитет|депутат'
 when 'municipality' then p_role ~* 'муницип|глава города|местн.*самоуправлен'
 when 'region' then p_role ~* 'регион|губернатор|субъект.*федерац'
 when 'cec' then p_role ~* 'избирательн.*комисс|цик'
 when 'ks' then p_role ~* 'конституционн.*суд'
 when 'vs' then p_role ~* 'верховн.*суд'
 when 'central_bank' then p_role ~* 'центральн.*банк|банк.*россии'
 when 'accounts' then p_role ~* 'сч[её]тн.*палат'
 else false end;
$$;
create or replace function private.vote_member_matches(p_game uuid,p_user uuid,p_institution text) returns boolean
language sql stable security definer set search_path=public,private,pg_temp as $$
select exists(select 1 from public.game_members gm where gm.game_id=p_game and gm.user_id=p_user and (gm.kind='student' or (gm.kind='teacher' and lower(trim(coalesce(gm.role_title,''))) not in ('','преподаватель','руководитель симуляции','администратор')))
 and (p_institution in ('all','factions') or private.role_is_available(p_game,p_user)) and (
 p_institution in ('all','factions') or private.role_matches_voting_body(coalesce(gm.role_title,''),p_institution)
 or (p_institution ~ '^unit:[0-9a-f-]{36}$' and exists(select 1 from public.institution_assignments a where a.game_id=p_game and a.user_id=p_user and 'unit:'||a.unit_id::text=p_institution) or exists(select 1 from public.game_voting_body_members a where a.game_id=p_game and a.user_id=p_user and 'unit:'||a.unit_id::text=p_institution))));
$$;
create or replace function private.vote_member_has_office(p_game uuid,p_user uuid,p_institution text) returns boolean
language sql stable security definer set search_path=public,private,pg_temp as $$
select private.vote_member_matches(p_game,p_user,p_institution) or exists(
 select 1 from public.game_office_assignments o join public.game_members gm on gm.game_id=o.game_id and gm.user_id=o.user_id
 where o.game_id=p_game and o.user_id=p_user and o.status='active' and gm.kind='student'
 and private.role_is_available(p_game,p_user) and private.role_matches_voting_body(o.role_title,p_institution));
$$;

create or replace function private.snapshot_vote_electorate() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare roster jsonb;total numeric;label text;selected_group text;
begin
 selected_group:=nullif(current_setting('app.vote_group',true),'');
 if selected_group is not null and not exists(select 1 from public.game_members where game_id=new.game_id and kind='student' and group_name=selected_group) then raise exception 'Учебная группа не найдена';end if;
 if new.institution_key not in ('all','factions','gd','government','municipality','sf','committee','region','cec','ks','vs','central_bank','accounts')
 and not exists(select 1 from public.institution_units u where u.game_id=new.game_id and 'unit:'||u.id::text=new.institution_key) then raise exception 'Орган не найден';end if;
 if new.institution_key='gd' then new.voting_mode:='mandate';end if;
 if new.institution_key not in ('gd','all','factions') then new.voting_mode:='member';end if;
 if new.institution_key='gd' and (new.quorum_kind<>'fraction' or new.quorum_value<0.5) then raise exception 'Кворум Государственной Думы не может быть ниже 226 из 450';end if;
 if new.quorum_value<0 or new.quorum_value>1 or new.majority_value<0 or new.majority_value>1 then raise exception 'Некорректный порог голосования';end if;
 select coalesce(jsonb_object_agg(x.user_id::text,x.weight),'{}'::jsonb) into roster from (
  select gm.user_id,case new.voting_mode
   when 'mandate' then coalesce((select a.effective_mandates from public.party_member_mandates a where a.game_id=new.game_id and a.user_id=gm.user_id limit 1),0)
   when 'faction' then case when exists(select 1 from public.game_parties p where p.game_id=new.game_id and p.leader_user_id=gm.user_id) then 1 else 0 end
   else 1 end as weight
  from public.game_members gm where gm.game_id=new.game_id and gm.kind<>'observer' and (selected_group is null or gm.group_name=selected_group)
   and private.vote_member_has_office(new.game_id,gm.user_id,new.institution_key)
 ) x where x.weight>0;
 if new.institution_key='gd' then total:=450;
 elsif new.institution_key in ('government','municipality') then
  select count(*) into total from public.game_members where game_id=new.game_id and (kind='student' or (kind='teacher' and private.vote_member_matches(new.game_id,user_id,new.institution_key))) and (selected_group is null or group_name=selected_group);
 else select coalesce(sum(value::numeric),0) into total from jsonb_each_text(roster);end if;
 select title into label from public.institution_units where game_id=new.game_id and 'unit:'||id::text=new.institution_key;
 new.group_name:=selected_group;
 new.electorate_snapshot:=jsonb_build_object('weights',roster,'eligible',total,'group_name',selected_group,'institution_label',label,'attendance_required',new.institution_key not in ('all','factions'),'captured_at',now());
 return new;
end;$$;
drop trigger if exists snapshot_vote_electorate on public.game_votes;
create trigger snapshot_vote_electorate before insert on public.game_votes for each row execute function private.snapshot_vote_electorate();

create or replace function private.vote_total_eligible_weight(p_vote public.game_votes) returns numeric
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
begin
 if p_vote.status='closed' and p_vote.result_eligible is not null then return p_vote.result_eligible;end if;
 if p_vote.electorate_snapshot is not null then return coalesce((p_vote.electorate_snapshot->>'eligible')::numeric,0);end if;
 if p_vote.institution_key='gd' then return 450;end if;
 if p_vote.institution_key in ('government','municipality') then return (select count(*) from public.game_members where game_id=p_vote.game_id and (kind='student' or (kind='teacher' and private.vote_member_matches(p_vote.game_id,user_id,p_vote.institution_key))) and (p_vote.group_name is null or group_name=p_vote.group_name));end if;
 if p_vote.voting_mode='faction' then return (select count(*) from public.game_parties where game_id=p_vote.game_id and leader_user_id is not null);end if;
 if p_vote.voting_mode='mandate' then return (select coalesce(sum(mandates),0) from public.game_parties where game_id=p_vote.game_id);end if;
 return (select count(*) from public.game_members gm where gm.game_id=p_vote.game_id and private.vote_member_has_office(p_vote.game_id,gm.user_id,p_vote.institution_key));
end;$$;
create or replace function private.vote_eligible_weight(p_vote public.game_votes,p_user uuid) returns numeric
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare w numeric;
begin
 if not private.vote_member_matches(p_vote.game_id,p_user,p_vote.institution_key) then return 0;end if;
 if (coalesce((p_vote.electorate_snapshot->>'attendance_required')::boolean,false) or p_vote.procedure_key='registered_session')
 and p_vote.institution_key not in ('all','factions') and not exists(select 1 from public.institution_session_registrations r where r.game_id=p_vote.game_id and r.stage_no=p_vote.stage_no and r.institution_key=p_vote.institution_key and r.user_id=p_user) then return 0;end if;
 if p_vote.electorate_snapshot is not null then return coalesce((p_vote.electorate_snapshot->'weights'->>p_user::text)::numeric,0);end if;
 if p_vote.voting_mode='faction' then return case when exists(select 1 from public.game_parties where game_id=p_vote.game_id and leader_user_id=p_user) then 1 else 0 end;end if;
 if p_vote.voting_mode='mandate' then select effective_mandates into w from public.party_member_mandates where game_id=p_vote.game_id and user_id=p_user limit 1;return coalesce(w,0);end if;
 return 1;
end;$$;
create or replace function private.vote_present_weight(p_vote public.game_votes) returns numeric
language sql stable security definer set search_path=public,private,pg_temp as $$
select case when coalesce((p_vote.electorate_snapshot->>'attendance_required')::boolean,false) then (
 select coalesce(sum(s.value::numeric),0) from jsonb_each_text(p_vote.electorate_snapshot->'weights') s
 where exists(select 1 from public.institution_session_registrations r where r.game_id=p_vote.game_id and r.stage_no=p_vote.stage_no and r.institution_key=p_vote.institution_key and r.user_id::text=s.key))
 else (select coalesce(sum(weight),0) from public.game_ballots where vote_id=p_vote.id) end;
$$;

create or replace function public.cast_vote_allocation(p_vote_id uuid,p_yes numeric,p_no numeric,p_abstain numeric) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v public.game_votes%rowtype;uid uuid:=auth.uid();allowed numeric;total numeric;choice text;
begin
 select * into v from public.game_votes where id=p_vote_id for update;
 if uid is null or v.id is null or not private.is_game_member(v.game_id) then raise exception 'Нет доступа к голосованию';end if;
 if v.status<>'open' then raise exception 'Голосование завершено';end if;
 allowed:=private.vote_eligible_weight(v,uid);
 total:=p_yes+p_no+p_abstain;
 if p_yes is null or p_no is null or p_abstain is null or p_yes<0 or p_no<0 or p_abstain<0 or total<=0
 or p_yes<>trunc(p_yes) or p_no<>trunc(p_no) or p_abstain<>trunc(p_abstain) or total>allowed then raise exception 'Число голосов должно быть целым и не превышать ваш доступный пакет: %',allowed;end if;
 if v.voting_mode<>'mandate' and (total<>1 or greatest(p_yes,p_no,p_abstain)<>1) then raise exception 'В этой процедуре у участника один неделимый голос';end if;
 if not v.allow_abstain and p_abstain>0 then raise exception 'Воздержание в этой процедуре не предусмотрено';end if;
 choice:=case when p_yes>=p_no and p_yes>=p_abstain then 'yes' when p_no>=p_abstain then 'no' else 'abstain' end;
 insert into public.game_ballots(vote_id,voter_id,choice,weight,yes_weight,no_weight,abstain_weight)
 values(v.id,uid,choice,total,p_yes,p_no,p_abstain) on conflict(vote_id,voter_id) do update set choice=excluded.choice,weight=excluded.weight,yes_weight=excluded.yes_weight,no_weight=excluded.no_weight,abstain_weight=excluded.abstain_weight;
end;$$;
create or replace function public.cast_procedural_vote(p_vote_id uuid,p_choice text) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v public.game_votes%rowtype;w numeric;
begin
 if p_choice not in ('yes','no','abstain') then raise exception 'Неизвестный вариант';end if;
 select * into v from public.game_votes where id=p_vote_id for update;
 w:=private.vote_eligible_weight(v,auth.uid());
 perform public.cast_vote_allocation(p_vote_id,case when p_choice='yes' then w else 0 end,case when p_choice='no' then w else 0 end,case when p_choice='abstain' then w else 0 end);
end;$$;

create or replace function public.register_institution_session(p_game_id uuid,p_institution text) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare uid uuid:=auth.uid();stage integer;
begin
 if uid is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к игре';end if;
 if not private.vote_member_has_office(p_game_id,uid,p_institution) then raise exception 'Должность или назначение в этот орган отсутствует';end if;
 select current_round into stage from public.games where id=p_game_id;
 insert into public.institution_session_registrations(game_id,stage_no,institution_key,user_id) values(p_game_id,stage,p_institution,uid) on conflict do nothing;
end;$$;
create or replace function public.create_voting_body(p_game_id uuid,p_title text,p_users uuid[],p_head uuid default null) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare id uuid:=gen_random_uuid();u uuid;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Требуются права преподавателя';end if;
 if length(trim(p_title))<3 or cardinality(p_users)<1 or cardinality(p_users) is null then raise exception 'Укажите название органа и его состав';end if;
 if p_head is not null and not p_head=any(p_users) then raise exception 'Председатель должен входить в состав';end if;
 foreach u in array p_users loop
  if not exists(select 1 from public.game_members where game_id=p_game_id and user_id=u and kind='student') then raise exception 'Участник не входит в эту игру';end if;
 end loop;
 insert into public.institution_units(id,game_id,unit_kind,unit_key,title,capacity_min,capacity_max,mandate_capacity,head_user_id)
 values(id,p_game_id,'public_body',id::text,trim(p_title),1,cardinality(p_users),cardinality(p_users),p_head);
 insert into public.game_voting_body_members(game_id,unit_id,user_id)
 select p_game_id,id,x from (select distinct unnest(p_users) as x) members;
 return id;
end;$$;

create or replace function public.create_civic_vote(p_game_id uuid,p_title text,p_body text,p_voting_mode text,p_institution_key text,p_procedure_key text,
 p_quorum_kind text,p_quorum_value numeric,p_majority_kind text,p_majority_value numeric,p_allow_abstain boolean,p_tie_breaker_chair boolean,
 p_formal_document_id uuid,p_pass_transition text,p_fail_transition text,p_group_name text default null) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare id uuid;
begin
 perform set_config('app.vote_group',coalesce(p_group_name,''),true);
 id:=public.create_procedural_vote(p_game_id,p_title,p_body,p_voting_mode,p_institution_key,p_procedure_key,p_quorum_kind,p_quorum_value,p_majority_kind,p_majority_value,p_allow_abstain,p_tie_breaker_chair,p_formal_document_id,p_pass_transition,p_fail_transition);
 perform set_config('app.vote_group','',true);
 return id;
end;$$;

-- Snapshot and split counts are frozen on closure; attendance is distinct from votes cast.
create or replace function public.close_procedural_vote(p_vote_id uuid,p_note text default null) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare uid uuid:=auth.uid();v public.game_votes%rowtype;eligible numeric;casted numeric;present numeric;y numeric;n numeric;a numeric;needed numeric;q boolean;pass boolean;result text;label text;chair text;
begin
 select * into v from public.game_votes where id=p_vote_id for update;
 if v.id is null or uid is null or not private.is_game_member(v.game_id) then raise exception 'Нет доступа к голосованию';end if;
 if not private.can_close_procedural_vote(v.game_id,uid,v.institution_key,v.formal_document_id)
 and not exists(select 1 from public.institution_units u where u.game_id=v.game_id and 'unit:'||u.id::text=v.institution_key and u.head_user_id=uid)
 then raise exception 'Закрыть голосование может председательствующий или преподаватель';end if;
 if v.status<>'open' then return jsonb_build_object('result',v.result_code,'label',v.result_label);end if;
 eligible:=private.vote_total_eligible_weight(v);present:=private.vote_present_weight(v);
 select coalesce(sum(weight),0),coalesce(sum(coalesce(yes_weight,case when choice='yes' then weight else 0 end)),0),coalesce(sum(coalesce(no_weight,case when choice='no' then weight else 0 end)),0),coalesce(sum(coalesce(abstain_weight,case when choice='abstain' then weight else 0 end)),0)
 into casted,y,n,a from public.game_ballots where vote_id=v.id;
 needed:=case when v.quorum_kind='none' then 0 when v.institution_key in ('gd','sf','committee') and abs(v.quorum_value-0.5)<0.000001 then floor(eligible/2)+1 else ceil(eligible*v.quorum_value) end;
 q:=v.quorum_kind='none' or (eligible>0 and present>=needed);
 if not q then pass:=false;result:='no_quorum';label:='Нет кворума';
 else
  pass:=case v.majority_kind when 'eligible_majority' then y>eligible/2 when 'eligible_fraction' then y>=ceil(eligible*v.majority_value) when 'present_majority' then y>present/2 else y>n end;
  if not pass and v.tie_breaker_chair and y=n and y>0 then
   select b.choice into chair from public.game_ballots b join public.game_members m on m.game_id=v.game_id and m.user_id=b.voter_id
   where b.vote_id=v.id and m.role_title ~* 'председател.*правительств|председател.*дум|председател.*совет.*федерац' limit 1;
   pass:=coalesce(chair='yes',false);
  end if;
  result:=case when pass then 'passed' else 'rejected' end;label:=case when pass then 'Решение принято' else 'Решение отклонено' end;
 end if;
 update public.game_votes set status='closed',closed_at=now(),result_code=result,result_label=label,result_yes=y,result_no=n,result_abstain=a,result_eligible=eligible,result_cast=casted,result_present=present,result_quorum_met=q,decision_note=nullif(trim(p_note),'') where id=v.id;
 if q then perform private.apply_formal_vote_transition(v.formal_document_id,case when pass then v.pass_transition else v.fail_transition end,uid,v.id,p_note);end if;
 return jsonb_build_object('result',result,'label',label,'yes',y,'no',n,'abstain',a,'eligible',eligible,'cast',casted,'present',present,'quorum',q,'needed',needed);
end;$$;

revoke all on function private.role_matches_voting_body(text,text),private.vote_member_has_office(uuid,uuid,text),private.snapshot_vote_electorate(),private.vote_present_weight(public.game_votes) from public,anon,authenticated;
revoke all on function public.cast_vote_allocation(uuid,numeric,numeric,numeric),public.create_voting_body(uuid,text,uuid[],uuid),public.create_civic_vote(uuid,text,text,text,text,text,text,numeric,text,numeric,boolean,boolean,uuid,text,text,text) from public,anon;
grant execute on function public.cast_vote_allocation(uuid,numeric,numeric,numeric),public.create_voting_body(uuid,text,uuid[],uuid),public.create_civic_vote(uuid,text,text,text,text,text,text,numeric,text,numeric,boolean,boolean,uuid,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.create_procedural_vote(p_game_id uuid, p_title text, p_body text, p_voting_mode text, p_institution_key text, p_procedure_key text, p_quorum_kind text DEFAULT 'fraction'::text, p_quorum_value numeric DEFAULT 0.6666667, p_majority_kind text DEFAULT 'yes_no_simple'::text, p_majority_value numeric DEFAULT 0.5, p_allow_abstain boolean DEFAULT true, p_tie_breaker_chair boolean DEFAULT false, p_formal_document_id uuid DEFAULT NULL::uuid, p_pass_transition text DEFAULT 'none'::text, p_fail_transition text DEFAULT 'none'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid:=(select auth.uid());
  v_id uuid:=gen_random_uuid();
  d public.formal_documents%rowtype;
  v_step_code text;
  v_existing uuid;
begin
  if v_uid is null or not private.is_game_member(p_game_id) then
    raise exception 'Game access required';
  end if;
  if p_voting_mode not in ('member','faction','mandate') then
    raise exception 'Unsupported voting mode';
  end if;
  if length(trim(coalesce(p_title,'')))<3 then
    raise exception 'Vote title is required';
  end if;

  if p_formal_document_id is not null then
    select * into d from public.formal_documents where id=p_formal_document_id for update;
    if d.id is null or d.game_id<>p_game_id then raise exception 'Formal document not found'; end if;
    if not (
      private.is_game_teacher(p_game_id)
      or private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id)
    ) then raise exception 'Current institution cannot open this vote'; end if;
    v_step_code:=d.status_code;
    select id into v_existing from public.game_votes where formal_document_id=d.id and formal_step_code=v_step_code and status='open' order by opened_at limit 1;
    if v_existing is not null then return v_existing; end if;
  else
    if not private.is_game_teacher(p_game_id) then
      raise exception 'Only teacher can open an unlinked vote';
    end if;
  end if;

  insert into public.game_votes(
    id,game_id,stage_no,title,body,voting_mode,created_by,
    formal_document_id,formal_step_code,institution_key,procedure_key,
    quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,
    pass_transition,fail_transition
  )
  values(
    v_id,p_game_id,(select current_round from public.games where id=p_game_id),trim(p_title),nullif(trim(coalesce(p_body,'')),''),
    p_voting_mode,v_uid,p_formal_document_id,v_step_code,p_institution_key,p_procedure_key,
    p_quorum_kind,p_quorum_value,p_majority_kind,p_majority_value,p_allow_abstain,p_tie_breaker_chair,
    p_pass_transition,p_fail_transition
  );
  return v_id;
end;
$function$
