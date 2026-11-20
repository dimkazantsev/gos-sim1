-- ГОС.ID: teacher-controlled crisis dynamics; do not modify Republic metrics or student grades.
-- Only three small scalar fields are added to the already synchronised game_crises row.
alter table public.game_crises
  add column if not exists threat_level smallint check (threat_level between 0 and 100),
  add column if not exists containment_level smallint not null default 0 check (containment_level between 0 and 100),
  add column if not exists management_revision integer not null default 0 check (management_revision >= 0);

-- Complete audit stays out of game_crises snapshots; it is loaded on demand.
create table if not exists public.crisis_management_history (
  id bigint generated always as identity primary key,
  crisis_id uuid not null references public.game_crises(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  action_id uuid not null,
  actor_id uuid not null,
  kind text not null check (kind in ('escalate','stabilize','finish')),
  old_threat smallint not null,
  new_threat smallint not null,
  old_containment smallint not null,
  new_containment smallint not null,
  reason text not null check (char_length(btrim(reason)) >= 10 and char_length(reason) <= 1200),
  created_at timestamptz not null default now(),
  unique (crisis_id,action_id)
);
create index if not exists crisis_management_history_lookup_idx on public.crisis_management_history(crisis_id,id desc);
alter table public.crisis_management_history enable row level security;
drop policy if exists crisis_management_history_game_read on public.crisis_management_history;
create policy crisis_management_history_game_read on public.crisis_management_history
 for select to authenticated using (private.is_game_member(game_id));
revoke all on public.crisis_management_history from public,anon,authenticated;
grant select on public.crisis_management_history to authenticated;

create or replace function public.manage_crisis(
 p_crisis_id uuid,
 p_action_id uuid,
 p_expected_revision integer,
 p_kind text,
 p_threat integer,
 p_containment integer,
 p_reason text,
 p_confirmed_conditions boolean[] default '{}'::boolean[]
) returns jsonb
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
 c public.game_crises%rowtype;
 v_threat integer;
 v_containment integer;
 v_reason text:=btrim(coalesce(p_reason,''));
 v_revision integer;
begin
 -- Serialize concurrent teacher actions. The same action UUID can be retried safely.
 select * into c from public.game_crises where id=p_crisis_id for update;
 if c.id is null then raise exception 'Кризис не найден'; end if;
 if (select auth.uid()) is null or not private.is_game_teacher(c.game_id) then
  raise exception 'Недостаточно прав для управления кризисом';
 end if;
 v_threat:=coalesce(c.threat_level,case c.intensity when 'low' then 25 when 'medium' then 50 when 'high' then 75 else 100 end);
 v_containment:=c.containment_level;
 if exists(select 1 from public.crisis_management_history where crisis_id=c.id and action_id=p_action_id) then
  return jsonb_build_object('revision',c.management_revision,'threat',v_threat,
   'containment',v_containment,'status',c.status,'already_applied',true);
 end if;
 if c.status<>'active' then raise exception 'Кризис уже завершён'; end if;
 if p_action_id is null or p_expected_revision is distinct from c.management_revision then
  raise exception 'Кризис изменён в другой вкладке. Обновите данные перед повтором';
 end if;
 if p_threat is null or p_containment is null or p_threat not between 0 and 100 or p_containment not between 0 and 100 then
  raise exception 'Показатели должны находиться в пределах 0–100';
 end if;
 if p_kind not in ('escalate','stabilize','finish') or p_kind is null then
  raise exception 'Неизвестное действие с кризисом';
 end if;
 if char_length(v_reason)<10 or char_length(v_reason)>1200 then
  raise exception 'Укажите конкретное основание действия (10–1200 символов)';
 end if;
 if p_kind='finish' and char_length(v_reason)<20 then
  raise exception 'Для завершения необходимо основание длиной не менее 20 символов';
 end if;
 if p_kind='escalate' then
  if p_threat<v_threat or p_containment>v_containment or
   (p_threat=v_threat and p_containment=v_containment) then
   raise exception 'Обострение должно усилить угрозу или уменьшить локализацию';
  end if;
 elsif p_kind='stabilize' then
  if p_threat>v_threat or p_containment<v_containment or
   (p_threat=v_threat and p_containment=v_containment) then
   raise exception 'Стабилизация должна уменьшить угрозу или увеличить локализацию';
  end if;
 else
  if p_threat is distinct from v_threat or p_containment is distinct from v_containment then
   raise exception 'Сначала сохраните изменение показателей';
  end if;
  if v_threat>30 or v_containment<70 then
   raise exception 'Для завершения нужны сила кризиса не выше 30 и локализация не ниже 70';
  end if;
  if p_confirmed_conditions is distinct from array[true,true,true]::boolean[] then
   raise exception 'Подтвердите выполнение всех трёх условий завершения';
  end if;
 end if;
 v_revision:=c.management_revision+1;
 update public.game_crises set threat_level=p_threat,containment_level=p_containment,
  management_revision=v_revision,
  status=case when p_kind='finish' then 'resolved' else c.status end,
  resolved_at=case when p_kind='finish' then now() else c.resolved_at end,
  resolution_note=case when p_kind='finish' then v_reason else c.resolution_note end
 where id=c.id;
 insert into public.crisis_management_history(
  crisis_id,game_id,action_id,actor_id,kind,old_threat,new_threat,old_containment,new_containment,reason
 ) values(c.id,c.game_id,p_action_id,(select auth.uid()),p_kind,
  v_threat,p_threat,v_containment,p_containment,v_reason);
 if p_kind='finish' then
  -- Preserve the existing public closure message, without duplicate metric effects.
  insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
  values(c.game_id,c.stage_no,'Кризис','notice','Кризис завершён · '||c.crisis_type,v_reason,(select auth.uid()));
 end if;
 return jsonb_build_object('revision',v_revision,'threat',p_threat,
   'containment',p_containment,'status',case when p_kind='finish' then 'resolved' else 'active' end,'already_applied',false);
end;
$$;
revoke all on function public.manage_crisis(uuid,uuid,integer,text,integer,integer,text,boolean[]) from public,anon;
grant execute on function public.manage_crisis(uuid,uuid,integer,text,integer,integer,text,boolean[]) to authenticated;
