-- Remove simulation framing from public-facing government situations.
-- Retain real references to training in schools, vocational programs, and workforce retraining.
update public.event_cases
set situation=replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(situation,
 'Это срок учебного задания, а не новая норма закона.','Это срок исполнения поручения; он не изменяет установленный законом порядок.'),
 'Для учебного сценария ','Для '),
 'в учебном бюджете','в утверждённом бюджете'),
 'учебному бюджету','бюджету'),
 'В учебном реестре','В реестре'),
 'В учебном досье','В материалах дела'),
 'В условиях учебного выпуска','По условиям выпуска'),
 'в учебном договоре','в договоре'),
 'В учебном отчётном месяце','В отчётном месяце'),
 'в учебной модели','в принятой модели')
where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523';

update public.event_cases
set effect_plan=replace(replace(replace(replace(replace(effect_plan::text,
 'Авторская учебная модель','Применимый порядок'),
 'в учебной процедуре','в установленной процедуре'),
 'учебную процедуру','установленную процедуру'),
 'в учебном бюджете','в бюджете'),
 'в учебной модели','в принятой модели')::jsonb
where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523' and effect_plan::text ilike '%учебн%';
