-- Stage 9: five Duma committees and five game ministries with separate staffing rules.
create table if not exists public.institution_units(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 unit_kind text not null check(unit_kind in ('committee','ministry')),
 unit_key text not null,title text not null,description text,
 capacity_min integer,capacity_max integer,mandate_capacity integer,
 head_user_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(game_id,unit_kind,unit_key)
);
create table if not exists public.institution_assignments(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 unit_id uuid not null references public.institution_units(id) on delete cascade,
 unit_kind text not null check(unit_kind in ('committee','ministry')),
 user_id uuid not null references auth.users(id) on delete cascade,
 party_id uuid references public.game_parties(id) on delete set null,
 assignment_role text not null default 'member' check(assignment_role in ('member','deputy','head')),
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(unit_id,user_id),unique(game_id,user_id,unit_kind)
);
create index if not exists institution_units_game_idx on public.institution_units(game_id,unit_kind);
create index if not exists institution_assignments_unit_idx on public.institution_assignments(unit_id,party_id);
alter table public.institution_units enable row level security;
alter table public.institution_assignments enable row level security;
revoke all privileges on table public.institution_units from anon,authenticated;
revoke all privileges on table public.institution_assignments from anon,authenticated;
grant select on table public.institution_units to authenticated;
grant select on table public.institution_assignments to authenticated;
drop policy if exists institution_units_read on public.institution_units;
create policy institution_units_read on public.institution_units for select to authenticated using(private.is_game_member(game_id));
drop policy if exists institution_assignments_read on public.institution_assignments;
create policy institution_assignments_read on public.institution_assignments for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='institution_units') then alter publication supabase_realtime add table public.institution_units; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='institution_assignments') then alter publication supabase_realtime add table public.institution_assignments; end if;
end $$;
create or replace function public.ensure_stage9_units(p_game_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if (select auth.uid()) is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 insert into public.institution_units(game_id,unit_kind,unit_key,title,description,mandate_capacity)
 values
 (p_game_id,'committee','social','Комитет по социальной политике','Труд, демография, культура, образование, здравоохранение и смежные вопросы',90),
 (p_game_id,'committee','economic','Комитет по экономической политике','Финансы, налоги, транспорт, энергетика и смежные вопросы',90),
 (p_game_id,'committee','defence','Комитет по обороне и безопасности','Оборона и безопасность',90),
 (p_game_id,'committee','foreign','Комитет по внешней политике','Внешняя политика и международные отношения',90),
 (p_game_id,'committee','internal','Комитет по внутренней политике и государству','ОГВ, ОМС, национальности, гражданское общество, НКО и смежные вопросы',90),
 (p_game_id,'ministry','social','Министерство по социальной политике','Труд, демография, культура, образование, здравоохранение и смежные вопросы',null),
 (p_game_id,'ministry','economic','Министерство по экономической политике','Финансы, налоги, транспорт, энергетика и смежные вопросы',null),
 (p_game_id,'ministry','defence','Министерство по обороне и внутренней безопасности','Оборона и внутренняя безопасность',null),
 (p_game_id,'ministry','foreign','Министерство по внешней политике','Внешняя политика',null),
 (p_game_id,'ministry','internal','Министерство по внутренней политике и государству','ОГВ, ОМС, национальности, ГО, НКО, МВД, МЧС в рамках учебной редукции',null)
 on conflict(game_id,unit_kind,unit_key) do nothing;
 update public.institution_units set capacity_min=3,capacity_max=5 where game_id=p_game_id and unit_kind='ministry' and capacity_min is null;
end;$$;
revoke all on function public.ensure_stage9_units(uuid) from public,anon;
grant execute on function public.ensure_stage9_units(uuid) to authenticated;
create or replace function private.member_party_id(p_game uuid,p_user uuid) returns uuid language sql stable security definer set search_path=public,private,pg_temp as $$
 select p.id from public.game_members m join public.game_parties p on p.game_id=m.game_id and p.name=m.team where m.game_id=p_game and m.user_id=p_user limit 1;
$$;
revoke execute on function private.member_party_id(uuid,uuid) from public,anon,authenticated;
create or replace function public.assign_institution_member(p_unit_id uuid,p_user_id uuid) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_target_party uuid;v_role text;v_id uuid;
begin
 select * into u from public.institution_units where id=p_unit_id for update;
 if u.id is null then raise exception 'Institution unit not found'; end if;
 if not exists(select 1 from public.game_members where game_id=u.game_id and user_id=p_user_id and kind='student') then raise exception 'Student not found in this game'; end if;
 if u.unit_kind='committee' then
  v_party:=private.member_party_id(u.game_id,v_uid);v_target_party:=private.member_party_id(u.game_id,p_user_id);
  if not private.is_game_teacher(u.game_id) then
   if v_party is null or not exists(select 1 from public.game_parties where id=v_party and leader_user_id=v_uid) then raise exception 'Faction leader access required'; end if;
   if v_target_party is distinct from v_party then raise exception 'Faction leader may assign only members of their own faction'; end if;
  end if;
  if v_target_party is null then raise exception 'Committee member must belong to a parliamentary faction'; end if;
 else
  v_role:=private.game_role(u.game_id,v_uid);
  if not private.is_game_teacher(u.game_id) and v_uid is distinct from u.head_user_id and v_role not like '%председател%правительств%' then raise exception 'Minister / Prime Minister / teacher access required'; end if;
  v_target_party:=null;
 end if;
 insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,created_by)
 values(u.game_id,u.id,u.unit_kind,p_user_id,v_target_party,v_uid)
 on conflict(game_id,user_id,unit_kind) do update set unit_id=excluded.unit_id,party_id=excluded.party_id,created_by=v_uid,created_at=now()
 returning id into v_id;return v_id;
end;$$;
revoke all on function public.assign_institution_member(uuid,uuid) from public,anon;
grant execute on function public.assign_institution_member(uuid,uuid) to authenticated;
create or replace function public.remove_institution_member(p_assignment_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.institution_assignments%rowtype;u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_role text;
begin
 select * into a from public.institution_assignments where id=p_assignment_id;if a.id is null then return;end if;
 select * into u from public.institution_units where id=a.unit_id;
 if a.unit_kind='committee' then
  v_party:=private.member_party_id(a.game_id,v_uid);
  if not private.is_game_teacher(a.game_id) and not exists(select 1 from public.game_parties where id=v_party and leader_user_id=v_uid and id=a.party_id) then raise exception 'Faction leader access required'; end if;
 else
  v_role:=private.game_role(a.game_id,v_uid);
  if not private.is_game_teacher(a.game_id) and v_uid is distinct from u.head_user_id and v_role not like '%председател%правительств%' then raise exception 'Minister / Prime Minister / teacher access required'; end if;
 end if;
 delete from public.institution_assignments where id=a.id;
end;$$;
revoke all on function public.remove_institution_member(uuid) from public,anon;
grant execute on function public.remove_institution_member(uuid) to authenticated;
create or replace function public.set_institution_head(p_unit_id uuid,p_user_id uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_role text;
begin
 select * into u from public.institution_units where id=p_unit_id for update;if u.id is null then raise exception 'Institution unit not found';end if;
 if not exists(select 1 from public.game_members where game_id=u.game_id and user_id=p_user_id and kind='student') then raise exception 'Student not found';end if;
 v_role:=private.game_role(u.game_id,v_uid);
 if u.unit_kind='committee' then
  if not private.is_game_teacher(u.game_id) then raise exception 'Committee chair must be recorded after the Duma election by the teacher';end if;
 else
  if not private.is_game_teacher(u.game_id) and v_role not like '%председател%правительств%' and v_role not like '%президент%' then raise exception 'Prime Minister / President / teacher access required';end if;
 end if;
 update public.institution_units set head_user_id=p_user_id where id=u.id;
 if u.unit_kind='ministry' then
  insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
  values(u.game_id,u.id,'ministry',p_user_id,null,'head',v_uid)
  on conflict(game_id,user_id,unit_kind) do update set unit_id=excluded.unit_id,assignment_role='head',created_by=v_uid,created_at=now();
 else
  insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,assignment_role,created_by)
  values(u.game_id,u.id,'committee',p_user_id,private.member_party_id(u.game_id,p_user_id),'head',v_uid)
  on conflict(game_id,user_id,unit_kind) do update set unit_id=excluded.unit_id,party_id=excluded.party_id,assignment_role='head',created_by=v_uid,created_at=now();
 end if;
end;$$;
revoke all on function public.set_institution_head(uuid,uuid) from public,anon;
grant execute on function public.set_institution_head(uuid,uuid) to authenticated;
create or replace function public.get_committee_matrix(p_game_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_result jsonb;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
 with parties as (
  select p.id,p.name,p.color,p.mandates,case when sum(p.mandates) over()>0 then p.mandates::numeric/sum(p.mandates) over() else 0 end share
  from public.game_parties p where p.game_id=p_game_id and p.mandates>0
 ),raw as (
  select u.id unit_id,u.title,p.id party_id,p.name party_name,p.color,p.share,
   floor(p.share*coalesce(u.mandate_capacity,90))::integer base,
   (p.share*coalesce(u.mandate_capacity,90))-floor(p.share*coalesce(u.mandate_capacity,90)) remainder,
   coalesce(u.mandate_capacity,90) capacity
  from public.institution_units u cross join parties p where u.game_id=p_game_id and u.unit_kind='committee'
 ),ranked as (
  select r.*,r.capacity-sum(r.base) over(partition by r.unit_id) extra,row_number() over(partition by r.unit_id order by r.remainder desc,r.party_id) rn from raw r
 ),quota as (
  select *,base+case when rn<=extra then 1 else 0 end as quota from ranked
 ),assigned as (
  select a.unit_id,a.party_id,count(*)::integer students from public.institution_assignments a where a.game_id=p_game_id and a.unit_kind='committee' group by a.unit_id,a.party_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('unit_id',q.unit_id,'title',q.title,'party_id',q.party_id,'party_name',q.party_name,'color',q.color,'quota',q.quota,'students',coalesce(a.students,0)) order by q.title,q.party_name),'[]'::jsonb)
 into v_result from quota q left join assigned a on a.unit_id=q.unit_id and a.party_id=q.party_id;
 return v_result;
end;$$;
revoke all on function public.get_committee_matrix(uuid) from public,anon;
grant execute on function public.get_committee_matrix(uuid) to authenticated;