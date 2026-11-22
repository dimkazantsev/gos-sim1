-- Ensure every non-teacher key-rate change has one adopted Bank of Russia act.
CREATE OR REPLACE FUNCTION public.set_fiscal_policy(p_game_id uuid, p_values jsonb, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare old_row jsonb;new_row jsonb;is_teacher boolean;k text;allowed boolean;
 v_context jsonb;v_reference numeric;v_old_fnb budget_simulator_state%rowtype;v_total numeric;v_liquid numeric;v_share numeric;v_fx_old numeric;
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
 -- Students may not change the rate without its adopted, immutable Bank of Russia decision.
 -- Teachers retain their separately authorized administrative policy editor.
 if not is_teacher and p_values ? 'key_rate' and not exists(
  select 1 from public.formal_documents d
  where d.id=nullif(current_setting('app.gos_bank_rate_active_decision_id',true),'')::uuid
    and d.game_id=p_game_id and d.author_id=auth.uid() and d.doc_type='bank_rate_decision'
    and d.status_code='adopted' and d.metadata->>'bank_rate_decision'='true'
    and (d.metadata->>'new_rate')::numeric=(p_values->>'key_rate')::numeric
 ) then raise exception 'Измените ключевую ставку через её карточку: решение Банка России будет зарегистрировано автоматически.' using errcode='42501';end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' or p_values='{}'::jsonb
    or p_reason is null or length(trim(p_reason))<8 then
   raise exception 'Укажите параметры и содержательное основание решения.';
 end if;
 for k in select jsonb_object_keys(p_values) loop
   if k not in ('key_rate','fx_rate','oil_price','cutoff_price','inflation','federal_expenditure','municipal_expenditure','activity_override','fnb_total','fnb_liquid','fnb_fx_share') then
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
 if p_values ? 'key_rate' or p_values ? 'inflation' then
  perform private.settle_monetary_inflation(p_game_id);
 end if;
 if p_values ? 'fnb_total' or p_values ? 'fnb_liquid' or p_values ? 'fnb_fx_share' then
  perform pg_advisory_xact_lock(hashtextextended('budget:'||p_game_id::text,0));
  perform private.ensure_budget_simulator(p_game_id);
 end if;
 select to_jsonb(p)||jsonb_build_object('fnb_total',s.fnb_total,'fnb_liquid',s.reserve_remaining,
   'fnb_fx_share',case when s.reserve_remaining>0 then round(s.fnb_fx_units*p.fx_rate/s.reserve_remaining*100,4) else 0 end)
 into old_row from game_fiscal_policy p left join budget_simulator_state s on s.game_id=p.game_id
 where p.game_id=p_game_id for update of p;
 -- Preserve the original initialization behavior for a first direct write.
 if old_row is null then
   v_context:=public.get_fiscal_context(p_game_id);
   select to_jsonb(p)||jsonb_build_object('fnb_total',s.fnb_total,'fnb_liquid',s.reserve_remaining,
  'fnb_fx_share',case when s.reserve_remaining>0 then round(s.fnb_fx_units*p.fx_rate/s.reserve_remaining*100,4) else 0 end)
   into old_row from game_fiscal_policy p left join budget_simulator_state s on s.game_id=p.game_id
   where p.game_id=p_game_id for update of p;
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
 if p_values ? 'key_rate' or p_values ? 'inflation' then
  perform private.settle_monetary_inflation(p_game_id);
 end if;
 if p_values ? 'fnb_total' or p_values ? 'fnb_liquid' or p_values ? 'fnb_fx_share' then
  select * into v_old_fnb from budget_simulator_state where game_id=p_game_id for update;
  v_fx_old:=greatest(.01,(old_row->>'fx_rate')::numeric);
  v_total:=coalesce((p_values->>'fnb_total')::numeric,v_old_fnb.fnb_total);
  v_liquid:=coalesce((p_values->>'fnb_liquid')::numeric,
   case when p_values ? 'fnb_total' and v_old_fnb.fnb_total>0 then round(v_old_fnb.reserve_remaining*v_total/v_old_fnb.fnb_total,8)
    else v_old_fnb.reserve_remaining end);
  v_share:=coalesce((p_values->>'fnb_fx_share')::numeric,
    case when v_old_fnb.reserve_remaining>0 then round(v_old_fnb.fnb_fx_units*v_fx_old/v_old_fnb.reserve_remaining*100,4) else 0 end);
  if v_total<0 or v_total>50000000 or v_liquid<0 or v_liquid>v_total or v_share<0 or v_share>100
    or v_total::text in ('NaN','Infinity','-Infinity') or v_liquid::text in ('NaN','Infinity','-Infinity')
  then raise exception 'ФНБ: общий объём до 50 трлн рублей, доступная сумма не выше общей, валютная доля от 0 до 100.';end if;
  update budget_simulator_state set fnb_total=v_total,reserve_remaining=v_liquid,
   fnb_fx_units=round(v_liquid*v_share/100/v_fx_old,8),version=version+1,updated_at=now()
   where game_id=p_game_id;
  new_row:=new_row||jsonb_build_object('fnb_total',v_total,'fnb_liquid',v_liquid,'fnb_fx_share',v_share);
 end if;
 insert into fiscal_change_ledger(game_id,source_type,source_id,note,before_values,after_values,actor_id)
 values(p_game_id,'macro',gen_random_uuid()::text,
   case when is_teacher then 'Параметры сценария: ' else 'Решение Банка России: ' end||trim(p_reason),
   old_row,new_row,auth.uid());
end$function$
;
CREATE OR REPLACE FUNCTION public.adopt_bank_rate_decision(p_game_id uuid, p_new_rate numeric, p_expected_rate numeric, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE v_uid uuid:=auth.uid();v_doc uuid;v_existing uuid;v_old numeric;v_no text;v_steps jsonb;
 v_stage integer;v_title text:='Решение Совета директоров Банка России о ключевой ставке';
 v_body text;v_meta jsonb;
BEGIN
 IF v_uid IS NULL OR NOT private.can_issue_bank_rate_decision(p_game_id,v_uid) THEN
  RAISE EXCEPTION 'Изменять ключевую ставку и принимать решение Банка России вправе только действующий Председатель Банка России' USING errcode='42501';END IF;
 IF p_request_id IS NULL OR p_new_rate IS NULL OR p_expected_rate IS NULL
   OR p_new_rate<0 OR p_new_rate>100 OR p_new_rate<>round(p_new_rate,2)
   OR p_reason IS NULL OR length(btrim(p_reason))<8 OR length(p_reason)>1500
 THEN RAISE EXCEPTION 'Укажите ставку от 0 до 100 процентов (до двух знаков после запятой) и основание не короче восьми символов' USING errcode='22023';END IF;
 PERFORM private.settle_monetary_inflation(p_game_id);
 SELECT p.key_rate INTO v_old FROM public.game_fiscal_policy p WHERE p.game_id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Финансовые параметры игры не найдены';END IF;
 SELECT d.id INTO v_existing FROM public.formal_documents d
  WHERE d.game_id=p_game_id AND d.doc_type='bank_rate_decision'
   AND d.author_id=v_uid AND d.metadata->>'bank_rate_request_id'=p_request_id::text LIMIT 1;
 IF v_existing IS NOT NULL THEN
  RETURN jsonb_build_object('document_id',v_existing,'rate',(SELECT (metadata->>'new_rate')::numeric FROM public.formal_documents WHERE id=v_existing),'already_adopted',true);END IF;
 IF v_old IS DISTINCT FROM p_expected_rate THEN RAISE EXCEPTION 'Ключевая ставка уже изменилась. Обновите показатели и подтвердите новое значение.' USING errcode='40001';END IF;
 IF v_old=p_new_rate THEN RAISE EXCEPTION 'Указанное значение совпадает с действующей ключевой ставкой.' USING errcode='22023';END IF;
 SELECT COALESCE((SELECT st.stage_no FROM public.game_stages st
  WHERE st.game_id=p_game_id AND st.status='open' ORDER BY st.stage_no DESC LIMIT 1),1) INTO v_stage;
 v_doc:=gen_random_uuid();v_no:='ГОС.ID-ЦБ-'||lpad(nextval('public.formal_registry_seq')::text,4,'0');
 v_steps:=private.formal_workflow('bank_rate');
 v_body:='СОВЕТ ДИРЕКТОРОВ БАНКА РОССИИ'||E'\n\n'||'РЕШИЛ:'||E'\n'||
 '1. Установить ключевую ставку Банка России на уровне '||replace(p_new_rate::text,'.',',')||' процента годовых.'||E'\n'||
 '2. Изменить ранее действовавшую ставку '||replace(v_old::text,'.',',')||' процента годовых. Решение применяется в экономической модели ГОС.ID с момента принятия.'||E'\n'||
 '3. Последствия денежно-кредитной политики рассчитываются по утверждённым правилам ГОС.ID.'||E'\n\n'||
 'Основание решения: '||btrim(p_reason)||E'\n\n'||'Председатель Банка России (подпись в реестре НПА).';
 v_meta:=jsonb_build_object('registry_independent',true,'bank_rate_decision',true,
  'bank_rate_request_id',p_request_id::text,'old_rate',v_old,'new_rate',p_new_rate,
  'issuer_name','Банк России','acting_user_id',v_uid,'place','Москва','authority','Совет директоров Банка России');
 PERFORM set_config('app.gos_registry_independent_id',v_doc::text,true);
 PERFORM set_config('app.gos_bank_rate_create_id',v_doc::text,true);
 INSERT INTO public.formal_documents
 (id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,body_text,
  workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
 VALUES(v_doc,p_game_id,v_stage,v_no,v_title,'bank_rate_decision','central_bank','Банк России',v_uid,v_body,
 'bank_rate',v_steps,0,'adopted','Принято Советом директоров Банка России','central_bank',v_meta);
 PERFORM set_config('app.gos_bank_rate_create_id','',true);
 PERFORM set_config('app.gos_registry_independent_id','',true);
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 VALUES(v_doc,p_game_id,v_uid,'Принято решение Совета директоров Банка России','adopted','central_bank',
 'Ставка: '||v_old||'% → '||p_new_rate||'%. Подписание Председателем Банка России ожидается.');
 PERFORM set_config('app.gos_bank_rate_active_decision_id',v_doc::text,true);
 PERFORM public.set_fiscal_policy(p_game_id,jsonb_build_object('key_rate',p_new_rate),
  'Решение Совета директоров Банка России № '||v_no||': '||btrim(p_reason));
 PERFORM set_config('app.gos_bank_rate_active_decision_id','',true);
 RETURN jsonb_build_object('document_id',v_doc,'rate',p_new_rate,'registry_no',v_no,'status','adopted');
END $function$
;