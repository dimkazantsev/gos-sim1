create or replace function private.validate_budget_draft(p_game uuid,d jsonb) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare b jsonb;k text;v jsonb;field text;lo numeric;hi numeric;req text;begin
 select data into b from private.budget_baseline where year=2026;
 if d is null or jsonb_typeof(d)<>'object' or length(trim(coalesce(d->>'title','')))<5 or length(d->>'title')>200 or length(coalesce(d->>'note',''))>20000 then raise exception 'Укажите название расчета от 5 до 200 символов и допустимое обоснование.';end if;
 if exists(select 1 from jsonb_object_keys(d) as keys(key_name) where keys.key_name not in ('title','note','income_changes','spending_changes','revenue_adjustments','financing','terms','transfer_ids')) then raise exception 'Неизвестное поле бюджетного расчета.';end if;
 foreach field in array array['income_changes','spending_changes','revenue_adjustments','financing','terms'] loop
  if jsonb_typeof(d->field) is distinct from 'object' then raise exception 'Бюджетный расчет содержит неверную структуру: %.',field;end if;
  lo:=case field when 'income_changes' then -80 when 'spending_changes' then -80 when 'revenue_adjustments' then -50000000 when 'financing' then -50000000 else 1 end;
  hi:=case when field in ('income_changes','spending_changes') then 200 when field='terms' then 120 else 50000000 end;
  for k,v in select * from jsonb_each(d->field) loop
   if jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric not between lo and hi then raise exception 'Число в поле % выходит за допустимый диапазон.',field;end if;
   if field in ('income_changes','revenue_adjustments') and not exists(select 1 from jsonb_array_elements(b->'income_lines') l where l->>'key'=k) then raise exception 'Неизвестная группа доходов.';end if;
   if field='spending_changes' and not exists(select 1 from jsonb_array_elements(b->'expense_lines') l where l->>'key'=k) then raise exception 'Неизвестный раздел расходов.';end if;
   if field='financing' and (not b->'financing' ? k or (k<>'other' and (v#>>'{}')::numeric<0)) then raise exception 'Источник финансирования должен быть известным и иметь неотрицательную сумму.';end if;
   if field='terms' and (k not in ('ofz_fixed','ofz_float','bank_credit','external') or trunc((v#>>'{}')::numeric)<>(v#>>'{}')::numeric) then raise exception 'Срок кредита должен быть целым числом месяцев от 1 до 120.';end if;
  end loop;
 end loop;
 if (select count(*) from jsonb_object_keys(d->'financing'))<>7 then raise exception 'Укажите все семь источников финансирования, включая нулевые суммы.';end if;
 if jsonb_typeof(d->'transfer_ids') is distinct from 'array' or jsonb_array_length(d->'transfer_ids')>100 then raise exception 'Неверный список региональных запросов.';end if;
 if (select count(distinct value) from jsonb_array_elements_text(d->'transfer_ids'))<>jsonb_array_length(d->'transfer_ids') then raise exception 'Региональный запрос включен дважды.';end if;
 for req in select jsonb_array_elements_text(d->'transfer_ids') loop
  if not exists(select 1 from budget_transfer_requests where id::text=req and game_id=p_game and status<>'rejected') then raise exception 'Запрос не относится к этой игре или уже отклонен.';end if;
 end loop;
end$$;

