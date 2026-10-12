-- Unified read-only budget registry. Hiding a row never reverts or deletes fiscal source data.
create table if not exists public.budget_registry_hidden(
 game_id uuid not null references public.games(id) on delete cascade,
 entry_key text not null check(length(entry_key) between 3 and 160),
 hidden_by uuid not null,
 hidden_at timestamptz not null default now(),
 primary key(game_id,entry_key)
);
alter table public.budget_registry_hidden enable row level security;
revoke all on public.budget_registry_hidden from anon,authenticated;
create or replace function public.get_budget_change_registry(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare v_rows jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Доступ к игре запрещён'; end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.changed_at desc,e.entry_key desc),'[]'::jsonb) into v_rows
 from (
  select 'tax:'||p.id::text entry_key,'Доходы' category,'Налоговая инициатива: '||p.tax_key title,
   p.status status,p.created_at changed_at,p.author_id actor_id,p.document_id,
   'Ставка: '||p.new_rate::text||'; регион: '||p.region_code details,null::numeric amount
   from public.fiscal_rate_proposals p where p.game_id=p_game_id
  union all
  select 'fiscal:'||f.id::text,
   case when f.source_type='act' then 'Доходы' when f.source_type='event' then 'События' else 'Параметры' end,
   f.note,'Применено',f.created_at,f.actor_id,null::uuid,
   'Источник: '||f.source_type||coalesce('; регион: '||f.region_code,''),null::numeric
   from public.fiscal_change_ledger f where f.game_id=p_game_id
  union all
  select 'execution:'||l.id::text,'Исполнение',l.note,l.kind,l.created_at,null::uuid,null::uuid,
   'Изменение исполнения бюджета',l.amount from public.budget_simulator_ledger l where l.game_id=p_game_id
  union all
  select 'income:'||h.id::text,'Доходы',coalesce(nullif(h.note,''),'История доходов'),'Сохранено',h.recorded_at,null::uuid,null::uuid,
   'До: '||coalesce(h.previous_value::text,'—')||'; после: '||coalesce(h.value::text,'—'),h.value-h.previous_value from public.budget_income_history h where h.game_id=p_game_id
  union all
  select 'plan:'||p.id::text,'Бюджетные версии',p.title,p.status,p.updated_at,p.created_by,p.document_id,
   'Редакция бюджета',null::numeric from public.budget_simulator_plans p where p.game_id=p_game_id
  union all
  select 'transfer:'||t.id::text,'Регионы',t.purpose,t.status,t.created_at,t.created_by,t.document_id,
   'Регион: '||t.region_code||'; вид: '||t.kind,t.amount from public.budget_transfer_requests t where t.game_id=p_game_id
  union all
  select 'party:'||a.id::text,'Расходы',a.title,a.status,a.created_at,a.created_by,null::uuid,
   'Фракционная поправка',a.amount from public.budget_faction_amendments a where a.game_id=p_game_id
  union all
  select 'law:'||a.id::text,'НПА и поправки',a.title,a.status,a.created_at,a.author_id,a.document_id,
   'Поправка ко второму чтению',a.amount from public.budget_law_amendments a where a.game_id=p_game_id
  union all
  select 'financing:'||c.id::text,'Дефицит и долг','Источник финансирования '||c.source_key,c.status,c.created_at,null::uuid,null::uuid,
   'Погашение, месяц '||coalesce(c.maturity_month::text,'—'),c.principal from public.budget_finance_contracts c where c.game_id=p_game_id
  union all
  select 'program:'||c.program_id::text,'Госпрограммы','Бюджетное обязательство по государственной программе',c.status,
   coalesce(c.signed_at,'1970-01-01'::timestamptz),c.signed_by,null::uuid,
   'Год: '||c.budget_year,c.amount from public.state_program_budget_commitments c where c.game_id=p_game_id
 ) e where not exists(select 1 from public.budget_registry_hidden h where h.game_id=p_game_id and h.entry_key=e.entry_key);
 return v_rows;
end;$$;
revoke all on function public.get_budget_change_registry(uuid) from public,anon;
grant execute on function public.get_budget_change_registry(uuid) to authenticated;

create or replace function public.hide_budget_change_registry_entry(p_game_id uuid,p_entry_key text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Удалять записи реестра может только преподаватель';end if;
 if p_entry_key is null or length(p_entry_key) not between 3 and 160 then raise exception 'Неверный ключ записи';end if;
 if not (p_entry_key ~ '^(tax|fiscal|execution|income|plan|transfer|party|law|financing|program):[0-9a-f-]+$') then
  raise exception 'Неверный тип записи';
 end if;
 insert into public.budget_registry_hidden(game_id,entry_key,hidden_by) values(p_game_id,p_entry_key,auth.uid())
 on conflict(game_id,entry_key) do nothing;
end;$$;
revoke all on function public.hide_budget_change_registry_entry(uuid,text) from public,anon;
grant execute on function public.hide_budget_change_registry_entry(uuid,text) to authenticated;
