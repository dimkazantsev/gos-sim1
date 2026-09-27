-- Stage 8: fixed five-ministry structure, portfolio-bound nominations, and corrected Bank of Russia appointment.
create table if not exists public.government_structures(
 game_id uuid primary key references public.games(id) on delete cascade,
 social_title text not null default 'Министерство по социальной политике',
 economic_title text not null default 'Министерство по экономической политике',
 defence_title text not null default 'Министерство по обороне и внутренней безопасности',
 foreign_title text not null default 'Министерство по внешней политике',
 internal_title text not null default 'Министерство по внутренней политике и государству',
 status text not null default 'draft' check(status in ('draft','submitted','approved','revision')),
 note text,proposed_by uuid references auth.users(id) on delete set null,reviewed_by uuid references auth.users(id) on delete set null,
 submitted_at timestamptz,reviewed_at timestamptz,updated_at timestamptz not null default now()
);
alter table public.government_structures enable row level security;
revoke all privileges on table public.government_structures from anon,authenticated;
grant select on table public.government_structures to authenticated;
drop policy if exists government_structures_read on public.government_structures;
create policy government_structures_read on public.government_structures for select to authenticated using(private.is_game_member(game_id));
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='government_structures') then alter publication supabase_realtime add table public.government_structures; end if;
end $$;

create or replace function private.is_appointed_pm(p_game uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select private.is_game_teacher(p_game)
 or exists(select 1 from public.government_nominations where game_id=p_game and office_kind='prime_minister' and candidate_user_id=p_user and status='appointed')
 or private.game_role(p_game,p_user) like '%председател%правительств%';
$$;
revoke execute on function private.is_appointed_pm(uuid,uuid) from public,anon,authenticated;

create or replace function public.save_government_structure(p_game_id uuid,p_social_title text,p_economic_title text,p_defence_title text,p_foreign_title text,p_internal_title text,p_submit boolean default false)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());
begin
 if v_uid is null or not private.is_appointed_pm(p_game_id,v_uid) then raise exception 'Appointed Prime Minister / teacher access required';end if;
 if least(length(trim(coalesce(p_social_title,''))),length(trim(coalesce(p_economic_title,''))),length(trim(coalesce(p_defence_title,''))),length(trim(coalesce(p_foreign_title,''))),length(trim(coalesce(p_internal_title,''))))<5 then raise exception 'All five ministry titles are required';end if;
 insert into public.government_structures(game_id,social_title,economic_title,defence_title,foreign_title,internal_title,status,note,proposed_by,submitted_at,reviewed_by,reviewed_at,updated_at)
 values(p_game_id,trim(p_social_title),trim(p_economic_title),trim(p_defence_title),trim(p_foreign_title),trim(p_internal_title),case when p_submit then 'submitted' else 'draft' end,null,v_uid,case when p_submit then now() else null end,null,null,now())
 on conflict(game_id) do update set social_title=excluded.social_title,economic_title=excluded.economic_title,defence_title=excluded.defence_title,foreign_title=excluded.foreign_title,internal_title=excluded.internal_title,
  status=case when p_submit then 'submitted' else 'draft' end,note=null,proposed_by=v_uid,submitted_at=case when p_submit then now() else government_structures.submitted_at end,reviewed_by=null,reviewed_at=null,updated_at=now()
 where government_structures.status in ('draft','revision');
 if not found then raise exception 'Approved or submitted structure is locked';end if;
end;$$;
revoke all on function public.save_government_structure(uuid,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.save_government_structure(uuid,text,text,text,text,text,boolean) to authenticated;

create or replace function public.review_government_structure(p_game_id uuid,p_action text,p_note text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_role text;
begin
 v_role:=private.game_role(p_game_id,v_uid);
 if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President / teacher access required';end if;
 if p_action not in ('approve','revision') then raise exception 'Unsupported structure decision';end if;
 if not exists(select 1 from public.government_structures where game_id=p_game_id and status='submitted') then raise exception 'Submitted structure not found';end if;
 update public.government_structures set status=case when p_action='approve' then 'approved' else 'revision' end,note=nullif(trim(coalesce(p_note,'')),''),
  reviewed_by=v_uid,reviewed_at=now(),updated_at=now() where game_id=p_game_id;
 if p_action='approve' then
  update public.institution_units u set title=case u.unit_key when 'social' then s.social_title when 'economic' then s.economic_title when 'defence' then s.defence_title when 'foreign' then s.foreign_title when 'internal' then s.internal_title else u.title end
  from public.government_structures s where s.game_id=p_game_id and u.game_id=p_game_id and u.unit_kind='ministry';
 end if;
end;$$;
revoke all on function public.review_government_structure(uuid,text,text) from public,anon;
grant execute on function public.review_government_structure(uuid,text,text) to authenticated;

create or replace function public.submit_government_nomination(p_game_id uuid,p_office_key text,p_office_title text,p_office_kind text,p_candidate_user_id uuid,p_candidate_name text)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_role text;v_route text;v_attempt integer;v_id uuid;v_structure_status text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 if p_office_kind not in ('prime_minister','deputy_pm','duma_minister','security_minister','central_bank_chair') then raise exception 'Unsupported office kind';end if;
 if length(trim(coalesce(p_office_key,'')))<2 or length(trim(coalesce(p_office_title,'')))<3 or length(trim(coalesce(p_candidate_name,'')))<3 then raise exception 'Office and candidate are required';end if;
 if p_candidate_user_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_candidate_user_id and kind='student') then raise exception 'Candidate must be a game participant';end if;
 v_role:=private.game_role(p_game_id,v_uid);
 select status into v_structure_status from public.government_structures where game_id=p_game_id;
 if p_office_kind in ('prime_minister','central_bank_chair') then
  v_route:='president_to_duma';if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President role required';end if;
 elsif p_office_kind in ('deputy_pm','duma_minister') then
  v_route:='pm_to_duma';
  if not private.is_appointed_pm(p_game_id,v_uid) then raise exception 'Appointed Prime Minister role required';end if;
  if v_structure_status<>'approved' then raise exception 'Government structure must be approved first';end if;
  if p_office_key not in ('ministry_social','ministry_economic','ministry_foreign') then raise exception 'This portfolio belongs to the Duma-approved group: social, economic or foreign';end if;
 else
  v_route:='president_after_sf';
  if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President role required';end if;
  if v_structure_status<>'approved' then raise exception 'Government structure must be approved first';end if;
  if p_office_key not in ('ministry_defence','ministry_internal') then raise exception 'The game defines exactly two special portfolios: defence/security and internal/state policy';end if;
 end if;
 if p_office_kind in ('deputy_pm','duma_minister','security_minister') and exists(select 1 from public.government_nominations where game_id=p_game_id and office_key=p_office_key and status='appointed') then raise exception 'This ministry already has an appointed head';end if;
 select coalesce(max(attempt_no),0)+1 into v_attempt from public.government_nominations where game_id=p_game_id and office_key=trim(p_office_key);
 if v_attempt>3 and p_office_kind in ('prime_minister','deputy_pm','duma_minister') then raise exception 'Three Duma rejections have already been recorded for this office; resolve the constitutional consequence first';end if;
 insert into public.government_nominations(game_id,office_key,office_title,office_kind,route,candidate_user_id,candidate_name,attempt_no,status,nominated_by)
 values(p_game_id,trim(p_office_key),trim(p_office_title),p_office_kind,v_route,p_candidate_user_id,trim(p_candidate_name),v_attempt,case when v_route='president_after_sf' then 'consultation_pending' else 'submitted' end,v_uid)
 returning id into v_id;return v_id;
end;$$;
revoke all on function public.submit_government_nomination(uuid,text,text,text,uuid,text) from public,anon;
grant execute on function public.submit_government_nomination(uuid,text,text,text,uuid,text) to authenticated;

create or replace function private.government_nomination_vote_trigger()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare n public.government_nominations%rowtype;v_rejections integer;
begin
 if new.status='closed' and old.status is distinct from new.status then
  select * into n from public.government_nominations where vote_id=new.id for update;
  if n.id is not null then
   if new.result_code='passed' then
    if n.office_kind='central_bank_chair' then
     update public.government_nominations set status='appointed',decided_at=now(),appointed_at=now(),updated_at=now() where id=n.id;
     if n.candidate_user_id is not null then update public.game_members set role_title=n.office_title where game_id=n.game_id and user_id=n.candidate_user_id;end if;
     insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
     values(n.game_id,8,'Формирование Правительства','notice','Государственная Дума назначила · '||n.office_title,n.candidate_name,n.nominated_by);
    else update public.government_nominations set status='approved',decided_at=now(),updated_at=now() where id=n.id;end if;
   elsif new.result_code in ('rejected','no_quorum') then
    update public.government_nominations set status='rejected',decided_at=now(),updated_at=now() where id=n.id;
    select count(*)::integer into v_rejections from public.government_nominations where game_id=n.game_id and office_key=n.office_key and status='rejected';
    if v_rejections>=3 then
     insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
     values(n.game_id,8,'Формирование Правительства','critical','Третье отклонение кандидатуры · '||n.office_title,
      case when n.office_kind='prime_minister' then 'Зафиксировано три отклонения кандидатур Председателя Правительства. По ч. 4 ст. 111 Конституции РФ Президент назначает Председателя Правительства и вправе распустить Государственную Думу и назначить новые выборы.'
      else 'Зафиксировано три отклонения кандидатур по этой должности. Для заместителей Председателя Правительства и федеральных министров применяются последствия ч. 4 ст. 112; вопрос о роспуске ГД зависит также от доли оставшихся вакансий.' end,n.nominated_by);
    end if;
   end if;
  end if;
 end if;return new;
end;$$;
revoke execute on function private.government_nomination_vote_trigger() from public,anon,authenticated;
drop trigger if exists trg_government_nomination_vote on public.game_votes;
create trigger trg_government_nomination_vote after update of status on public.game_votes for each row execute function private.government_nomination_vote_trigger();

create or replace function public.appoint_government_nominee(p_nomination_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare n public.government_nominations%rowtype;v_uid uuid:=(select auth.uid());v_role text;v_unit_key text;
begin
 select * into n from public.government_nominations where id=p_nomination_id for update;if n.id is null then raise exception 'Nomination not found';end if;
 if n.office_kind='central_bank_chair' then raise exception 'The Chair of the Bank of Russia is appointed by the State Duma vote itself';end if;
 v_role:=private.game_role(n.game_id,v_uid);
 if not private.is_game_teacher(n.game_id) and v_role not like '%президент%' then raise exception 'President role required';end if;
 if n.route in ('president_to_duma','pm_to_duma') and n.status<>'approved' then raise exception 'Duma approval is required before appointment';end if;
 if n.route='president_after_sf' and n.status<>'consulted' then raise exception 'Federation Council consultation must be recorded first';end if;
 update public.government_nominations set status='appointed',appointed_at=now(),updated_at=now() where id=n.id;
 if n.candidate_user_id is not null then
  update public.game_members set role_title=n.office_title where game_id=n.game_id and user_id=n.candidate_user_id;
  if n.office_key like 'ministry_%' then
   v_unit_key:=substring(n.office_key from 10);
   update public.institution_units set head_user_id=n.candidate_user_id where game_id=n.game_id and unit_kind='ministry' and unit_key=v_unit_key;
  end if;
 end if;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(n.game_id,8,'Формирование Правительства','notice','Назначение · '||n.office_title,n.candidate_name,v_uid);
end;$$;
revoke all on function public.appoint_government_nominee(uuid) from public,anon;
grant execute on function public.appoint_government_nominee(uuid) to authenticated;

create or replace function public.ensure_stage9_units(p_game_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.government_structures%rowtype;
begin
 if (select auth.uid()) is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 select * into s from public.government_structures where game_id=p_game_id and status='approved';
 insert into public.institution_units(game_id,unit_kind,unit_key,title,description,mandate_capacity)
 values
 (p_game_id,'committee','social','Комитет по социальной политике','Труд, демография, культура, образование, здравоохранение и смежные вопросы',90),
 (p_game_id,'committee','economic','Комитет по экономической политике','Финансы, налоги, транспорт, энергетика и смежные вопросы',90),
 (p_game_id,'committee','defence','Комитет по обороне и безопасности','Оборона и безопасность',90),
 (p_game_id,'committee','foreign','Комитет по внешней политике','Внешняя политика и международные отношения',90),
 (p_game_id,'committee','internal','Комитет по внутренней политике и государству','ОГВ, ОМС, национальности, гражданское общество, НКО и смежные вопросы',90),
 (p_game_id,'ministry','social',coalesce(s.social_title,'Министерство по социальной политике'),'Труд, демография, культура, образование, здравоохранение и смежные вопросы',null),
 (p_game_id,'ministry','economic',coalesce(s.economic_title,'Министерство по экономической политике'),'Финансы, налоги, транспорт, энергетика и смежные вопросы',null),
 (p_game_id,'ministry','defence',coalesce(s.defence_title,'Министерство по обороне и внутренней безопасности'),'Оборона и внутренняя безопасность',null),
 (p_game_id,'ministry','foreign',coalesce(s.foreign_title,'Министерство по внешней политике'),'Внешняя политика',null),
 (p_game_id,'ministry','internal',coalesce(s.internal_title,'Министерство по внутренней политике и государству'),'ОГВ, ОМС, национальности, ГО, НКО, МВД, МЧС в рамках учебной редукции',null)
 on conflict(game_id,unit_kind,unit_key) do update set title=excluded.title;
 update public.institution_units set capacity_min=3,capacity_max=5 where game_id=p_game_id and unit_kind='ministry' and capacity_min is null;
 update public.institution_units u set head_user_id=n.candidate_user_id
 from public.government_nominations n
 where u.game_id=p_game_id and u.unit_kind='ministry' and n.game_id=p_game_id and n.status='appointed'
   and n.office_key='ministry_'||u.unit_key and n.candidate_user_id is not null;
end;$$;
revoke all on function public.ensure_stage9_units(uuid) from public,anon;
grant execute on function public.ensure_stage9_units(uuid) to authenticated;