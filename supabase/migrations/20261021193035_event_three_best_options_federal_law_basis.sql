-- Amend only textual explanations in the verified best option for three unassigned source-backed events.
-- No changes to answer positions, numeric effects, permissions, scores or decided cases.
DO $guard$ BEGIN
 IF (SELECT count(*) FROM public.event_cases c WHERE c.case_key IN ('bank-budget-bridge','bank-budget-health','bank-budget-school') AND c.status='ready' AND NOT EXISTS(SELECT 1 FROM public.event_assignments a WHERE a.case_id=c.id) AND NOT EXISTS(SELECT 1 FROM public.event_decisions d WHERE d.case_id=c.id))<>3 THEN RAISE EXCEPTION 'Event already in progress: refuse explanation rewrite'; END IF;
 END $guard$;

UPDATE public.event_cases c SET effect_plan=jsonb_set(c.effect_plan,'{options}',(
 SELECT jsonb_agg(CASE WHEN o.item->>'key'=c.effect_plan->>'best_option_key'
  THEN jsonb_set(jsonb_set(o.item,'{description}',to_jsonb('Первое решение направлено на безопасность людей и сохранение транспортной доступности. При снижении несущей способности дорожного сооружения компетентный орган вводит предусмотренные законом ограничения движения, организует безопасный объезд и обеспечивает информирование пользователей. Обследование конструкции, проектирование восстановительных работ и подтверждение бюджетных расходов оформляются отдельно. Самовольный проезд до обследования либо немедленное финансирование полной реконструкции без проекта не могут заменять эти действия.'::text)),'{legal_basis}',to_jsonb('Федеральный закон от 08.11.2007 № 257-ФЗ, статья 30: основания ограничения движения, порядок организации объезда и обязанность информирования пользователей дороги.'::text))
  ELSE o.item END ORDER BY o.pos)
 FROM jsonb_array_elements(c.effect_plan->'options') WITH ORDINALITY AS o(item,pos)
)) WHERE c.case_key='bank-budget-bridge' AND c.status='ready';

UPDATE public.event_cases c SET effect_plan=jsonb_set(c.effect_plan,'{options}',(
 SELECT jsonb_agg(CASE WHEN o.item->>'key'=c.effect_plan->>'best_option_key'
  THEN jsonb_set(jsonb_set(o.item,'{description}',to_jsonb('Подтверждённые нарушения касались фактической доступности записи к детским стоматологам и недостаточной численности специалистов. Обоснованное решение начинается с анализа расписания, реального числа доступных приёмов и кадрового дефицита. Необходимо восстановить запись в понятный срок и контролировать результат через фактические доступные интервалы; увеличение количества персонала допустимо при соблюдении трудовых норм. Строительные расходы сами по себе не гарантируют восстановление доступа к медицинской помощи.'::text)),'{legal_basis}',to_jsonb('Федеральный закон от 21.11.2011 № 323-ФЗ, статья 10: доступность медицинской помощи, необходимое количество медицинских работников и организация оказания помощи.'::text))
  ELSE o.item END ORDER BY o.pos)
 FROM jsonb_array_elements(c.effect_plan->'options') WITH ORDINALITY AS o(item,pos)
)) WHERE c.case_key='bank-budget-health' AND c.status='ready';

UPDATE public.event_cases c SET effect_plan=jsonb_set(c.effect_plan,'{options}',(
 SELECT jsonb_agg(CASE WHEN o.item->>'key'=c.effect_plan->>'best_option_key'
  THEN jsonb_set(jsonb_set(o.item,'{description}',to_jsonb('Выявленные протечки и повреждения помещений требуют документальной оценки риска и обеспечения безопасных условий для учащихся и работников. Учредитель и образовательная организация действуют в пределах своих полномочий: определяют необходимые ограничения эксплуатации, законный источник финансирования и процедуру ремонта. Выполнение и приёмку работ необходимо подтвердить техническими и финансовыми документами. Перенос ремонта на неопределённый срок не устраняет выявленный риск для здоровья.'::text)),'{legal_basis}',to_jsonb('Федеральный закон от 29.12.2012 № 273-ФЗ, статьи 28 и 41: обеспечение безопасных условий обучения и охрана здоровья обучающихся.'::text))
  ELSE o.item END ORDER BY o.pos)
 FROM jsonb_array_elements(c.effect_plan->'options') WITH ORDINALITY AS o(item,pos)
)) WHERE c.case_key='bank-budget-school' AND c.status='ready';
DO $check$ BEGIN IF (SELECT count(*) FROM public.event_cases c WHERE c.case_key IN ('bank-budget-bridge','bank-budget-health','bank-budget-school') AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.effect_plan->'options') o WHERE o->>'key'=c.effect_plan->>'best_option_key' AND o->>'legal_basis' LIKE 'Федеральный закон%'))<>3 THEN RAISE EXCEPTION 'Legal basis rewrite incomplete'; END IF; END $check$;