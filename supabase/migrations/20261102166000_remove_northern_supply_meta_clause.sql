-- Follow-up: one inner paragraph, not a case opening. Preserve the amounts,
-- credit terms, repayment schedule and every option/consequence.
update public.event_cases
set situation=replace(
 situation,
 'В вымышленном сценарии своевременный завоз сохраняет работу нескольких предприятий; ошибка учета затрудняет следующий заем.',
 'Своевременный завоз сохраняет работу нескольких предприятий; ошибка учёта затрудняет следующий заём.'
)
where case_key='budget-region-2026-14-credit'
 and situation like '%В вымышленном сценарии своевременный завоз сохраняет работу нескольких предприятий; ошибка учета затрудняет следующий заем.%';
