-- Editorial polish only; preserve all case IDs, options, legal flags and effects.
update public.event_cases
set situation=replace(replace(replace(replace(replace(situation,
 'В учебном сценарии ','В '),
 'в учебном сценарии ','в '),
 'в конце учебного финансового периода','в конце финансового периода'),
 'В учебном плане','В финансовом плане'),
 'учебного банка','банка')
where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523'
 and (situation ilike '%учебном сценарии%' or situation ilike '%учебного финансового%' or situation ilike '%учебном плане%' or situation ilike '%учебного банка%');

-- Keep provenance context without classroom vocabulary.
update public.event_cases
set source_note=replace(replace(replace(replace(replace(source_note,
 'Авторская учебная ситуация GOS//SIMS','Ситуация GOS//SIMS'),
 'Авторская учебная ситуация','Ситуация'),
 'Вымышленный учебный сценарий','Смоделированная ситуация'),
 'учебной модели','модели'),
 'учебной процедуры','процедуры')
where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523'
 and source_note ilike '%учебн%';

update public.event_cases
set source_note=replace(replace(replace(replace(source_note,
 'Авторский вымышленный учебный сценарий','Смоделированная ситуация'),
 'Оригинальный вымышленный учебный кейс','Смоделированная ситуация'),
 'Авторская учебная задача','Ситуация'),
 'учебной модели','модели')
where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523'
 and source_note ilike '%учебн%';
