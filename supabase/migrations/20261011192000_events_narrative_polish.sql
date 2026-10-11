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
