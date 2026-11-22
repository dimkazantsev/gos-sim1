-- Optimized budget registry pages: page only requested entries in JSON.
-- Identical ordering, formatting, categories and access checks as legacy RPC.
-- No schema objects, extra client requests, background polling or budget changes.
-- Raw rows are materialized once, replacing a full JSON array and two JSON scans.
CREATE OR REPLACE FUNCTION public.get_budget_change_registry_page(
 p_game_id uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 10,
 p_query text DEFAULT ''::text,p_category text DEFAULT ''::text,
 p_focus text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $function$
DECLARE
 v_rows jsonb;
 v_categories jsonb;
 v_total integer;
 v_offset integer:=greatest(coalesce(p_offset,0),0);
 v_limit integer:=least(greatest(coalesce(p_limit,10),1),10);
 v_query text:=lower(left(trim(coalesce(p_query,'')),120));
 v_category text:=left(coalesce(p_category,''),80);
BEGIN
 IF auth.uid() IS NULL OR NOT private.is_game_member(p_game_id)
 THEN RAISE EXCEPTION 'Доступ к игре запрещён'; END IF;
 WITH entries AS MATERIALIZED (
  SELECT e.*,
   case e.status
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
    else case when e.status ~ '[А-Яа-яЁё]' and e.status !~ '[A-Za-z_]' then e.status else 'Статус не определён' end end AS status_label
  FROM (
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
  ) e
  WHERE NOT EXISTS(
   SELECT 1 FROM public.budget_registry_hidden h
   WHERE h.game_id=p_game_id AND h.entry_key=e.entry_key)
 ), filtered AS MATERIALIZED (
  SELECT e.* FROM entries e
  WHERE (v_category='' OR e.category=v_category)
   AND (v_query='' OR position(v_query IN lower(concat_ws(' ',
      e.title,e.details,e.category,e.status_label)))>0)
 ), page AS MATERIALIZED (
  SELECT f.*,CASE WHEN p_focus IS NOT NULL AND f.entry_key=p_focus
    THEN 0 ELSE 1 END AS priority
  FROM filtered f
  ORDER BY priority,f.changed_at DESC,f.entry_key DESC
  OFFSET v_offset LIMIT v_limit
 )
 SELECT
  (SELECT coalesce(jsonb_agg(cat ORDER BY cat),'[]'::jsonb)
   FROM (SELECT DISTINCT category AS cat FROM entries
    WHERE category IS NOT NULL) categories),
  (SELECT count(*)::integer FROM filtered),
  (SELECT coalesce(jsonb_agg(
    (to_jsonb(p)-'status_label'-'priority')
       ||jsonb_build_object('status',p.status_label)
    ORDER BY p.priority,p.changed_at DESC,p.entry_key DESC),'[]'::jsonb)
   FROM page p)
 INTO v_categories,v_total,v_rows;
 RETURN jsonb_build_object('entries',v_rows,'total',v_total,'categories',v_categories);
END;
$function$;
