CREATE OR REPLACE FUNCTION public.open_budget_law_amendment_vote(p_document_id uuid, p_amendment_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d formal_documents%rowtype;a budget_law_amendments%rowtype;gid uuid;pack_id uuid;v_vote_id uuid;c jsonb;n jsonb;j jsonb;body text;vote_body text;vote_title text;count_selected integer;
begin
 select game_id into gid from formal_documents where id=p_document_id;
 perform private.lock_budget_actor(gid);perform pg_advisory_xact_lock(hashtextextended('budget:'||gid::text,0));
 select * into d from formal_documents where id=p_document_id for update;
 if d.id is null or not private.can_manage_budget_law_amendments(d.id) then raise exception 'Пакет выбирает Комитет по бюджету, председатель ГД или преподаватель.';end if;
 if d.status_code not in ('amendments','reading2') then raise exception 'Пакет рассматривается только при подготовке и проведении II чтения.';end if;
 if exists(select 1 from game_votes where formal_document_id=d.id and status='open') or exists(select 1 from budget_law_amendment_packs where document_id=d.id and status in ('opening','voting')) then raise exception 'Сначала завершите открытое голосование по проекту или пакету.';end if;
 if p_amendment_ids is null or cardinality(p_amendment_ids) not between 1 and 100 then raise exception 'Выберите от 1 до 100 поправок.';end if;
 select count(*) into count_selected from budget_law_amendments where id=any(p_amendment_ids) and document_id=d.id and game_id=d.game_id and status='submitted';
 if count_selected<>cardinality(p_amendment_ids) then raise exception 'Пакет содержит повторную, чужую или уже рассмотренную поправку.';end if;
 perform private.ensure_budget_law_first_reading(d.id);
 c:=d.metadata->'budget_snapshot';n:=d.metadata->'budget_draft';
 vote_body:='Бюджет '||d.registry_no||': '||d.title||E'\nВыбранные поправки ко II чтению. При принятии изменяется только распределение свободных базовых расходов; голосование не завершает чтение.\n';
 for a in select * from budget_law_amendments where id=any(p_amendment_ids) order by created_at,id for update loop
  if a.source_revision is distinct from coalesce((d.metadata->>'revision')::integer,1) or a.source_calculation is distinct from d.metadata->'budget_snapshot' or a.source_body_text is distinct from coalesce(d.body_text,'') then raise exception 'Исходная редакция изменилась. Отзовите устаревшую поправку или оформите решение комитета, затем внесите её заново.';end if;
  j:=private.preview_budget_law_reallocation(c,n,a.from_section,a.to_section,a.amount);c:=j->'calculation';n:=j->'draft';
  vote_body:=vote_body||E'\nПоправка '||a.id||': '||a.title||E'\nИз раздела '||a.from_section||' в раздел '||a.to_section||': '||(a.amount*1000000)::text||E' рублей.\nОбоснование: '||a.rationale||case when a.competence_note<>'' then E'\nВопросы ведения суда: '||a.competence_note else '' end||E'\n';
 end loop;
 if (c-'expense_lines') is distinct from ((d.metadata->'budget_snapshot')-'expense_lines') or (n-'base_reallocations') is distinct from ((d.metadata->'budget_draft')-'base_reallocations') then raise exception 'Поправки не могут изменить общие характеристики и целевые обязательства бюджета.';end if;
 body:=private.budget_law_expense_body(coalesce(d.body_text,''),c);
 body:=body||E'\n\nПРИНЯТЫЕ ПОПРАВКИ КО II ЧТЕНИЮ\n'||vote_body;
 if length(body)>120000 then raise exception 'Итоговый текст превышает 120 000 знаков. Уменьшите пакет или пояснения.';end if;
 vote_title:='Бюджет: выбранные поправки ко II чтению · '||d.registry_no;
 insert into budget_law_amendment_packs(game_id,document_id,amendment_ids,created_by,vote_title,vote_body,source_status,source_revision,source_calculation,source_draft,source_body_text,result_calculation,result_draft,result_body_text)
 values(d.game_id,d.id,p_amendment_ids,auth.uid(),vote_title,vote_body,d.status_code,coalesce((d.metadata->>'revision')::integer,1),d.metadata->'budget_snapshot',d.metadata->'budget_draft',coalesce(d.body_text,''),c,n,body) returning id into pack_id;
 perform set_config('app.vote_group','',true);
 insert into game_votes(game_id,stage_no,title,body,voting_mode,created_by,formal_document_id,formal_step_code,institution_key,procedure_key,quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(d.game_id,(select current_round from games where id=d.game_id),vote_title,vote_body,'mandate',auth.uid(),null,null,'gd','budget_second_reading_amendment','fraction',.5,'eligible_majority',.5,true,false,'none','none') returning id into v_vote_id;
 update budget_law_amendment_packs set status='voting',vote_id=v_vote_id where id=pack_id;
 update budget_law_amendments set status='voting',vote_id=v_vote_id,updated_at=now() where id=any(p_amendment_ids);
 insert into formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,auth.uid(),'Открыто голосование по выбранным бюджетным поправкам',d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,'Пакет '||pack_id||' · голосование '||v_vote_id);
 return v_vote_id;
end;$function$;
