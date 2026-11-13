-- Teacher's manual activity is a baseline. Subsequent macro and game-metric
-- changes apply relative to an automatic factor captured at that moment.
-- Historical manual values are preserved exactly during this migration.
ALTER TABLE public.game_fiscal_policy
 ADD COLUMN IF NOT EXISTS activity_reference numeric
 CHECK (activity_reference BETWEEN 0.65 AND 1.40);

-- Matches fiscalEnvironment() in fiscalMath.ts. Only used on baseline changes
-- and once for the bounded backfill; never called per region or per render.
CREATE OR REPLACE FUNCTION private.fiscal_activity_reference(
 p_key_rate numeric,p_fx_rate numeric,p_economy_delta numeric,p_trust_delta numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
 SELECT greatest(.65,least(1.4,
  1-(p_key_rate-16)*.007+p_economy_delta*.002+p_trust_delta*.001
   -(p_fx_rate*greatest(.75,least(1.3,
      1-p_economy_delta*.001-p_trust_delta*.001-(p_key_rate-16)*.0015
     ))/80-1)*.06
 ));
$f$;
REVOKE ALL ON FUNCTION private.fiscal_activity_reference(numeric,numeric,numeric,numeric)
 FROM PUBLIC,anon,authenticated;

-- Existing manual values (including 79%) do not jump. Exactly one update
-- for each existing manual row; no history, balance, or extra game records.
UPDATE public.game_fiscal_policy p
SET activity_reference=private.fiscal_activity_reference(
 p.key_rate,p.fx_rate,
 coalesce((SELECT m.value FROM public.state_metrics m
  WHERE m.game_id=p.game_id AND m.metric_key='economy'),p.baseline_economy)-p.baseline_economy,
 coalesce((SELECT m.value FROM public.state_metrics m
  WHERE m.game_id=p.game_id AND m.metric_key='public_trust'),p.baseline_trust)-p.baseline_trust
)
WHERE p.activity_override IS NOT NULL AND p.activity_reference IS NULL;

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
   and m.kind='student' and private.role_is_available(p_game_id,auth.uid())
   and lower(m.role_title) ~ 'банк[а-я]* россии|центральн.{0,20}банк'
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
 v_context:=public.get_fiscal_context(p_game_id);
 select to_jsonb(p) into old_row from game_fiscal_policy p
  where game_id=p_game_id for update;
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
end$function$;

revoke all on function public.set_fiscal_policy(uuid,jsonb,text) from public,anon;
grant execute on function public.set_fiscal_policy(uuid,jsonb,text) to authenticated;
