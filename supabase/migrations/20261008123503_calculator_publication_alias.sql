-- Avoid ambiguity between the snapshot variable and the party mandate column.
create or replace function public.publish_regional_calculator_result(p_game_id uuid,p_method text,p_inputs jsonb,p_result jsonb)
returns uuid language plpgsql security definer set search_path='public','private','pg_temp'
as $function$
declare v_id uuid;v_total integer;party_ids uuid[];weights double precision[];allocation integer[];total double precision:=0;i integer;v_mandates jsonb;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Сохранение расчёта доступно только преподавателю';end if;
 if p_method is null or p_method not in('random','proportional','agreement') then raise exception 'Неизвестный метод распределения';end if;
 perform 1 from public.games where id=p_game_id for update;
 if p_inputs is null or jsonb_typeof(p_inputs)<>'object' or not private.valid_party_numbers(p_game_id,p_result,89,true) then raise exception 'Расчёт должен содержать неотрицательное целое число субъектов для всех партий этой игры';end if;
 select sum(value::integer)into v_total from jsonb_each_text(p_result);
 if v_total<>89 then raise exception 'Итог должен распределять ровно 89 субъектов; сейчас: %',v_total;end if;
 if p_method='agreement' and p_inputs->'agreement' is distinct from p_result then raise exception 'Итог должен совпадать с договорным распределением';end if;
 if p_method='proportional' then
  select jsonb_object_agg(id::text,greatest(0,mandates)),array_agg(id order by support desc,created_at,id),array_agg(greatest(0,mandates)::double precision order by support desc,created_at,id)
  into v_mandates,party_ids,weights from public.game_parties where game_id=p_game_id;
  if p_inputs->'mandates' is distinct from v_mandates then raise exception 'Обновите расчёт: распределение мандатов изменилось';end if;
  for i in 1..array_length(weights,1) loop total:=total+weights[i];end loop;
  if total<=0 then raise exception 'Сначала распределите мандаты Государственной Думы';end if;
  allocation:=private.largest_remainder_seats(weights,89,total/89);
  for i in 1..array_length(party_ids,1) loop
   if (p_result->>party_ids[i]::text)::integer<>allocation[i] then raise exception 'Итог не совпадает с пропорциональным распределением субъектов';end if;
  end loop;
 end if;
 insert into public.regional_calculator_results(game_id,created_by,method,inputs,result) values(p_game_id,auth.uid(),p_method,p_inputs,p_result) returning id into v_id;
 return v_id;
end;$function$;
