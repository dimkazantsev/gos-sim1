alter table public.event_case_routing add column if not exists competent_org text;
do $$
declare codes text:='56857777575897g77g58d46g9g79bg83g95986gd4867a6b1gd3514ba8d5gb5dbg857gb1h5g555g7555g557g5g575g59577g5g7757555775797g59g68949d5bb54bg857b68g4gb5468eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeifiii0ffff22fffffffffffffffffffffffffffffiffiiiiffff0fiifffff8bg57eeeeeeeeeeeeeeeeeeeeeeeecccccc'; n int;
begin
 if length(codes)<>330 then raise exception 'Competency mapping corrupted';end if;
 with numbered as(
  select ec.id,ec.game_id,row_number() over(order by ec.case_key) rn
  from public.event_cases ec where ec.game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523'
 ), mapped as(
  select id,game_id,strpos('0123456789abcdefghijklmnopqrstuv',substr(codes,rn::int,1))-1 idx from numbered
 ), orgs as(
  select arr,(ordinality-1) idx from unnest(array[
  'Государственная Дума / депутат',
  'Депутат ГД / комиссия (уточнить)',
  'Избирательная комиссия',
  'МИД / Правительство РФ',
  'МЧС / региональные службы (совместно)',
  'Местное самоуправление / профильная администрация',
  'Минздрав / региональный орган здравоохранения',
  'Минкультуры / муниципальные учреждения',
  'Минобрнауки / Минпросвещения; региональный профильный орган',
  'Минприроды / профильный природоохранный орган',
  'Минтранс / региональные транспортные органы',
  'Минфин / Минэкономразвития / Минтруд (по сфере)',
  'Минфин РФ / Правительство РФ',
  'Минцифры / оператор системы',
  'Победившая региональная партия / губернатор; финансовый орган региона',
  'Правительство / Минюст (уточнить компетенцию)',
  'Профильное федеральное министерство (уточнить)',
  'Профильный компетентный орган (ручное сопоставление)',
  'Судебные органы; правовая служба (по полномочию)'
  ]) with ordinality as t(arr,ordinality)
 )
 update public.event_case_routing r set competent_org=o.arr
 from mapped m join orgs o on o.idx=m.idx
 where r.case_id=m.id and r.game_id=m.game_id;
 get diagnostics n=row_count;
 if n<>330 then raise exception 'Incomplete competencies %',n;end if;
end $$;
