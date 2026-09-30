-- Educational office assignments. Constitutional procedures remain distinct from teacher overrides.
create table if not exists public.game_office_assignments(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references public.games(id) on delete cascade,
 user_id uuid not null,role_title text not null check(length(role_title) between 2 and 180),
 status text not null default 'pending' check(status in ('pending','active','ended')),
 appointed_by uuid not null,approved_by uuid,legal_basis text not null,
 educational_exception boolean not null default false,created_at timestamptz not null default now(),
 foreign key(game_id,user_id) references public.game_members(game_id,user_id) on delete cascade
);
create unique index if not exists game_offices_current_unique on public.game_office_assignments(game_id,user_id,role_title) where status<>'ended';
alter table public.game_office_assignments enable row level security;
grant select on public.game_office_assignments to authenticated;
create policy offices_game_read on public.game_office_assignments for select to authenticated using(private.is_game_member(game_id));

create or replace function private.office_family(p_role text) returns text language sql immutable set search_path='' as $$
 select case when lower(p_role) like '%депутат%' or lower(p_role) like '%дум%' or lower(p_role) like '%комитет%' then 'gd'
 when lower(p_role) like '%сенатор%' or lower(p_role) like '%совет%федерац%' then 'sf'
 when lower(p_role) like '%президент%' then 'president'
 when lower(p_role) like '%министр%' or lower(p_role) like '%правительств%' then 'government'
 when lower(p_role) like '%банк%росси%' then 'central_bank'
 when lower(p_role) like '%муницип%' or lower(p_role) like '%администрац%' or lower(p_role) like '%глава города%' then 'municipality'
 when lower(p_role) like '%суд%' then 'court'
 when lower(p_role) like '%редактор%' or lower(p_role) like '%сми%' then 'media'
 else 'other' end; $$;

create or replace function public.appoint_game_office(p_game uuid,p_user uuid,p_role text,p_basis text,p_exception boolean default false) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_teacher boolean;v_status text;v_id uuid;v_actor text;v_family text;
begin
 if auth.uid() is null or not exists(select 1 from public.game_members where game_id=p_game and user_id=auth.uid() and kind<>'observer') then raise exception 'Нет права назначения';end if;
 if not exists(select 1 from public.game_members where game_id=p_game and user_id=p_user and kind<>'observer') then raise exception 'Участник другой игры недоступен';end if;
 if length(trim(p_role)) not between 2 and 180 or length(trim(p_basis))<10 then raise exception 'Укажите должность и основание назначения';end if;
 v_teacher:=private.is_game_teacher(p_game);v_family:=private.office_family(p_role);
 select role_title into v_actor from public.game_members where game_id=p_game and user_id=auth.uid();
 if not v_teacher and not (
  (private.office_family(v_actor)='president' and v_family in ('government','central_bank')) or
  (lower(v_actor) like '%председатель%правительств%' and v_family='government') or
  (private.office_family(v_actor)='municipality' and v_family='municipality')
 ) then raise exception 'У этой должности нет права инициировать такое назначение';end if;
 if p_exception and not v_teacher then raise exception 'Учебное исключение утверждает преподаватель';end if;
 perform 1 from public.game_members where game_id=p_game and user_id=p_user for update;
 if not p_exception and exists(select 1 from public.game_office_assignments o where o.game_id=p_game and o.user_id=p_user and o.status='active' and
  ((private.office_family(o.role_title) in ('gd','sf') and v_family in ('government','president','central_bank','municipality','court')) or
   (v_family in ('gd','sf') and private.office_family(o.role_title) in ('government','president','central_bank','municipality','court')) or
   (v_family in ('gd','sf') and private.office_family(o.role_title) in ('gd','sf') and v_family<>private.office_family(o.role_title))))
 then raise exception 'Несовместимые должности. Статья 97 Конституции РФ. Преподаватель может отдельно утвердить учебное исключение';end if;
 v_status:=case when v_teacher then 'active' else 'pending' end;
 insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis,educational_exception)
 values(p_game,p_user,trim(p_role),v_status,auth.uid(),case when v_teacher then auth.uid() end,trim(p_basis),p_exception) returning id into v_id;
 if v_teacher then update public.game_members set role_title=(select string_agg(role_title,' · ' order by created_at) from public.game_office_assignments where game_id=p_game and user_id=p_user and status='active') where game_id=p_game and user_id=p_user;end if;
 return v_id;
end;$$;
revoke all on function public.appoint_game_office(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.appoint_game_office(uuid,uuid,text,text,boolean) to authenticated;

create or replace function public.review_game_office(p_id uuid,p_approve boolean) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare o public.game_office_assignments%rowtype;v_id uuid;
begin
 select * into o from public.game_office_assignments where id=p_id for update;
 if o.id is null or not private.is_game_teacher(o.game_id) then raise exception 'Требуются права преподавателя';end if;
 if p_approve and o.status='pending' then
  update public.game_office_assignments set status='ended' where id=o.id;
  v_id:=public.appoint_game_office(o.game_id,o.user_id,o.role_title,o.legal_basis,o.educational_exception);
 else update public.game_office_assignments set status='ended' where id=o.id;end if;
 update public.game_members set role_title=coalesce((select string_agg(role_title,' · ' order by created_at) from public.game_office_assignments where game_id=o.game_id and user_id=o.user_id and status='active'),'Участник') where game_id=o.game_id and user_id=o.user_id and kind='student';
end;$$;
revoke all on function public.review_game_office(uuid,boolean) from public,anon;
grant execute on function public.review_game_office(uuid,boolean) to authenticated;

insert into public.game_office_assignments(game_id,user_id,role_title,status,appointed_by,approved_by,legal_basis)
select m.game_id,m.user_id,m.role_title,'active',g.owner_id,g.owner_id,'Перенос существующей должности из текущего сеанса'
from public.game_members m join public.games g on g.id=m.game_id where m.kind='student' and nullif(trim(m.role_title),'') is not null and m.role_title<>'Участник'
on conflict do nothing;

create table if not exists public.event_collaboration_invites(
 id uuid primary key default gen_random_uuid(),case_id uuid not null references public.event_cases(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,inviter_id uuid not null,recipient_id uuid not null,
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
 created_at timestamptz not null default now(),responded_at timestamptz,unique(case_id,recipient_id),
 foreign key(game_id,recipient_id) references public.game_members(game_id,user_id) on delete cascade
);
alter table public.event_collaboration_invites enable row level security;
grant select on public.event_collaboration_invites to authenticated;
create policy collaboration_invites_read on public.event_collaboration_invites for select to authenticated using(private.is_game_member(game_id));
create index if not exists collaboration_invites_badge on public.event_collaboration_invites(game_id,recipient_id,status);

create table if not exists public.event_discussion_messages(
 id bigint generated always as identity primary key,case_id uuid not null references public.event_cases(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,author_id uuid not null,
 body text not null check(length(trim(body)) between 1 and 2000),created_at timestamptz not null default now()
);
alter table public.event_discussion_messages enable row level security;
grant select on public.event_discussion_messages to authenticated;
create policy event_discussion_read on public.event_discussion_messages for select to authenticated using(private.is_game_teacher(game_id) or exists(select 1 from public.event_assignments where case_id=event_discussion_messages.case_id and recipient_id=auth.uid()));
create index if not exists event_discussion_case on public.event_discussion_messages(case_id,created_at);

create or replace function public.invite_event_collaborator(p_case uuid,p_recipient uuid) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.event_cases%rowtype;
begin
 select * into c from public.event_cases where id=p_case for update;
 if c.id is null or not exists(select 1 from public.event_assignments where case_id=p_case and recipient_id=auth.uid()) or not exists(select 1 from public.game_members where game_id=c.game_id and user_id=auth.uid() and kind='student') then raise exception 'Ситуация недоступна';end if;
 if exists(select 1 from public.event_decisions where case_id=p_case) or exists(select 1 from public.event_case_outcomes where case_id=p_case) then raise exception 'После начала голосования приглашения закрыты';end if;
 if p_recipient=auth.uid() or exists(select 1 from public.event_assignments where case_id=p_case and recipient_id=p_recipient) or not exists(select 1 from public.game_members where game_id=c.game_id and user_id=p_recipient and kind='student') then raise exception 'Выберите другого участника текущей игры';end if;
 if (select count(*) from public.event_collaboration_invites where case_id=p_case and status in ('pending','accepted'))>=30 then raise exception 'Достигнут предел приглашений';end if;
 insert into public.event_collaboration_invites(case_id,game_id,inviter_id,recipient_id) values(p_case,c.game_id,auth.uid(),p_recipient)
 on conflict(case_id,recipient_id) do update set status='pending',inviter_id=auth.uid(),responded_at=null where event_collaboration_invites.status in ('declined','cancelled');
end;$$;
revoke all on function public.invite_event_collaborator(uuid,uuid) from public,anon;
grant execute on function public.invite_event_collaborator(uuid,uuid) to authenticated;

create or replace function public.respond_event_invitation(p_id uuid,p_accept boolean) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare i public.event_collaboration_invites%rowtype;
begin
 select * into i from public.event_collaboration_invites where id=p_id and recipient_id=auth.uid();
 if i.id is null then raise exception 'Приглашение недоступно';end if;
 perform 1 from public.event_cases where id=i.case_id for update;
 select * into i from public.event_collaboration_invites where id=p_id for update;
 if i.status<>'pending' or exists(select 1 from public.event_decisions where case_id=i.case_id) then raise exception 'Приглашение уже закрыто';end if;
 update public.event_collaboration_invites set status=case when p_accept then 'accepted' else 'declined' end,responded_at=now() where id=p_id;
 if p_accept then
  update public.event_cases set audience='all' where id=i.case_id;
  insert into public.event_assignments(case_id,game_id,recipient_id,created_by) values(i.case_id,i.game_id,auth.uid(),i.inviter_id) on conflict do nothing;
 end if;
end;$$;
revoke all on function public.respond_event_invitation(uuid,boolean) from public,anon;
grant execute on function public.respond_event_invitation(uuid,boolean) to authenticated;

create or replace function public.send_event_discussion(p_case uuid,p_body text) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.event_cases%rowtype;
begin
 select * into c from public.event_cases where id=p_case;
 if c.id is null or not exists(select 1 from public.game_members where game_id=c.game_id and user_id=auth.uid() and kind<>'observer') or not (private.is_game_teacher(c.game_id) or exists(select 1 from public.event_assignments where case_id=p_case and recipient_id=auth.uid())) then raise exception 'Обсуждение недоступно';end if;
 if exists(select 1 from public.event_case_outcomes where case_id=p_case) then raise exception 'Обсуждение завершено';end if;
 insert into public.event_discussion_messages(case_id,game_id,author_id,body) values(p_case,c.game_id,auth.uid(),trim(p_body));
end;$$;
revoke all on function public.send_event_discussion(uuid,text) from public,anon;
grant execute on function public.send_event_discussion(uuid,text) to authenticated;

-- A decision stores immutable roles at vote time. Client-written evidence is forbidden.
alter table public.event_decisions add column if not exists role_snapshot text;
create or replace function private.snapshot_event_office() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.event_assignments%rowtype;c public.event_cases%rowtype;
begin
 select * into c from public.event_cases where id=new.case_id for update;
 select * into a from public.event_assignments where id=new.assignment_id;
 if c.id is null or a.case_id<>c.id or a.game_id<>new.game_id or a.recipient_id<>new.actor_id or a.status<>'pending' or new.actor_id<>auth.uid() then raise exception 'Некорректное назначение';end if;
 if not exists(select 1 from public.game_members where game_id=c.game_id and user_id=auth.uid() and kind='student') then raise exception 'Голосует только участник';end if;
 if exists(select 1 from public.event_case_outcomes where case_id=c.id) or exists(select 1 from public.event_collaboration_invites where case_id=c.id and status='pending') then raise exception 'Дождитесь ответа на приглашения';end if;
 if new.choice!~'^option_[1-6]$' or substring(new.choice from 8)::int>jsonb_array_length(c.decision_options) then raise exception 'Вариант недоступен';end if;
 select role_title into new.role_snapshot from public.game_members where game_id=c.game_id and user_id=new.actor_id;
 return new;
end;$$;
create trigger snapshot_event_office before insert on public.event_decisions for each row execute function private.snapshot_event_office();

create table if not exists public.event_authority_evidence(
 decision_id uuid primary key references public.event_decisions(id) on delete cascade,
 case_id uuid not null references public.event_cases(id) on delete cascade,game_id uuid not null references public.games(id) on delete cascade,
 actor_id uuid not null,stage_no integer not null,authority_ok boolean not null,lawful boolean not null,
 strategy_point boolean not null,role_snapshot text,legal_basis text not null,coalition_ids uuid[] not null default '{}',
 created_at timestamptz not null default now()
);
alter table public.event_authority_evidence enable row level security;
grant select on public.event_authority_evidence to authenticated;
create policy authority_evidence_read on public.event_authority_evidence for select to authenticated using(private.is_game_teacher(game_id) or actor_id=auth.uid());
create index if not exists event_authority_student_stage on public.event_authority_evidence(game_id,actor_id,stage_no);

create or replace function private.event_role_matches(p_snapshot text,p_roles jsonb) returns boolean language sql immutable set search_path='' as $$
 select exists(select 1 from jsonb_array_elements_text(coalesce(p_roles,'[]'::jsonb)) r where lower(coalesce(p_snapshot,'')) like '%'||lower(r)||'%');$$;

create or replace function private.record_event_authority() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.event_cases%rowtype;d record;o jsonb;qualified uuid[];ok boolean;lawful boolean;v_stage integer;violations int:=0;legal_delta numeric;v_authority_delta numeric;old_value numeric;new_value numeric;m public.state_metrics%rowtype;
begin
 select * into c from public.event_cases where id=new.case_id;
 select stage_no into v_stage from public.game_stages where game_id=c.game_id and status='open' order by stage_no desc limit 1;
 v_stage:=coalesce(v_stage,1);
 for d in select * from public.event_decisions where case_id=c.id loop
  o:=c.effect_plan->'options'->(substring(d.choice from 8)::int-1);
  select array_agg(x.actor_id) into qualified from public.event_decisions x where x.case_id=c.id and x.choice=d.choice and private.event_role_matches(x.role_snapshot,o->'authorized_roles');
  ok:=coalesce(cardinality(qualified),0)>0;
  lawful:=coalesce((o->>'lawful')::boolean,false);
  insert into public.event_authority_evidence(decision_id,case_id,game_id,actor_id,stage_no,authority_ok,lawful,strategy_point,role_snapshot,legal_basis,coalition_ids)
  values(d.id,c.id,c.game_id,d.actor_id,v_stage,ok,lawful,ok and lawful and coalesce((o->>'protects_role_interest')::boolean,false),d.role_snapshot,coalesce(o->>'legal_basis','Правовая разметка варианта отсутствует'),coalesce(qualified,'{}')) on conflict do nothing;
  if d.choice=new.winner and (not ok or not lawful) then violations:=violations+1;end if;
 end loop;
 if new.winner='tie' then return new;end if;
 v_authority_delta:=case when violations>0 then -greatest(0,new.requested_trust_delta)-least(6,violations*2) else 1 end;
 legal_delta:=case when violations>0 then -least(9,violations*3) else 2 end;
 perform private.apply_event_trust_delta(c.game_id,'authority-'||c.id,v_authority_delta,'Полномочия в событии: '||c.title);
 select * into m from public.state_metrics where game_id=c.game_id and metric_key='lawfulness' for update;
 if m.id is not null then
  old_value:=m.value;new_value:=greatest(coalesce(m.min_value,-1e9),least(coalesce(m.max_value,1e9),old_value+legal_delta));
  update public.state_metrics set previous_value=old_value,value=new_value where id=m.id;
  insert into public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note)
  values(c.game_id,m.id,m.metric_key,new_value,old_value,new_value-old_value,'event_authority',c.id::text,auth.uid(),'Правовая устойчивость: проверка полномочий по событию «'||c.title||'»');
 end if;
 update public.event_case_outcomes set trust_delta=new.trust_delta+coalesce((select delta from public.event_trust_ledger where game_id=c.game_id and action_key='authority-'||c.id),0),requested_trust_delta=new.requested_trust_delta+v_authority_delta where case_id=c.id;
 update public.political_posts set body=body||E'\n\nПроверка полномочий: нарушений '||violations||'. Суммарное фактическое изменение доверия: '||(select trust_delta from public.event_case_outcomes where case_id=c.id)||' п.п.' where id=new.media_post_id;
 return new;
end;$$;
create trigger record_event_authority after insert on public.event_case_outcomes for each row execute function private.record_event_authority();

revoke insert,update,delete on public.game_office_assignments,public.event_collaboration_invites,public.event_discussion_messages,public.event_authority_evidence from anon,authenticated;
