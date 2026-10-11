-- The signed-off REViEW matrix contains exactly 330 rows, sorted by case_key.
-- Encode its earliest-stage column in hexadecimal; do not infer stage from category.
do $$
declare codes text:='eaae9999eeeaa989eaeaf9aa9a9aa8a9aae9eaaf9fa99aa8e99ea999a7e9ae998ae99999e9eee99e999ee99e9e9e9eae998e89ee9eee99e9a98ea9aaffaaeaaefd8ae9daaa98de9aadddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddcccccccc1177ccccccccccccccccccdcccddcccccccccccceccc1ccccccccad8e9dddddddddddddddddddddddddddddd'; n int;
begin
 if length(codes)<>330 then raise exception 'Matrix length invalid';end if;
 select count(*) into n from public.event_cases where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523';
 if n<>330 then raise exception 'Case catalog changed: expected 330, found %',n;end if;
 insert into public.event_case_routing(game_id,case_id,earliest_stage,latest_stage,region_code,destination)
 with numbered as(
  select ec.*,row_number() over(order by ec.case_key)-1 rn
  from public.event_cases ec where ec.game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523'
 ),tagged as(
  select *,strpos('0123456789abcdef',substr(codes,(rn+1)::int,1))-1 early,
   case when case_key like 'bank-legal-2026-%'
         and substring(case_key from '[0-9]+$')::int between 1 and 89
        then (select code from public.fiscal_region_reference order by code
              offset (substring(case_key from '[0-9]+$')::int-1) limit 1)
        when case_key ~ '^budget-region-2026-[0-9]{2}-'
        then substring(case_key from '^budget-region-2026-([0-9]{2})-')
        else null end region
  from numbered
 )
 select game_id,id,early,15,region,
 case when region is not null and audience='group' then 'regional_joint'
      when region is not null then 'regional'
      when audience='all' then 'federal_collective'
      when audience='group' then 'federal_joint'
      else 'individual' end
 from tagged;
 get diagnostics n=row_count;
 if n<>330 then raise exception 'Incomplete matrix insertion: %',n;end if;
 if (select count(*) from public.event_case_routing where game_id='541b6fde-16d5-4225-8f67-1fc2c7c15523' and region_code is not null)<>113
 then raise exception 'Expected 113 region-specific cases';end if;
end $$;
