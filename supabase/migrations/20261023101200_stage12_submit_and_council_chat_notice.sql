-- Этап 12. Автор может внести пакет без предварительного выбора комитета.
-- Комитет обязателен до направления зарегистрированного пакета на рассмотрение.
CREATE OR REPLACE FUNCTION private.bill_dossier_readiness_json(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare d public.formal_documents%rowtype;p public.bill_submission_profiles%rowtype;c public.bill_committee_conclusions%rowtype;
 issues jsonb:='[]'::jsonb;review_issues jsonb:='[]'::jsonb;v_kind text;required text[];
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or d.workflow_key<>'bill' then return jsonb_build_object('ready',false,'issues',jsonb_build_array('Законопроект не найден')); end if;
 select * into p from public.bill_submission_profiles where document_id=d.id;
 select * into c from public.bill_committee_conclusions where document_id=d.id;

 if p.document_id is null then
  issues:=issues||jsonb_build_array('Не заполнена карточка внесения законопроекта');
 else
  if p.committee_key is null then review_issues:=review_issues||jsonb_build_array('Профильный комитет не назначен руководством Государственной Думы'); end if;
  if p.representative_user_id is null and d.subject_key in ('government','sf','region','ks','vs')
  then issues:=issues||jsonb_build_array('Для коллегиального субъекта не указан представитель в Государственной Думе'); end if;
 end if;

 if nullif(trim(coalesce(d.body_text,'')),'') is null and d.source_file_path is null
 then issues:=issues||jsonb_build_array('Отсутствует текст законопроекта'); end if;

 required:=array['explanatory_note','affected_acts'];
 if coalesce(p.requires_financial_justification,false) then required:=array_append(required,'financial_economic'); end if;
 if coalesce(p.requires_government_opinion,false) then required:=array_append(required,'government_opinion'); end if;
 if d.subject_key in ('government','sf','region','ks','vs') then required:=array_append(required,'collegial_decision'); end if;

 foreach v_kind in array required loop
  if not exists(select 1 from public.bill_package_files where document_id=d.id and file_kind=v_kind)
  then issues:=issues||jsonb_build_array('Не приложен обязательный материал: '||v_kind); end if;
  if exists(select 1 from public.bill_package_files where document_id=d.id and file_kind=v_kind and status='revision')
  then review_issues:=review_issues||jsonb_build_array('Материал возвращён на доработку: '||v_kind); end if;
 end loop;

 if c.document_id is null or not c.finalized
 then review_issues:=review_issues||jsonb_build_array('Профильный комитет не завершил мотивированное заключение');
 elsif c.recommendation<>'proceed'
 then review_issues:=review_issues||jsonb_build_array('Заключение профильного комитета не рекомендует дальнейшее движение');
 end if;

 return jsonb_build_object(
  'submission_ready',jsonb_array_length(issues)=0,
  'committee_ready',jsonb_array_length(issues)=0 and jsonb_array_length(review_issues)=0,
  'issues',issues,'review_issues',review_issues,
  'required_files',to_jsonb(required),
  'committee_key',p.committee_key,
  'requires_financial_justification',coalesce(p.requires_financial_justification,false),
  'requires_government_opinion',coalesce(p.requires_government_opinion,false),
  'committee_recommendation',c.recommendation,
  'committee_finalized',coalesce(c.finalized,false)
 );
end;$function$
;

CREATE OR REPLACE FUNCTION private.stage12_committee_assignment_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $guard$
BEGIN
 IF NEW.stage_no=12 AND NEW.workflow_key='bill'
  AND OLD.status_code='registered' AND NEW.status_code='committee'
  AND NOT EXISTS (
   SELECT 1 FROM public.bill_submission_profiles p
   JOIN public.institution_units u ON u.game_id=NEW.game_id AND u.unit_kind='committee' AND u.unit_key=p.committee_key
   WHERE p.document_id=NEW.id
  )
 THEN RAISE EXCEPTION 'Сначала назначьте профильный комитет Государственной Думы' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;$guard$;
DROP TRIGGER IF EXISTS stage12_committee_assignment_guard ON public.formal_documents;
CREATE TRIGGER stage12_committee_assignment_guard BEFORE UPDATE OF status_code ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.stage12_committee_assignment_guard();
REVOKE ALL ON FUNCTION private.stage12_committee_assignment_guard() FROM PUBLIC,anon,authenticated;

-- Только закрытый чат Совета ГД получает сведения о поступлении и возврате.
CREATE OR REPLACE FUNCTION private.stage12_council_bill_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private','pg_temp'
AS $notice$
DECLARE v_channel uuid;v_text text;
BEGIN
 IF NEW.stage_no<>12 OR NEW.workflow_key<>'bill'
  OR NEW.status_code IS NOT DISTINCT FROM OLD.status_code
  OR NEW.status_code NOT IN ('registered','council','revision') THEN RETURN NEW; END IF;
 SELECT c.id INTO v_channel FROM public.chat_channels c
  WHERE c.game_id=NEW.game_id AND c.kind='private' AND c.name='Совет ГД' LIMIT 1;
 IF v_channel IS NULL THEN RETURN NEW; END IF;
 v_text:=CASE NEW.status_code
  WHEN 'registered' THEN 'В Государственную Думу внесён законопроект '||NEW.registry_no||' — '||NEW.title||'. Требуется направление в профильный комитет.'
  WHEN 'council' THEN 'Заключение профильного комитета по законопроекту '||NEW.registry_no||' поступило в Совет Государственной Думы. '||NEW.title
  ELSE 'Законопроект '||NEW.registry_no||' возвращён автору на доработку. '||NEW.title END;
 INSERT INTO public.chat_messages(game_id,channel_id,author_id,kind,text)
 VALUES(NEW.game_id,v_channel,NULL,'system',v_text);
 RETURN NEW;
END;$notice$;
DROP TRIGGER IF EXISTS stage12_council_bill_notice ON public.formal_documents;
CREATE TRIGGER stage12_council_bill_notice AFTER UPDATE OF status_code ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.stage12_council_bill_notice();
REVOKE ALL ON FUNCTION private.stage12_council_bill_notice() FROM PUBLIC,anon,authenticated;
