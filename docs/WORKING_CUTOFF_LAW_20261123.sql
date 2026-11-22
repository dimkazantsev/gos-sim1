
-- ГОС.ID: prepare a single bill, Government approval, three Duma readings,
-- Senate review (or teacher-recorded reduction), Presidential signature, one fiscal change.
CREATE TABLE IF NOT EXISTS private.cutoff_price_law_proposals (
 document_id uuid PRIMARY KEY REFERENCES public.formal_documents(id) ON DELETE CASCADE,
 game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
 author_id uuid NOT NULL,
 request_id uuid NOT NULL,
 old_price numeric NOT NULL CHECK(old_price BETWEEN 0 AND 100000),
 new_price numeric NOT NULL CHECK(new_price BETWEEN 0 AND 100000),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 1500),
 sf_confirmed_by uuid,
 sf_confirmed_at timestamptz,
 applied_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(game_id,author_id,request_id)
);
ALTER TABLE private.cutoff_price_law_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.cutoff_price_law_proposals FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.can_propose_cutoff_price(p_game uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $f$
 SELECT p_user IS NOT NULL AND p_user=auth.uid()
 AND EXISTS(SELECT 1 FROM public.game_members m
 JOIN public.game_office_assignments a ON a.game_id=m.game_id AND a.user_id=m.user_id
 WHERE m.game_id=p_game AND m.user_id=p_user AND m.kind='student'
  AND m.roster_archived_at IS NULL AND a.status='active'
  AND a.role_title='Министерство по экономической политике')
 AND private.role_is_available(p_game,p_user)
$f$;
REVOKE ALL ON FUNCTION private.can_propose_cutoff_price(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.guard_cutoff_price_bill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.metadata->>'cutoff_price_proposal'='true'
   AND current_setting('app.gos_cutoff_bill_create_id',true) IS DISTINCT FROM NEW.id::text
  THEN RAISE EXCEPTION 'Законопроект о цене отсечения создаётся только уполномоченным министром.' USING errcode='42501';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND (OLD.metadata->>'cutoff_price_proposal'='true'
   OR NEW.metadata->>'cutoff_price_proposal'='true') THEN
  IF OLD.metadata->>'cutoff_price_proposal' IS DISTINCT FROM NEW.metadata->>'cutoff_price_proposal'
   OR OLD.metadata->>'document_kind' IS DISTINCT FROM NEW.metadata->>'document_kind'
   OR OLD.metadata->>'registry_independent' IS DISTINCT FROM NEW.metadata->>'registry_independent'
   OR OLD.metadata->>'proposal_old_price' IS DISTINCT FROM NEW.metadata->>'proposal_old_price'
   OR OLD.metadata->>'proposal_new_price' IS DISTINCT FROM NEW.metadata->>'proposal_new_price'
   OR OLD.game_id IS DISTINCT FROM NEW.game_id
   OR OLD.author_id IS DISTINCT FROM NEW.author_id
   OR OLD.doc_type IS DISTINCT FROM NEW.doc_type
   OR OLD.subject_key IS DISTINCT FROM NEW.subject_key
   OR OLD.workflow_key IS DISTINCT FROM NEW.workflow_key
   OR OLD.workflow_steps IS DISTINCT FROM NEW.workflow_steps
   OR OLD.title IS DISTINCT FROM NEW.title OR OLD.body_text IS DISTINCT FROM NEW.body_text
  THEN RAISE EXCEPTION 'Нельзя подменять цену, текст или правовое основание законопроекта.' USING errcode='42501';END IF;
 END IF;
 RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS guard_cutoff_price_bill ON public.formal_documents;
CREATE TRIGGER guard_cutoff_price_bill BEFORE INSERT OR UPDATE ON public.formal_documents
FOR EACH ROW EXECUTE FUNCTION private.guard_cutoff_price_bill();

CREATE OR REPLACE FUNCTION public.propose_cutoff_price_bill(
p_game_id uuid,p_new_price numeric,p_expected_price numeric,p_reason text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE v_uid uuid:=auth.uid();v_old numeric;v_doc uuid;v_existing uuid;
 v_steps jsonb;v_stage integer;v_no text;v_body text;
BEGIN
 IF NOT private.can_propose_cutoff_price(p_game_id,v_uid) THEN
  RAISE EXCEPTION 'Инициативу вправе подготовить только действующий руководитель Министерства по экономической политике.' USING errcode='42501';
 END IF;
 IF p_request_id IS NULL OR p_new_price IS NULL OR p_expected_price IS NULL
  OR p_new_price<0 OR p_new_price>100000 OR p_new_price<>round(p_new_price,2)
  OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 8 AND 1500 THEN
  RAISE EXCEPTION 'Цена от 0 до 100000, обоснование от 8 до 1500 символов.' USING errcode='22023';END IF;
 SELECT f.cutoff_price INTO v_old FROM public.game_fiscal_policy f WHERE f.game_id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Экономические параметры игры не найдены.';END IF;
 SELECT x.document_id INTO v_existing FROM private.cutoff_price_law_proposals x
 WHERE x.game_id=p_game_id AND x.author_id=v_uid AND x.request_id=p_request_id;
 IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('document_id',v_existing,'already_created',true);END IF;
 IF v_old IS DISTINCT FROM p_expected_price THEN
  RAISE EXCEPTION 'Цена отсечения изменилась. Обновите показатели.' USING errcode='40001';END IF;
 IF v_old=p_new_price THEN RAISE EXCEPTION 'Значение совпадает с действующим.' USING errcode='22023';END IF;
 SELECT COALESCE((SELECT st.stage_no FROM public.game_stages st
  WHERE st.game_id=p_game_id AND st.status='open' ORDER BY stage_no DESC LIMIT 1),
  (SELECT max(stage_no) FROM public.game_stages WHERE game_id=p_game_id),13) INTO v_stage;
 v_doc:=gen_random_uuid();
 v_no:='ГОС.ID-ЗП-ФЗ-'||lpad(nextval('public.formal_registry_seq')::text,4,'0');
 v_steps:=jsonb_insert(private.formal_workflow('bill'),'{1}',jsonb_build_object(
   'code','government','label','Одобрение Правительством Российской Федерации',
   'owner','government','action','Одобрить внесение в Государственную Думу'),false);
 v_body:='Проект федерального закона'||E'\n'
  ||'«О внесении изменения в статью 96.6 Бюджетного кодекса Российской Федерации»'
  ||E'\n\n'||'Статья 1'||E'\n'
  ||'Абзац второй пункта 4 статьи 96.6 Бюджетного кодекса Российской Федерации изложить в следующей редакции:'
  ||E'\n'||'«'||replace(p_new_price::text,'.',',')
  ||' долларов США за один баррель в 2026 году;».'
  ||E'\n\n'||'Статья 2'||E'\n'
  ||'Настоящий Федеральный закон вступает в силу со дня его официального опубликования.'
  ||E'\n\n'||'Обоснование Министерства по экономической политике: '||btrim(p_reason);
 PERFORM set_config('app.gos_registry_independent_id',v_doc::text,true);
 PERFORM set_config('app.gos_cutoff_bill_create_id',v_doc::text,true);
 INSERT INTO public.formal_documents(
   id,game_id,stage_no,registry_no,title,doc_type,subject_key,subject_label,author_id,
   body_text,workflow_key,workflow_steps,current_step,status_code,status_label,current_owner_key,metadata)
 VALUES(v_doc,p_game_id,v_stage,v_no,'Проект ФЗ об изменении базовой цены нефти (цены отсечения)',
  'fz_bill','government','Правительство Российской Федерации',v_uid,
  v_body,'bill',v_steps,0,'draft','Подготовка Министерством по экономической политике',
  'author',jsonb_build_object('registry_independent',true,'cutoff_price_proposal',true,
    'document_kind','cutoff_price_bill','proposal_old_price',v_old,'proposal_new_price',p_new_price,
    'issuer_name','Правительство Российской Федерации','acting_user_id',v_uid,
    'acting_office_title','Министерство по экономической политике',
    'legal_basis','Пункт 4 статьи 96.6 БК РФ; статьи 104–107 Конституции РФ'));
 INSERT INTO private.cutoff_price_law_proposals(
  document_id,game_id,author_id,request_id,old_price,new_price,reason)
 VALUES(v_doc,p_game_id,v_uid,p_request_id,v_old,p_new_price,btrim(p_reason));
 PERFORM set_config('app.gos_cutoff_bill_create_id','',true);
 PERFORM set_config('app.gos_registry_independent_id','',true);
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,to_status,to_owner,note)
 VALUES(v_doc,p_game_id,v_uid,'Министерство подготовило проект изменения цены отсечения',
  'draft','author','Предложено '||p_new_price||' долл./барр. Значение не изменено до вступления ФЗ в силу.');
 RETURN jsonb_build_object('document_id',v_doc,'new_price',p_new_price,'status','draft');
END $f$;
REVOKE ALL ON FUNCTION public.propose_cutoff_price_bill(uuid,numeric,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propose_cutoff_price_bill(uuid,numeric,numeric,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_cutoff_sf_review(
p_document_id uuid,p_approved boolean,p_note text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE v_uid uuid:=auth.uid();d public.formal_documents%rowtype;v_next integer;v_step jsonb;
BEGIN
 SELECT * INTO d FROM public.formal_documents WHERE id=p_document_id FOR UPDATE;
 IF d.id IS NULL OR v_uid IS NULL OR NOT private.is_game_teacher(d.game_id)
   OR d.workflow_key<>'bill' OR d.doc_type<>'fz_bill'
   OR d.metadata->>'cutoff_price_proposal'<>'true' OR d.status_code<>'sf'
 THEN RAISE EXCEPTION 'Решение Совета Федерации недоступно для подтверждения.' USING errcode='42501';END IF;
 IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 8 AND 1500
 THEN RAISE EXCEPTION 'Обоснование решения Совета Федерации: от 8 до 1500 символов.';END IF;
 IF EXISTS(SELECT 1 FROM public.game_votes v WHERE
  v.formal_document_id=d.id AND v.status='open')
 THEN RAISE EXCEPTION 'Завершите открытое голосование Совета Федерации.';END IF;
 IF p_approved THEN
  v_next:=d.current_step+1;v_step:=d.workflow_steps->v_next;
  IF v_step->>'code'<>'president' THEN RAISE EXCEPTION 'Нарушен маршрут законопроекта.';END IF;
  UPDATE public.formal_documents SET current_step=v_next,status_code='president',
   status_label=v_step->>'label',current_owner_key='president',updated_at=now()
  WHERE id=d.id;
  UPDATE private.cutoff_price_law_proposals SET sf_confirmed_by=v_uid,sf_confirmed_at=now()
  WHERE document_id=d.id;
 ELSE
  UPDATE public.formal_documents SET status_code='rejected',status_label='Отклонён Советом Федерации',
   current_owner_key='system',updated_at=now() WHERE id=d.id;
 END IF;
 INSERT INTO public.formal_document_history(document_id,game_id,actor_id,action,
  from_status,to_status,from_owner,to_owner,note)
 VALUES(d.id,d.game_id,v_uid,CASE WHEN p_approved
  THEN 'Подтверждено одобрение Совета Федерации'
  ELSE 'Подтверждено отклонение Совета Федерации' END,
  'sf',CASE WHEN p_approved THEN 'president' ELSE 'rejected' END,
  'sf',CASE WHEN p_approved THEN 'president' ELSE 'system' END,
  btrim(p_note)||' · Решение подтверждено преподавателем по правилам игровой редукции');
END $f$;
REVOKE ALL ON FUNCTION public.confirm_cutoff_sf_review(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_cutoff_sf_review(uuid,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.apply_cutoff_price_on_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE p private.cutoff_price_law_proposals%rowtype;v_old jsonb;v_new jsonb;
BEGIN
 IF NEW.status_code<>'published' OR OLD.status_code='published'
   OR NEW.doc_type<>'fz_bill' OR NEW.workflow_key<>'bill'
   OR NEW.metadata->>'cutoff_price_proposal'<>'true'
 THEN RETURN NEW;END IF;
 SELECT * INTO p FROM private.cutoff_price_law_proposals WHERE document_id=NEW.id FOR UPDATE;
 IF p.document_id IS NULL OR p.game_id<>NEW.game_id OR p.author_id<>NEW.author_id
   OR p.applied_at IS NOT NULL OR OLD.status_code NOT IN ('president','veto_overridden')
   OR NOT private.matches_formal_owner(NEW.game_id,auth.uid(),'president',NEW.author_id)
   OR NOT EXISTS(SELECT 1 FROM public.game_profiles gp WHERE
     gp.game_id=NEW.game_id AND gp.user_id=auth.uid() AND nullif(gp.signature_path,'') IS NOT NULL)
 THEN RAISE EXCEPTION 'Отсутствует подтверждённая подпись Президента или авторизация закона.' USING errcode='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.game_votes v WHERE
  v.formal_document_id=NEW.id AND v.formal_step_code='government'
  AND v.procedure_key='cutoff_government_submission'
  AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met)
 OR NOT EXISTS(SELECT 1 FROM public.game_votes v WHERE
  v.formal_document_id=NEW.id AND v.formal_step_code='reading3'
  AND v.status='closed' AND v.result_code='passed' AND v.result_quorum_met)
 OR NOT(p.sf_confirmed_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.game_votes v WHERE
  v.formal_document_id=NEW.id AND v.formal_step_code='sf'
  AND v.procedure_key='cutoff_sf_review' AND v.status='closed'
  AND v.result_code='passed' AND v.result_quorum_met))
 THEN RAISE EXCEPTION 'Законопроект не прошёл Правительство, Государственную Думу и Совет Федерации.' USING errcode='42501';END IF;
 SELECT to_jsonb(f.*) INTO v_old FROM public.game_fiscal_policy f
 WHERE f.game_id=NEW.game_id FOR UPDATE;
 IF v_old IS NULL OR (v_old->>'cutoff_price')::numeric IS DISTINCT FROM p.old_price
 THEN RAISE EXCEPTION 'Цена отсечения изменилась. Подготовьте новую инициативу.' USING errcode='40001';END IF;
 UPDATE public.game_fiscal_policy SET cutoff_price=p.new_price,updated_at=now()
 WHERE game_id=NEW.game_id RETURNING to_jsonb(game_fiscal_policy.*) INTO v_new;
 UPDATE private.cutoff_price_law_proposals SET applied_at=now() WHERE document_id=NEW.id;
 INSERT INTO public.fiscal_change_ledger(game_id,source_type,source_id,note,before_values,after_values,actor_id)
 VALUES(NEW.game_id,'macro',NEW.id::text,
  'Цена отсечения изменена опубликованным федеральным законом '||NEW.registry_no,
  v_old,v_new,auth.uid());
 RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS apply_cutoff_law_on_publication ON public.formal_documents;
CREATE TRIGGER apply_cutoff_law_on_publication AFTER UPDATE OF status_code
 ON public.formal_documents FOR EACH ROW EXECUTE FUNCTION private.apply_cutoff_price_on_publication();

CREATE OR REPLACE FUNCTION private.formal_vote_required(p_document formal_documents)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
 select (p_document.workflow_key='bill' AND p_document.metadata->>'cutoff_price_proposal'='true'
 and p_document.status_code IN ('government','sf')) OR p_document.status_code='president_veto'
 or (p_document.workflow_key in ('bill','budget') and p_document.status_code in ('reading1','reading2','reading3'))
 or (p_document.workflow_key in ('government_act','gd_resolution','sf_resolution') and p_document.status_code='agenda')
 or (p_document.workflow_key='municipal_act' and p_document.status_code='meeting')
 or (p_document.doc_type='federal_budget' and p_document.workflow_key='budget'
  and (p_document.status_code='government' or p_document.status_code='revision' and p_document.current_owner_key='government' and p_document.current_step=1));
$function$;
CREATE OR REPLACE FUNCTION private.apply_formal_vote_transition(p_document uuid, p_transition text, p_actor uuid, p_vote uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 d public.formal_documents%rowtype;
 v_step jsonb;
 v_next integer;
 v_action text;
begin
 if p_document is null or p_transition='none' then return; end if;
 select * into d from public.formal_documents where id=p_document for update;
 if d.id is null then return; end if;
 if d.status_code IN ('rejected','superseded','withdrawn','published') THEN RETURN; END IF;
 if not exists(select 1 from public.game_votes where id=p_vote and formal_document_id=d.id and formal_step_code=d.status_code) then
  update public.game_votes set decision_note=concat_ws(' · ',decision_note,'Стадия документа изменилась; результат сохранён без перехода') where id=p_vote;
  return;
 end if;

 if p_transition='advance' then
   if d.workflow_key='bill' and d.status_code='reading3'
   and coalesce(d.metadata->>'cutoff_price_proposal','false')<>'true' then
     v_next:=d.current_step+2;
     v_step:=d.workflow_steps->v_next;
     update public.formal_documents
       set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
           current_owner_key=v_step->>'owner',updated_at=now()
     where id=d.id;
     v_action:='Закон принят ГД; Совет Федерации автоматически одобрил его по правилам игры; направлен Президенту';
   else
     v_next:=d.current_step+1;
     if v_next>=jsonb_array_length(d.workflow_steps) then return; end if;
     v_step:=d.workflow_steps->v_next;
     update public.formal_documents
       set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',
           current_owner_key=v_step->>'owner',updated_at=now()
     where id=d.id;
     v_action:='Документ продвинут по результатам голосования';
   end if;
 elsif p_transition='reject' then
   update public.formal_documents
     set status_code='rejected',status_label='Отклонён голосованием',current_owner_key='system',updated_at=now()
   where id=d.id;
   v_action:='Документ отклонён голосованием';
 elsif p_transition='return_author' then
   v_step:=d.workflow_steps->0;
   update public.formal_documents
     set current_step=0,status_code='revision',status_label='Возвращён автору по результатам голосования',
         current_owner_key='author',updated_at=now()
   where id=d.id;
   v_action:='Документ возвращён автору по результатам голосования';
 elsif p_transition='return_previous' then
   v_next:=greatest(0,d.current_step-1);
   v_step:=d.workflow_steps->v_next;
   update public.formal_documents
     set current_step=v_next,status_code='revision',status_label='Возвращён на предыдущую стадию',
         current_owner_key=v_step->>'owner',updated_at=now()
   where id=d.id;
   v_action:='Документ возвращён на предыдущую стадию по результатам голосования';
 else
   return;
 end if;

 insert into public.formal_document_history(
  document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note
 )
 select d.id,d.game_id,p_actor,v_action,d.status_code,fd.status_code,
        d.current_owner_key,fd.current_owner_key,
        'Голосование '||p_vote::text||coalesce(' · '||nullif(p_note,''),'')
 from public.formal_documents fd where fd.id=d.id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.delete_formal_document(p_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  d public.formal_documents%rowtype;
  v_teacher boolean;
  v_vote record;
  v_deleted boolean := false;
begin
  select * into d
  from public.formal_documents
  where id = p_document_id
  for update;

  if d.id is null or v_uid is null or not private.is_game_member(d.game_id) then
    raise exception 'Документ недоступен';
  end if;

  IF d.metadata->>'cutoff_price_proposal'='true' AND d.status_code='published' THEN
   RAISE EXCEPTION 'Вступивший в силу закон об изменении цены отсечения нельзя удалить.' USING errcode='42501';
  END IF;
  IF d.doc_type='bank_rate_decision' THEN raise exception 'Принятое решение по ключевой ставке нельзя удалить. Измените ставку новым решением Банка России.' using errcode='42501';END IF;
  v_teacher := private.is_game_teacher(d.game_id);

  if not (v_teacher or d.author_id = v_uid) then
    raise exception 'Удалить НПА может только его автор или преподаватель';
  end if;

  if exists (
    select 1
    from public.game_votes
    where formal_document_id = d.id
      and status = 'open'
  ) and not v_teacher then
    raise exception 'Сначала завершите или удалите открытое голосование по этому НПА';
  end if;

  if v_teacher then
    for v_vote in
      select id
      from public.game_votes
      where formal_document_id = d.id
        and status = 'open'
      order by opened_at
    loop
      perform public.delete_procedural_vote(v_vote.id);
    end loop;
  end if;

  delete from public.formal_documents
  where id = d.id;

  v_deleted := found;

  return jsonb_build_object(
    'deleted', v_deleted,
    'id', d.id,
    'registry_no', d.registry_no
  );
end;
$function$;
