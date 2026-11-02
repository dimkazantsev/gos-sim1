-- Text-only correction of case descriptions already stored in active games.
-- Preserve UUIDs, scenarios, roles, decision options, consequences, scores, and
-- all numeric circumstances. Restrict each substitution to its known original.
with phrasing(case_key,old_start,new_start) as (
 values
 ('bank-legal-2026-087','В вымышленном сценарии Луганской Народной Республики','В Луганской Народной Республике'),
 ('bank-legal-2026-088','В вымышленном сценарии Херсонской области','В Херсонской области'),
 ('bank-legal-2026-089','В вымышленном сценарии Запорожской области','В Запорожской области'),
 ('budget-region-2026-05-essential-services-gap','В вымышленном сценарии Республики Дагестан','В Республике Дагестан'),
 ('budget-region-2026-10-hospital-equipment','В вымышленном сценарии Республики Карелия','В Республике Карелия'),
 ('budget-region-2026-22-drought-irrigation','В вымышленном сценарии Алтайского края','В Алтайском крае'),
 ('budget-region-2026-25-bridge-detour','В вымышленном сценарии Приморского края','В Приморском крае'),
 ('budget-region-2026-38-forest-recovery','В вымышленном сценарии Иркутской области','В Иркутской области'),
 ('budget-region-2026-40-industrial-grid','В вымышленном сценарии Калужской области','В Калужской области'),
 ('budget-region-2026-42-employment-retraining','В вымышленном сценарии Кемеровской области — Кузбасса','В Кемеровской области — Кузбассе'),
 ('budget-region-2026-43-rural-cultural-centres','В вымышленном сценарии Кировской области','В Кировской области'),
 ('budget-region-2026-45-rural-broadband','В вымышленном сценарии Курганской области','В Курганской области'),
 ('budget-region-2026-47-food-logistics','В вымышленном сценарии Ленинградской области','В Ленинградской области'),
 ('budget-region-2026-54-school-capacity','В вымышленном сценарии Новосибирской области','В Новосибирской области'),
 ('budget-region-2026-56-flood-drainage','В вымышленном сценарии Оренбургской области','В Оренбургской области'),
 ('budget-region-2026-59-heating-network','В вымышленном сценарии Пермского края','В Пермском крае'),
 ('budget-region-2026-63-technical-college','В вымышленном сценарии Самарской области','В Самарской области'),
 ('budget-region-2026-64-wastewater-cleaning','В вымышленном сценарии Саратовской области','В Саратовской области'),
 ('budget-region-2026-72-temporary-family-housing','В вымышленном сценарии Тюменской области','В Тюменской области')
)
update public.event_cases e
set situation=p.new_start||substring(e.situation from length(p.old_start)+1)
from phrasing p
where e.case_key=p.case_key
  and left(e.situation,length(p.old_start))=p.old_start;

-- Other identified meta-framing; don't touch legitimate theatrical fiction or
-- fictitious staffing reports, which are substantive circumstances of cases.
update public.event_cases
set situation=replace(replace(situation,
 'Для учебного сценария Донецкой Народной Республики','В Донецкой Народной Республике'),
 'В учебном соглашении','В соглашении')
where case_key='bank-legal-2026-086'
 and situation like 'Для учебного сценария Донецкой Народной Республики%';

update public.event_cases
set situation=replace(situation,'В учебном реестре','В реестре')
where case_key='bank-legal-2026-010'
 and situation like '%В учебном реестре%';

update public.event_cases
set situation=replace(situation,'в конце учебного финансового периода','в конце финансового периода')
where case_key='budget-region-2026-39-credit-return'
 and situation like '%в конце учебного финансового периода%';

update public.event_cases
set situation=replace(situation,'В вымышленном сценарии рублевый курс','Рублёвый курс')
where case_key='budget-risk-2026-external'
 and situation like '%В вымышленном сценарии рублевый курс%';
