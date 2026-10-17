-- ГОС.ID: региональные новости на основании официального результата, без служебных англицизмов.
-- Не меняем порядок распределения, права ролей, расчёт мандатов или итоги.
-- Сначала читаем сохранённую партийную разбивку и только потом публикуем сообщение.
CREATE OR REPLACE FUNCTION private.gos_regional_allocation_report(p_rule_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,private,pg_temp
AS $regional$
DECLARE
 r public.regional_election_rules%ROWTYPE;
 v_total integer;
 v_groups text;
 v_mode text;
 v_document uuid;
 v_report text;
BEGIN
 SELECT * INTO r FROM public.regional_election_rules WHERE id=p_rule_id AND status='allocated';
 IF r.id IS NULL THEN RETURN NULL; END IF;
 SELECT coalesce(sum(a.regions),0)::integer,
        string_agg(format('«%s» — %s',p.name,a.regions),'; ' ORDER BY a.regions DESC,p.name)
   INTO v_total,v_groups
 FROM public.regional_allocations a
 JOIN public.game_parties p ON p.id=a.party_id AND p.game_id=a.game_id
 WHERE a.rule_id=r.id AND a.game_id=r.game_id AND a.regions>0;
 IF v_total<>89 OR v_groups IS NULL THEN RETURN NULL; END IF;
 v_mode:=CASE r.method
  WHEN 'random' THEN 'случайной жеребьёвки'
  WHEN 'proportional' THEN 'пропорционального распределения'
  WHEN 'agreement' THEN 'согласованного распределения между партиями'
  ELSE 'утверждённой процедуры распределения' END;
 v_report:='По итогам рассмотрения вопроса о региональном представительстве Координационный Совет Российской Федерации определил порядок распределения 89 региональных позиций между политическими партиями. ' ||
   'Применён порядок '||v_mode||'. Распределение завершено, результаты закреплены в официальном реестре.' ||
   E'\n\n' || 'Поимённые результаты распределения по партиям: ' || v_groups || '. ' ||
   'Всего распределено '||v_total||' региональных позиций.';
 IF r.vote_id IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.game_votes v
   WHERE v.id=r.vote_id AND v.game_id=r.game_id AND v.status='closed'
 ) THEN
   v_report:=v_report||E'\n\n'||'[Открыть протокол голосования](gos:votes?id='||r.vote_id::text||')';
   SELECT v.formal_document_id INTO v_document FROM public.game_votes v
   WHERE v.id=r.vote_id AND v.game_id=r.game_id AND v.status='closed';
   IF v_document IS NOT NULL AND EXISTS(
     SELECT 1 FROM public.formal_documents d WHERE d.id=v_document AND d.game_id=r.game_id
     AND d.status_code IN ('adopted','signed','published')
   ) THEN
     v_report:=v_report||E'\n'||'[Открыть принятый документ](gos:documents?id='||v_document::text||')';
   END IF;
 END IF;
 RETURN v_report||E'\n\n'||'[Материалы третьего этапа](gos:stages?stage=3)';
END;
$regional$;
REVOKE ALL ON FUNCTION private.gos_regional_allocation_report(uuid) FROM PUBLIC,anon,authenticated;

-- Изменяем только текст сообщения, а не существующий порядок или результат голосования.
CREATE OR REPLACE FUNCTION public.execute_regional_allocation(p_rule_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare r public.regional_election_rules%rowtype;v_uid uuid:=(select auth.uid());i integer;v_party uuid;v_total integer;v_result jsonb;
begin
 select * into r from public.regional_election_rules where id=p_rule_id for update;
 if r.id is null then raise exception 'Regional rule not found'; end if;
 if not private.is_game_teacher(r.game_id) then raise exception 'Teacher access required to finalize regional election results'; end if;
 if r.status<>'adopted' then raise exception 'Regional method must be adopted first'; end if;

 if r.method='random' then
  delete from public.regional_allocations where rule_id=r.id;
  for i in 1..89 loop
   select id into v_party from public.game_parties where game_id=r.game_id order by random() limit 1;
   if v_party is null then raise exception 'Create parties first'; end if;
   insert into public.regional_allocations(rule_id,game_id,party_id,regions,source)
   values(r.id,r.game_id,v_party,1,'random')
   on conflict(rule_id,party_id) do update set regions=public.regional_allocations.regions+1,updated_at=now();
  end loop;
 elsif r.method='proportional' then
  if (select coalesce(sum(mandates),0) from public.game_parties where game_id=r.game_id)<=0 then raise exception 'Parliamentary mandates are required'; end if;
  delete from public.regional_allocations where rule_id=r.id;
  with raw as (
   select id,mandates,mandates::numeric/(sum(mandates) over())*89 exact,
     floor(mandates::numeric/(sum(mandates) over())*89)::integer base
   from public.game_parties where game_id=r.game_id and mandates>0
  ),ranked as (
   select *,89-sum(base) over() extra,row_number() over(order by exact-base desc,id) rn from raw
  )
  insert into public.regional_allocations(rule_id,game_id,party_id,regions,source)
  select r.id,r.game_id,id,base+case when rn<=extra then 1 else 0 end,'proportional' from ranked;
 else
  select coalesce(sum(regions),0)::integer into v_total from public.regional_allocations where rule_id=r.id;
  if v_total<>89 then raise exception 'Agreement must distribute exactly 89 regions; current total: %',v_total; end if;
 end if;

 update public.game_parties p set regional_seats_awarded=coalesce(a.regions,0),regions=coalesce(a.regions,0)
 from (select party_id,regions from public.regional_allocations where rule_id=r.id) a
 where p.id=a.party_id and p.game_id=r.game_id;
 update public.game_parties set regional_seats_awarded=0,regions=0 where game_id=r.game_id and id not in(select party_id from public.regional_allocations where rule_id=r.id);
 update public.regional_election_rules set status='allocated',updated_at=now() where id=r.id;

 select coalesce(jsonb_agg(jsonb_build_object('party_id',a.party_id,'party_name',p.name,'regions',a.regions) order by a.regions desc,p.name),'[]'::jsonb)
 into v_result from public.regional_allocations a join public.game_parties p on p.id=a.party_id where a.rule_id=r.id;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(r.game_id,3,'Региональные выборы','notice','Итоги региональных выборов: распределены 89 представительств',
   coalesce(private.gos_regional_allocation_report(r.id),'Результаты распределения отражены в реестре политических партий.'),v_uid);
 return v_result;
end;$function$;


-- Исправляем только одну форму автоматически созданных старых сообщений при
-- однозначном совпадении времени события и утверждённого распределения.
WITH verified AS (
 SELECT p.id AS post_id,r.id AS rule_id
 FROM public.political_posts p
 JOIN public.game_events e ON p.source_key='event:'||e.id::text
   AND p.game_id=e.game_id
 JOIN public.regional_election_rules r ON r.game_id=e.game_id
   AND r.status='allocated' AND r.updated_at=e.published_at
 WHERE p.context->>'source_table'='game_events'
   AND e.category='Региональные выборы'
   AND p.title='Распределены 89 законодательных органов субъектов РФ'
   AND p.body LIKE 'Метод: %. Итог сохранён в партийных показателях.'
)
UPDATE public.political_posts p SET
 title='Итоги региональных выборов: распределены 89 представительств',
 body=private.gos_regional_allocation_report(verified.rule_id),
 actor_key='teacher',actor_label='ГОС.ID',
 context=p.context||jsonb_build_object('stage_no',3,'stage_title','Выборы в субъектах РФ','editorial_verified',true),
 updated_at=now()
FROM verified
WHERE p.id=verified.post_id
 AND private.gos_regional_allocation_report(verified.rule_id) IS NOT NULL;
