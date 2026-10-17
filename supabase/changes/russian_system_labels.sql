-- Russian presentation of existing budget rows and system-generated captions.
-- Persistent enum values, calculations, membership checks and permissions are unchanged.

CREATE OR REPLACE FUNCTION public.get_budget_change_registry(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_rows jsonb;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Доступ к игре запрещён'; end if;
 select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('status',case e.status
    when 'draft' then 'Черновик'
    when 'submitted' then 'На рассмотрении'
    when 'pending' then 'Ожидает решения'
    when 'voting' then 'На голосовании'
    when 'vote_open' then 'На голосовании'
    when 'accepted' then 'Принято'
    when 'approved' then 'Одобрено'
    when 'adopted' then 'Принято'
    when 'rejected' then 'Отклонено'
    when 'withdrawn' then 'Отозвано'
    when 'applied' then 'Применено'
    when 'registered' then 'Зарегистрировано'
    when 'final' then 'Расчёт зафиксирован'
    when 'document' then 'Проект зарегистрирован'
    when 'published' then 'Опубликовано'
    when 'active' then 'Действует'
    when 'paid' then 'Погашено'
    when 'repaid' then 'Возвращено'
    when 'due' then 'Наступил срок погашения'
    when 'overdue' then 'Просрочено'
    when 'granted' then 'Предоставлено'
    when 'requested' then 'Запрошено'
    when 'cancelled' then 'Отменено'
    when 'outcome' then 'Последствия ситуации'
    when 'publication' then 'Опубликование закона'
    when 'interest' then 'Начисление процентов'
    when 'maturity' then 'Срок погашения'
    when 'regional_maturity' then 'Срок возврата регионального кредита'
    when 'opening' then 'Начальный остаток'
    when 'repayment' then 'Погашение долга'
    when 'amendment' then 'Бюджетная поправка'
    when 'transfer' then 'Перечисление трансферта'
    when 'request' then 'Региональный запрос'
    when 'credit_repaid' then 'Возврат бюджетного кредита'
    else case when e.status ~ '[А-Яа-яЁё]' and e.status !~ '[A-Za-z_]' then e.status else 'Статус не определён' end end) order by e.changed_at desc,e.entry_key desc),'[]'::jsonb) into v_rows
 from (
  select 'tax:'||p.id::text entry_key,'Доходы' category,'Налоговая инициатива: '||coalesce((select label from public.fiscal_tax_catalog where tax_key=p.tax_key),'Налог') title,
   p.status status,p.created_at changed_at,p.author_id actor_id,p.document_id,
   'Ставка: '||p.new_rate::text||'; регион: '||p.region_code details,null::numeric amount
   from public.fiscal_rate_proposals p where p.game_id=p_game_id
  union all
  select 'fiscal:'||f.id::text,
   case when f.source_type='act' then 'Доходы' when f.source_type='event' then 'События' else 'Параметры' end,
   f.note,'Применено',f.created_at,f.actor_id,null::uuid,
   'Источник: '||case f.source_type when 'act' then 'Нормативный акт' when 'event' then 'Событие' when 'manual' then 'Корректировка преподавателя' when 'baseline' then 'Исходные параметры' else 'Игровая операция' end||coalesce('; регион: '||f.region_code,''),null::numeric
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
   'Регион: '||t.region_code||'; вид: '||case t.kind when 'grant' then 'Дотация' when 'subsidy' then 'Субсидия' when 'subvention' then 'Субвенция' when 'budget_credit' then 'Бюджетный кредит' else 'Трансферт' end,t.amount from public.budget_transfer_requests t where t.game_id=p_game_id
  union all
  select 'party:'||a.id::text,'Расходы',a.title,a.status,a.created_at,a.created_by,null::uuid,
   'Фракционная поправка',a.amount from public.budget_faction_amendments a where a.game_id=p_game_id
  union all
  select 'law:'||a.id::text,'НПА и поправки',a.title,a.status,a.created_at,a.author_id,a.document_id,
   'Поправка ко второму чтению',a.amount from public.budget_law_amendments a where a.game_id=p_game_id
  union all
  select 'financing:'||c.id::text,'Дефицит и долг','Источник финансирования: '||case c.source_key when 'ofz_fixed' then 'ОФЗ с постоянным купоном' when 'ofz_float' then 'ОФЗ с переменным купоном' when 'bank_credit' then 'Кредит кредитной организации' when 'external' then 'Внешнее заимствование' when 'reserves' then 'Средства ФНБ' when 'privatization' then 'Приватизация акций' when 'other' then 'Прочие источники и изменение остатков' else 'Финансирование бюджета' end,c.status,c.created_at,null::uuid,null::uuid,
   'Погашение, месяц '||coalesce(c.maturity_month::text,'—'),c.principal from public.budget_finance_contracts c where c.game_id=p_game_id
  union all
  select 'program:'||c.program_id::text,'Госпрограммы','Бюджетное обязательство по государственной программе',c.status,
   coalesce(c.signed_at,'1970-01-01'::timestamptz),c.signed_by,null::uuid,
   'Год: '||c.budget_year,c.amount from public.state_program_budget_commitments c where c.game_id=p_game_id
 ) e where not exists(select 1 from public.budget_registry_hidden h where h.game_id=p_game_id and h.entry_key=e.entry_key);
 return v_rows;
end;$function$;

-- Replace only the platform name in the current function bodies; grants and business logic stay intact.
do $localize$
declare r record; definition text;
begin
 for r in
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname=any(array['prepare_political_context','presidential_document_check','presidential_submission_review_json','presidential_system_vote_trigger','publish_process_update','telegram_assignment_enqueue','telegram_document_enqueue','telegram_event_enqueue']) and p.prokind='f'
 loop
  definition:=pg_get_functiondef(r.oid);
  if position('GOS//SIMS' in definition)>0 then
   execute replace(definition,'GOS//SIMS','ГОС.ID');
  end if;
 end loop;
 for r in
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='public' and p.proname='create_game_session')
     or (n.nspname='private' and p.proname='stage_readiness_json')
 loop
  definition:=pg_get_functiondef(r.oid);
  definition:=replace(replace(definition,'Ghost voting','Goust Voting'),'ghost voting','Goust Voting');
  execute definition;
 end loop;
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='save_budget_simulator'
 loop
  definition:=pg_get_functiondef(r.oid);
  execute replace(definition,'Млн рублей. Минфин России, первоначальный план 2026; расчет по игровым допущениям. minfin-approved-2026-v1','Млн рублей. Минфин России, первоначальный план 2026; расчёт по игровым допущениям.');
 end loop;
end;
$localize$;

-- Repair system-owned captions without changing participant-authored titles or bodies.
update public.political_posts set actor_label='ГОС.ID'
where actor_key in ('teacher','system') and actor_label='GOS//SIMS' and deleted_at is null;
update public.game_stages set title='Goust Voting',
 summary=replace(replace(summary,'Ghost voting','Goust Voting'),'ghost voting','Goust Voting')
where stage_no=5 and lower(title)='ghost voting';

update public.budget_scenarios set source_note='Млн рублей. Минфин России, первоначальный план 2026; расчёт по игровым допущениям.'
where source_note='Млн рублей. Минфин России, первоначальный план 2026; расчет по игровым допущениям. minfin-approved-2026-v1';

update private.achievement_catalog set title='Самый стойкий сигнал'
where title='Самый стойкий Wi-Fi';
