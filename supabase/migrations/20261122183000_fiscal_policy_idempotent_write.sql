-- One existing authorized budget write RPC, no added client requests.
-- Avoid the heavyweight get_fiscal_context call for central bank/key-rate
-- and ordinary teacher changes; preserve region seeding and first-write init.
-- Deduplicate repeated no-op writes under the existing FOR UPDATE row lock.
-- Budget coefficients, authorized offices, activity reference formula, signatures,
-- fiscal ledger for REAL changes, tables and realtime subscriptions are untouched.
CREATE OR REPLACE FUNCTION public.set_fiscal_policy(p_game_id uuid, p_values jsonb, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare old_row jsonb;new_row jsonb;is_teacher boolean;k text;allowed boolean;
 v_context jsonb;v_reference numeric;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then
   raise exception 'Нет доступа к этой игре.';
 end if;
 is_teacher:=private.is_game_teacher(p_game_id);
 allowed:=is_teacher or exists(
   select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid()
   and m.kind='student' and m.roster_archived_at is null
 and private.role_is_available(p_game_id,auth.uid())
 and (
   lower(coalesce(m.role_title,'')) ~ 'банк[а-я]* россии|центральн.{0,20}банк'
   or exists (
     select 1 from public.game_office_assignments a
     where a.game_id=p_game_id and a.user_id=m.user_id and a.status='active'
       and a.role_title='Председатель Центрального банка Российской Федерации'
   )
 )
 );
 if not allowed then
   raise exception 'Ключевую ставку меняет Банк России. Параметры сценария задаёт преподаватель.';
 end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' or p_values='{}'::jsonb
    or p_reason is null or length(trim(p_reason))<8 then
   raise exception 'Укажите параметры и содержательное основание решения.';
 end if;
 for k in select jsonb_object_keys(p_values) loop
   if k not in ('key_rate','fx_rate','oil_price','cutoff_price','inflation','federal_expenditure','municipal_expenditure','activity_override') then
     raise exception 'Неизвестный параметр бюджетного сценария.';
   end if;
   if not is_teacher and k<>'key_rate' then
     raise exception 'Экономическую основу модели меняет только преподаватель.';
   end if;
   if k='activity_override' then
     if jsonb_typeof(p_values->k) not in ('number','null') then
       raise exception 'Деловая активность должна быть числом или автоматическим расчётом.';
     end if;
     if jsonb_typeof(p_values->k)='number'
       and ((p_values->>k)::numeric < 0 or (p_values->>k)::numeric > 1000) then
       raise exception 'Деловая активность должна быть от 0 до 1000 процентов исходного уровня.';
     end if;
   elsif jsonb_typeof(p_values->k)<>'number' then
     raise exception 'Значение должно быть числом.';
   end if;
 end loop;
 -- For a rate or ordinary macro change, avoid a second full fiscal
 -- context read. Keep the original region seeding on the write path.
 -- Manual activity still uses the original authorized context/metrics.
 if p_values ? 'activity_override' and p_values->>'activity_override' is not null then
   v_context:=public.get_fiscal_context(p_game_id);
 else
   perform private.ensure_fiscal_game(p_game_id);
 end if;
 select to_jsonb(p) into old_row from game_fiscal_policy p
  where game_id=p_game_id for update;
 -- Preserve the original initialization behavior for a first direct write.
 if old_row is null then
   v_context:=public.get_fiscal_context(p_game_id);
   select to_jsonb(p) into old_row from game_fiscal_policy p
    where game_id=p_game_id for update;
 end if;
 if old_row is null then
   raise exception 'Не удалось получить экономические параметры этой игры.';
 end if;
 -- A stale/repeated request must not write identical policy data or a
 -- misleading fiscal-change ledger record. Evaluate while holding the row lock.
 if not exists (
   select 1 from jsonb_each(p_values) change
   where (change.value #>> '{}')::numeric
     is distinct from (old_row->>change.key)::numeric
 ) then
   raise exception 'Значения параметров не изменились. Обновите данные перед повторным сохранением.';
 end if;
 -- Rebase only when the teacher explicitly submits a new manual value.
 -- A rate change by the Bank of Russia never resets this reference.
 if p_values ? 'activity_override' and p_values->>'activity_override' is not null then
  v_reference:=private.fiscal_activity_reference(
   coalesce((p_values->>'key_rate')::numeric,(old_row->>'key_rate')::numeric),
   coalesce((p_values->>'fx_rate')::numeric,(old_row->>'fx_rate')::numeric),
   coalesce((v_context->'metrics'->>'economy')::numeric,(old_row->>'baseline_economy')::numeric)
    -(old_row->>'baseline_economy')::numeric,
   coalesce((v_context->'metrics'->>'public_trust')::numeric,(old_row->>'baseline_trust')::numeric)
    -(old_row->>'baseline_trust')::numeric
  );
 end if;
 update game_fiscal_policy set
   key_rate=coalesce((p_values->>'key_rate')::numeric,key_rate),
   fx_rate=coalesce((p_values->>'fx_rate')::numeric,fx_rate),
   oil_price=coalesce((p_values->>'oil_price')::numeric,oil_price),
   cutoff_price=coalesce((p_values->>'cutoff_price')::numeric,cutoff_price),
   inflation=coalesce((p_values->>'inflation')::numeric,inflation),
   federal_expenditure=coalesce((p_values->>'federal_expenditure')::numeric,federal_expenditure),
   municipal_expenditure=coalesce((p_values->>'municipal_expenditure')::numeric,municipal_expenditure),
   activity_override=case when p_values ? 'activity_override'
     then (p_values->>'activity_override')::numeric else activity_override end,
   activity_reference=case when p_values ? 'activity_override'
     then v_reference else activity_reference end,
   updated_at=now()
 where game_id=p_game_id returning to_jsonb(game_fiscal_policy.*) into new_row;
 insert into fiscal_change_ledger(game_id,source_type,source_id,note,before_values,after_values,actor_id)
 values(p_game_id,'macro',gen_random_uuid()::text,
   case when is_teacher then 'Параметры сценария: ' else 'Решение Банка России: ' end||trim(p_reason),
   old_row,new_row,auth.uid());
end$function$
;
