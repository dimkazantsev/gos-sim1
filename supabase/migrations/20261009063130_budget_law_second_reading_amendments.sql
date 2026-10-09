-- Actual Budget FZ second reading, separate from preliminary draft proposals.
-- Amendment ballots have no formal_document_id and never advance a reading.
create unique index budget_law_document_game_key on public.formal_documents(id,game_id);
create unique index budget_law_vote_game_key on public.game_votes(id,game_id);

create table public.budget_law_amendments(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 document_id uuid not null,
 author_id uuid not null references auth.users(id),
 subject_key text not null check(subject_key in ('president','gd_deputy','sf','sf_member','government','region','ks','vs')),
 title text not null check(length(trim(title)) between 3 and 160),
 rationale text not null check(length(trim(rationale)) between 30 and 4000),
 competence_note text not null default '' check(length(competence_note)<=4000),
 from_section text not null,
 to_section text not null check(to_section<>from_section and to_section<>'13' and from_section<>'13'),
 amount numeric not null check(amount>0 and amount<=1000000 and round(amount,8)=amount),
 source_revision integer not null check(source_revision>0),
 source_calculation jsonb not null,
 source_body_text text not null,
 status text not null default 'submitted' check(status in ('submitted','voting','accepted','rejected','withdrawn')),
 vote_id uuid,
 review_note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 applied_at timestamptz,
 foreign key(document_id,game_id) references public.formal_documents(id,game_id) on delete cascade,
 foreign key(vote_id,game_id) references public.game_votes(id,game_id)
);
create index budget_law_amendments_document_game_status on public.budget_law_amendments(document_id,game_id,status,created_at);
create index budget_law_amendments_game on public.budget_law_amendments(game_id);
create index budget_law_amendments_author on public.budget_law_amendments(author_id);
create index budget_law_amendments_vote_game on public.budget_law_amendments(vote_id,game_id);

create table public.budget_law_amendment_packs(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 document_id uuid not null,
 amendment_ids uuid[] not null check(cardinality(amendment_ids) between 1 and 100),
 created_by uuid not null references auth.users(id),
 vote_id uuid unique,
 vote_title text not null,
 vote_body text not null,
 source_status text not null,
 source_revision integer not null,
 source_calculation jsonb not null,
 source_draft jsonb not null,
 source_body_text text not null,
 result_calculation jsonb not null,
 result_draft jsonb not null,
 result_body_text text not null,
 status text not null default 'opening' check(status in ('opening','voting','accepted','rejected','no_quorum')),
 created_at timestamptz not null default now(),
 decided_at timestamptz,
 foreign key(document_id,game_id) references public.formal_documents(id,game_id) on delete cascade,
 foreign key(vote_id,game_id) references public.game_votes(id,game_id)
);
create unique index budget_law_amendment_one_active on public.budget_law_amendment_packs(document_id) where status in ('opening','voting');
create index budget_law_amendment_packs_document_game on public.budget_law_amendment_packs(document_id,game_id);
create index budget_law_amendment_packs_game on public.budget_law_amendment_packs(game_id);
create index budget_law_amendment_packs_creator on public.budget_law_amendment_packs(created_by);
create index budget_law_amendment_packs_vote_game on public.budget_law_amendment_packs(vote_id,game_id);

-- Formal primary/additional offices count; generic students, candidates,
-- municipal executives and arbitrary mentions of an office do not.
create function private.budget_law_subject_available(p_game uuid,p_subject text) returns boolean
language sql stable security definer set search_path=public,private,pg_temp as $$
 select private.active_budget_actor(p_game) and p_subject in ('president','gd_deputy','sf','sf_member','government','region','ks','vs') and (
  private.is_game_teacher(p_game) or exists(select 1 from private.formal_user_roles(p_game,auth.uid()) r where
   case p_subject
    when 'president' then r ~ '^президент([[:space:]]|$)'
    when 'gd_deputy' then r ~ '^депутат([[:space:]]|$)' or r ~ '^председатель[[:space:]]+(государственной[[:space:]]+)?думы([[:space:]]|$)'
    when 'sf' then r ~ '^председатель[[:space:]]+совета[[:space:]]+федерации([[:space:]]|$)'
    when 'sf_member' then r ~ '^сенатор([[:space:]]|$)' or r ~ '^член[[:space:]]+совета[[:space:]]+федерации([[:space:]]|$)'
    when 'government' then r ~ '^председатель[[:space:]]+правительства([[:space:]]|$)' or r ~ '^министр([[:space:]]|$)' or r ~ '^заместитель[[:space:]]+председателя[[:space:]]+правительства([[:space:]]|$)'
    when 'region' then r ~ '^(председатель|депутат|член)[[:space:]].*законодательн' or r ~ '^законодательн'
    when 'ks' then r ~ '^(председатель|судья|член)[[:space:]].*конституционн.*суд' or r ~ '^конституционный[[:space:]]+суд'
    when 'vs' then r ~ '^(председатель|судья|член)[[:space:]].*верховн.*суд' or r ~ '^верховный[[:space:]]+суд'
    else false end
  ));
$$;
create function private.can_manage_budget_law_amendments(p_document uuid) returns boolean
language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(select 1 from formal_documents d where d.id=p_document and d.workflow_key='budget' and d.doc_type='federal_budget'
  and private.active_budget_actor(d.game_id) and (
   private.is_game_teacher(d.game_id)
   or exists(select 1 from private.formal_user_roles(d.game_id,auth.uid()) r where r ~ '^председатель[[:space:]]+(государственной[[:space:]]+)?думы([[:space:]]|$)')
   or exists(select 1 from institution_units u left join institution_assignments a on a.game_id=u.game_id and a.unit_id=u.id and a.user_id=auth.uid()
    where u.game_id=d.game_id and u.unit_kind='committee' and u.unit_key in ('economic','budget') and (u.head_user_id=auth.uid() or a.user_id=auth.uid()))
   or exists(select 1 from private.formal_user_roles(d.game_id,auth.uid()) r where r ~ '^председатель[[:space:]]+комитета.*(бюджет|экономич)')
  ));
$$;

-- Capture first-reading totals exactly once, as part of the existing accepted
-- first-reading transition. Later macro/events cannot change those totals.
create function private.guard_budget_law_first_reading() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v uuid;
begin
 if old.workflow_key<>'budget' or old.doc_type<>'federal_budget' then return new;end if;
 if old.metadata ? 'budget_first_reading_snapshot' and (
  new.metadata->'budget_first_reading_snapshot' is distinct from old.metadata->'budget_first_reading_snapshot'
  or new.metadata->'budget_first_reading_vote_id' is distinct from old.metadata->'budget_first_reading_vote_id')
  then raise exception 'Основные характеристики, утверждённые в I чтении, зафиксированы.';end if;
 if old.status_code='reading1' and new.status_code='amendments' and not(old.metadata ? 'budget_first_reading_snapshot') and old.metadata ? 'budget_simulator_plan_id' then
  select id into v from game_votes where game_id=old.game_id and formal_document_id=old.id and formal_step_code='reading1'
   and procedure_key='budget_reading1' and status='closed' and result_code='passed' and result_quorum_met and result_yes>=226 order by closed_at desc,id limit 1;
  if v is null then raise exception 'Основные характеристики бюджета утверждаются принятым голосованием I чтения.';end if;
  new.metadata:=new.metadata||jsonb_build_object('budget_first_reading_snapshot',old.metadata->'budget_snapshot','budget_first_reading_vote_id',v);
 end if;
 return new;
end;$$;

create trigger guard_budget_law_first_reading before update on public.formal_documents for each row execute function private.guard_budget_law_first_reading();

-- Existing projects already at second reading acquire the same immutable base
-- on their first mutation, only if a real accepted first-reading vote exists.
create function private.ensure_budget_law_first_reading(p_document uuid) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d formal_documents%rowtype;v uuid;
begin
 select * into d from formal_documents where id=p_document for update;
 if d.metadata ? 'budget_first_reading_snapshot' then return;end if;
 select id into v from game_votes where game_id=d.game_id and formal_document_id=d.id and formal_step_code='reading1'
  and procedure_key='budget_reading1' and status='closed' and result_code='passed' and result_quorum_met and result_yes>=226 order by closed_at desc,id limit 1;
 if v is null or not(d.metadata ? 'budget_simulator_plan_id') or jsonb_typeof(d.metadata->'budget_snapshot') is distinct from 'object'
  then raise exception 'Сначала утвердите основные характеристики бюджета в I чтении.';end if;
 update formal_documents set metadata=metadata||jsonb_build_object('budget_first_reading_snapshot',metadata->'budget_snapshot','budget_first_reading_vote_id',v) where id=d.id;
end;$$;

-- Reallocate only movable base expenditure at the frozen cost. All earmarked
-- items/programmes, transfers, debt service, revenue and financing stay exact.
create function private.preview_budget_law_reallocation(p_calculation jsonb,p_draft jsonb,p_from text,p_to text,p_amount numeric) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare f jsonb;t jsonb;l jsonb;rows jsonb:='[]';cost numeric;fp numeric;tp numeric;n jsonb;c jsonb;source_base numeric;target_base numeric;
begin
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount>1000000 or round(p_amount,8)<>p_amount
  then raise exception 'Укажите положительную сумму до 1 000 млрд ₽ с точностью до копейки.';end if;
 if p_from is null or p_to is null or p_from=p_to or p_from='13' or p_to='13' then raise exception 'Выберите два разных раздела. Обслуживание долга не перераспределяется.';end if;
 select value into f from jsonb_array_elements(p_calculation->'expense_lines') where value->>'key'=p_from;
 select value into t from jsonb_array_elements(p_calculation->'expense_lines') where value->>'key'=p_to;
 cost:=(p_calculation->>'cost')::numeric;
 if f is null or t is null or cost is null or cost<=0 or (f->>'baseline')::numeric<=0 or (t->>'baseline')::numeric<=0 or jsonb_typeof(f->'base_amount') is distinct from 'number' or jsonb_typeof(t->'base_amount') is distinct from 'number'
  then raise exception 'Этот проект не содержит полный расчёт свободных расходов. Подготовьте актуальный проект до I чтения.';end if;
 source_base:=(f->>'base_amount')::numeric;target_base:=(t->>'base_amount')::numeric;
 if p_amount>source_base then raise exception 'Недостаточно свободных базовых расходов. Госпрограммы, отдельные мероприятия и трансферты защищены.';end if;
 fp:=((source_base-p_amount)/((f->>'baseline')::numeric*cost)-1)*100;
 tp:=((target_base+p_amount)/((t->>'baseline')::numeric*cost)-1)*100;
 if fp< -80 or tp>200 then raise exception 'Перераспределение выходит за пределы модели: от −80 %% до +200 %% к исходным базовым расходам.';end if;
 for l in select value from jsonb_array_elements(p_calculation->'expense_lines') loop
  if l->>'key'=p_from then l:=l||jsonb_build_object('base_amount',source_base-p_amount,'base_reallocation_amount',coalesce((l->>'base_reallocation_amount')::numeric,0)-p_amount,'amount',round((l->>'amount')::numeric-p_amount,8));
  elsif l->>'key'=p_to then l:=l||jsonb_build_object('base_amount',target_base+p_amount,'base_reallocation_amount',coalesce((l->>'base_reallocation_amount')::numeric,0)+p_amount,'amount',round((l->>'amount')::numeric+p_amount,8));end if;
  rows:=rows||jsonb_build_array(l);
 end loop;
 c:=jsonb_set(p_calculation,'{expense_lines}',rows);
 n:=jsonb_set(p_draft,'{base_reallocations}',coalesce(p_draft->'base_reallocations','{}'::jsonb)||jsonb_build_object(
  p_from,coalesce((p_draft->'base_reallocations'->>p_from)::numeric,0)-p_amount,
  p_to,coalesce((p_draft->'base_reallocations'->>p_to)::numeric,0)+p_amount));
 if exists(select 1 from jsonb_each_text(n->'base_reallocations') where value::numeric not between -1000000 and 1000000) then raise exception 'Совокупное перераспределение раздела превышает учебный предел 1 000 млрд ₽.';end if;
 return jsonb_build_object('calculation',c,'draft',n);
end;$$;

create function public.get_budget_law_amendments(p_document_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare d formal_documents%rowtype;s text;subjects jsonb:='[]';base_ready boolean;
begin
 select * into d from formal_documents where id=p_document_id;
 if d.id is null or d.workflow_key<>'budget' or d.doc_type<>'federal_budget' or auth.uid() is null or not private.is_game_member(d.game_id)
  then raise exception 'Нет доступа к поправкам этого бюджета.';end if;
 foreach s in array array['president','gd_deputy','sf','sf_member','government','region','ks','vs'] loop
  if private.budget_law_subject_available(d.game_id,s) then subjects:=subjects||jsonb_build_array(s);end if;
 end loop;
 base_ready:=jsonb_typeof(d.metadata->'budget_snapshot')='object' and d.metadata ? 'budget_simulator_plan_id' and (
  d.metadata ? 'budget_first_reading_snapshot' or exists(select 1 from game_votes where formal_document_id=d.id and game_id=d.game_id
   and formal_step_code='reading1' and procedure_key='budget_reading1' and status='closed' and result_code='passed' and result_quorum_met and result_yes>=226));
 return jsonb_build_object('document_id',d.id,'status_code',d.status_code,'revision',coalesce((d.metadata->>'revision')::integer,1),
  'can_manage',private.can_manage_budget_law_amendments(d.id),'subjects',subjects,'base_ready',coalesce(base_ready,false),
  'can_submit',coalesce(base_ready,false) and jsonb_array_length(subjects)>0 and d.status_code in ('amendments','reading2') and not exists(select 1 from game_votes where formal_document_id=d.id and status='open'),
  'calculation',d.metadata->'budget_snapshot','first_reading',coalesce(d.metadata->'budget_first_reading_snapshot',d.metadata->'budget_snapshot'),
  'pending_count',(select count(*) from budget_law_amendments where document_id=d.id and status in ('submitted','voting')),
  'open_vote_id',(select vote_id from budget_law_amendment_packs where document_id=d.id and status='voting'),
  'amendments',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('can_withdraw',private.active_budget_actor(d.game_id) and a.author_id=auth.uid() and a.status='submitted',
   'stale',a.source_revision<>coalesce((d.metadata->>'revision')::integer,1) or a.source_calculation is distinct from d.metadata->'budget_snapshot' or a.source_body_text is distinct from coalesce(d.body_text,'')) order by a.created_at,a.id),'[]'::jsonb) from budget_law_amendments a where a.document_id=d.id),
  'packs',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'vote_id',p.vote_id,'status',p.status,'result_label',v.result_label) order by p.created_at desc,p.id),'[]'::jsonb) from budget_law_amendment_packs p left join game_votes v on v.id=p.vote_id and v.game_id=p.game_id where p.document_id=d.id));
end;$$;

create function public.submit_budget_law_amendment(p_document_id uuid,p_revision integer,p_subject_key text,p_title text,p_rationale text,p_from text,p_to text,p_amount numeric,p_competence_note text default null) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d formal_documents%rowtype;gid uuid;a uuid;preview jsonb;
begin
 select game_id into gid from formal_documents where id=p_document_id;
 perform private.lock_budget_actor(gid);perform pg_advisory_xact_lock(hashtextextended('budget:'||gid::text,0));
 select * into d from formal_documents where id=p_document_id for update;
 if d.id is null or d.workflow_key<>'budget' or d.doc_type<>'federal_budget' or not private.budget_law_subject_available(d.game_id,p_subject_key) then raise exception 'Внести поправку может действующий субъект законодательной инициативы этой игры.';end if;
 if d.status_code not in ('amendments','reading2') then raise exception 'Поправки бюджета вносятся при подготовке и проведении II чтения.';end if;
 if p_revision is distinct from coalesce((d.metadata->>'revision')::integer,1) then raise exception 'Редакция бюджета изменилась. Обновите проект перед внесением поправки.';end if;
 if exists(select 1 from game_votes where formal_document_id=d.id and status='open') or exists(select 1 from budget_law_amendment_packs where document_id=d.id and status in ('opening','voting')) then raise exception 'Сначала завершите открытое голосование по проекту или пакету.';end if;
 if p_title is null or length(trim(p_title)) not between 3 and 160 or p_rationale is null or length(trim(p_rationale)) not between 30 and 4000 or length(coalesce(p_competence_note,''))>4000 then raise exception 'Укажите название (3–160 знаков) и обоснование (30–4000 знаков).';end if;
 if p_subject_key in ('ks','vs') and length(trim(coalesce(p_competence_note,'')))<10 then raise exception 'Суд обосновывает связь поправки с вопросами своего ведения.';end if;
 perform private.ensure_budget_law_first_reading(d.id);
 preview:=private.preview_budget_law_reallocation(d.metadata->'budget_snapshot',d.metadata->'budget_draft',p_from,p_to,p_amount);
 insert into budget_law_amendments(game_id,document_id,author_id,subject_key,title,rationale,competence_note,from_section,to_section,amount,source_revision,source_calculation,source_body_text)
 values(d.game_id,d.id,auth.uid(),p_subject_key,trim(p_title),trim(p_rationale),trim(coalesce(p_competence_note,'')),p_from,p_to,p_amount,p_revision,d.metadata->'budget_snapshot',coalesce(d.body_text,'')) returning id into a;
 insert into formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,auth.uid(),'Внесена бюджетная поправка ко II чтению',d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,trim(p_title)||' · '||trim(p_rationale));
 return a;
end;$$;

create function public.withdraw_budget_law_amendment(p_amendment_id uuid) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a budget_law_amendments%rowtype;d formal_documents%rowtype;
begin
 select * into a from budget_law_amendments where id=p_amendment_id;
 perform private.lock_budget_actor(a.game_id);perform pg_advisory_xact_lock(hashtextextended('budget:'||a.game_id::text,0));
 select * into d from formal_documents where id=a.document_id for update;
 select * into a from budget_law_amendments where id=p_amendment_id for update;
 if a.id is null or a.author_id is distinct from auth.uid() then raise exception 'Отозвать поправку может только её действующий автор.';end if;
 if a.status='withdrawn' then return;end if;
 if a.status<>'submitted' then raise exception 'Отзыв возможен только до голосования.';end if;
 update budget_law_amendments set status='withdrawn',updated_at=now() where id=a.id;
 insert into formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,auth.uid(),'Автор отозвал бюджетную поправку',d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,a.title);
end;$$;
create function public.reject_budget_law_amendment(p_amendment_id uuid,p_note text) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a budget_law_amendments%rowtype;d formal_documents%rowtype;
begin
 select * into a from budget_law_amendments where id=p_amendment_id;
 perform private.lock_budget_actor(a.game_id);perform pg_advisory_xact_lock(hashtextextended('budget:'||a.game_id::text,0));
 select * into d from formal_documents where id=a.document_id for update;
 select * into a from budget_law_amendments where id=p_amendment_id for update;
 if a.id is null or not private.can_manage_budget_law_amendments(d.id) then raise exception 'Таблицу рассматривает Комитет по бюджету, председатель ГД или преподаватель.';end if;
 if a.status<>'submitted' then raise exception 'Поправка уже передана на голосование или рассмотрена.';end if;
 if p_note is null or length(trim(p_note)) not between 10 and 4000 then raise exception 'Укажите мотивированную причину невключения (10–4000 знаков).';end if;
 update budget_law_amendments set status='rejected',review_note=trim(p_note),updated_at=now() where id=a.id;
 insert into formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,auth.uid(),'Бюджетная поправка не включена в пакет',d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,a.title||' · '||trim(p_note));
end;$$;

create function private.budget_law_expense_body(p_body text,p_calculation jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare start_at integer;end_at integer;text_rows text;line jsonb;
begin
 start_at:=strpos(p_body,'Статья 3. Распределение расходов по разделам');end_at:=strpos(p_body,'Статья 4. Источники финансирования дефицита');
 if start_at=0 or end_at<=start_at then raise exception 'Для финансовых поправок требуется проект с расчётными статьями 3 и 4. Подготовьте актуальный проект до I чтения.';end if;
 text_rows:=E'Статья 3. Распределение расходов по разделам\n';
 for line in select value from jsonb_array_elements(p_calculation->'expense_lines') loop
  text_rows:=text_rows||(line->>'key')||'. '||(line->>'label')||': '||(line->>'amount')||E' млн рублей.\n';
 end loop;
 text_rows:=text_rows||E'Корректировка округления: −100 млн рублей.\n\n';
 return replace(substring(p_body from 1 for start_at-1)||text_rows||substring(p_body from end_at),
  'Для изменения сумм используйте калькулятор вкладки «Бюджет» и сформируйте новую редакцию проекта.',
  'После I чтения основные характеристики закреплены. Перераспределение свободных базовых расходов проходит через таблицу поправок II чтения в реестре НПА.');
end;$$;

create function public.open_budget_law_amendment_vote(p_document_id uuid,p_amendment_ids uuid[]) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
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
 if (c-'expense_lines') is distinct from (d.metadata->'budget_snapshot'-'expense_lines') or (n-'base_reallocations') is distinct from (d.metadata->'budget_draft'-'base_reallocations') then raise exception 'Поправки не могут изменить общие характеристики и целевые обязательства бюджета.';end if;
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
end;$$;

-- Late INSERT verifier runs after the common electorate snapshot and adds no
-- new authority to common create_procedural_vote. An opening pack is RPC-only.
create function private.guard_budget_law_vote_insert() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p budget_law_amendment_packs%rowtype;d formal_documents%rowtype;weights jsonb;
begin
 if new.procedure_key is distinct from 'budget_second_reading_amendment' then return new;end if;
 perform private.lock_budget_actor(new.game_id);
 select * into p from budget_law_amendment_packs where game_id=new.game_id and created_by=auth.uid() and status='opening' and vote_id is null and vote_title=new.title and vote_body=new.body order by created_at,id limit 1 for update;
 select * into d from formal_documents where id=p.document_id for update;
 if p.id is null or d.id is null or not private.can_manage_budget_law_amendments(d.id) or d.game_id is distinct from new.game_id
  or d.status_code not in ('amendments','reading2') or d.status_code is distinct from p.source_status or coalesce((d.metadata->>'revision')::integer,1) is distinct from p.source_revision
  or d.metadata->'budget_snapshot' is distinct from p.source_calculation or d.metadata->'budget_draft' is distinct from p.source_draft or coalesce(d.body_text,'') is distinct from p.source_body_text
  or new.formal_document_id is not null or new.formal_step_code is not null or new.institution_key is distinct from 'gd' or new.voting_mode is distinct from 'mandate'
  or new.status is distinct from 'open' or new.created_by is distinct from auth.uid() or new.stage_no is distinct from (select current_round from games where id=new.game_id)
  or new.quorum_kind is distinct from 'fraction' or new.quorum_value is distinct from .5::numeric or new.majority_kind is distinct from 'eligible_majority' or new.majority_value is distinct from .5::numeric
  or new.allow_abstain is distinct from true or new.tie_breaker_chair is distinct from false or new.pass_transition is distinct from 'none' or new.fail_transition is distinct from 'none'
  or new.group_name is not null or nullif(current_setting('app.vote_group',true),'') is not null
  then raise exception 'Бюджетное поправочное голосование открывается только из проверенного пакета со всеми установленными правилами.';end if;
 select coalesce(jsonb_object_agg(w.key,w.value),'{}'::jsonb) into weights from jsonb_each(coalesce(new.electorate_snapshot->'weights','{}'::jsonb)) w
  where exists(select 1 from game_members m where m.game_id=new.game_id and m.user_id::text=w.key and m.roster_archived_at is null);
 new.electorate_snapshot:=new.electorate_snapshot||jsonb_build_object('weights',weights,'eligible',450,'attendance_required',true);
 return new;
end;$$;
create trigger zzzzz_guard_budget_law_vote_insert before insert on public.game_votes for each row execute function private.guard_budget_law_vote_insert();

create function private.guard_budget_law_vote_update() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p budget_law_amendment_packs%rowtype;d formal_documents%rowtype;present numeric;y numeric;n numeric;a numeric;casted numeric;q boolean;result text;
begin
 if old.procedure_key is distinct from 'budget_second_reading_amendment' then return new;end if;
 select * into p from budget_law_amendment_packs where vote_id=old.id;
 if p.id is null then raise exception 'Не найден проверенный бюджетный пакет.';end if;
 if old.status='closed' and to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'Результат бюджетного пакета уже зафиксирован.';end if;
 if (to_jsonb(new)-array['status','closed_at','result_code','result_label','result_yes','result_no','result_abstain','result_eligible','result_cast','result_present','result_quorum_met','decision_note'])
  is distinct from (to_jsonb(old)-array['status','closed_at','result_code','result_label','result_yes','result_no','result_abstain','result_eligible','result_cast','result_present','result_quorum_met','decision_note'])
  then raise exception 'Состав, правила и выбранные поправки зафиксированы.';end if;
 if new.status='closed' and old.status='open' then
  perform private.lock_budget_actor(p.game_id);perform pg_advisory_xact_lock(hashtextextended('budget:'||p.game_id::text,0));
  select * into d from formal_documents where id=p.document_id for update;
  if not private.can_manage_budget_law_amendments(d.id) or p.status<>'voting' or d.status_code is distinct from p.source_status
   or coalesce((d.metadata->>'revision')::integer,1) is distinct from p.source_revision or d.metadata->'budget_snapshot' is distinct from p.source_calculation or d.metadata->'budget_draft' is distinct from p.source_draft or coalesce(d.body_text,'') is distinct from p.source_body_text
   then raise exception 'Пакет или исходная редакция изменились либо нет полномочий завершить рассмотрение.';end if;
  present:=private.vote_present_weight(old);
  select coalesce(sum(weight),0),coalesce(sum(coalesce(yes_weight,case when choice='yes' then weight else 0 end)),0),coalesce(sum(coalesce(no_weight,case when choice='no' then weight else 0 end)),0),coalesce(sum(coalesce(abstain_weight,case when choice='abstain' then weight else 0 end)),0) into casted,y,n,a from game_ballots where vote_id=old.id;
  q:=present>=226;result:=case when not q then 'no_quorum' when y>=226 then 'passed' else 'rejected' end;
  if new.result_code is distinct from result or new.result_quorum_met is distinct from q or new.result_eligible is distinct from 450::numeric or new.result_present is distinct from present
   or new.result_yes is distinct from y or new.result_no is distinct from n or new.result_abstain is distinct from a or new.result_cast is distinct from casted
   then raise exception 'Результат должен соответствовать регистрации депутатов и голосам: 226 из 450 для принятия.';end if;
 elsif new.status is distinct from old.status then raise exception 'Пакет можно только завершить защищённой процедурой.';end if;
 return new;
end;$$;
create trigger guard_budget_law_vote_update before update on public.game_votes for each row execute function private.guard_budget_law_vote_update();

create function public.close_budget_law_amendment_vote(p_vote_id uuid,p_note text default null) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p budget_law_amendment_packs%rowtype;d formal_documents%rowtype;v game_votes%rowtype;present numeric;y numeric;n numeric;a numeric;casted numeric;q boolean;result text;label text;
begin
 select * into p from budget_law_amendment_packs where vote_id=p_vote_id;
 if p.id is null then raise exception 'Голосование не связано с пакетом бюджетных поправок.';end if;
 perform private.lock_budget_actor(p.game_id);perform pg_advisory_xact_lock(hashtextextended('budget:'||p.game_id::text,0));
 select * into d from formal_documents where id=p.document_id for update;
 select * into p from budget_law_amendment_packs where vote_id=p_vote_id for update;
 select * into v from game_votes where id=p_vote_id for update;
 if not private.can_manage_budget_law_amendments(d.id) then raise exception 'Голосование завершает Комитет по бюджету, председатель ГД или преподаватель.';end if;
 if v.id is null or v.game_id is distinct from p.game_id or v.procedure_key is distinct from 'budget_second_reading_amendment' or v.formal_document_id is not null then raise exception 'Некорректная связь голосования с бюджетным пакетом.';end if;
 if v.status='closed' then return jsonb_build_object('result',v.result_code,'label',v.result_label,'already_closed',true);end if;
 if v.status<>'open' or p.status<>'voting' then raise exception 'Пакет не находится на голосовании.';end if;
 present:=private.vote_present_weight(v);
 select coalesce(sum(weight),0),coalesce(sum(coalesce(yes_weight,case when choice='yes' then weight else 0 end)),0),coalesce(sum(coalesce(no_weight,case when choice='no' then weight else 0 end)),0),coalesce(sum(coalesce(abstain_weight,case when choice='abstain' then weight else 0 end)),0) into casted,y,n,a from game_ballots where vote_id=v.id;
 q:=present>=226;result:=case when not q then 'no_quorum' when y>=226 then 'passed' else 'rejected' end;
 label:=case result when 'passed' then 'Выбранные бюджетные поправки приняты' when 'no_quorum' then 'Нет кворума: поправки возвращены на рассмотрение' else 'Пакет бюджетных поправок отклонён' end;
 update game_votes set status='closed',closed_at=now(),result_code=result,result_label=label,result_yes=y,result_no=n,result_abstain=a,result_eligible=450,result_cast=casted,result_present=present,result_quorum_met=q,decision_note=nullif(left(trim(p_note),4000),'') where id=v.id;
 return jsonb_build_object('result',result,'label',label,'yes',y,'no',n,'abstain',a,'eligible',450,'present',present,'cast',casted,'quorum',q,'needed',226);
end;$$;

create function private.apply_budget_law_amendment_result() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p budget_law_amendment_packs%rowtype;d formal_documents%rowtype;pl budget_simulator_plans%rowtype;v_revision integer;annex jsonb;
begin
 if new.procedure_key is distinct from 'budget_second_reading_amendment' or new.status<>'closed' or old.status='closed' then return new;end if;
 select * into p from budget_law_amendment_packs where vote_id=new.id for update;
 select * into d from formal_documents where id=p.document_id for update;
 if p.status<>'voting' or not private.can_manage_budget_law_amendments(d.id) then raise exception 'Пакет уже рассмотрен или нет полномочий включить поправки.';end if;
 if new.result_code='passed' then
  select * into pl from budget_simulator_plans where id::text=d.metadata->>'budget_simulator_plan_id' and game_id=d.game_id and document_id=d.id for update;
  if pl.id is null or pl.status<>'document' or pl.calculation is distinct from p.source_calculation or pl.draft is distinct from p.source_draft then raise exception 'Связанный бюджетный расчёт изменился. Поправки не могут быть включены.';end if;
  if (p.result_calculation-'expense_lines') is distinct from (p.source_calculation-'expense_lines') or (p.result_draft-'base_reallocations') is distinct from (p.source_draft-'base_reallocations') then raise exception 'Поправки изменили основные характеристики или защищённые обязательства.';end if;
  v_revision:=p.source_revision;
  insert into formal_document_revisions(game_id,document_id,revision,title,body_text,metadata,editor_id)
   values(d.game_id,d.id,v_revision,d.title,d.body_text,d.metadata,auth.uid()) on conflict(document_id,revision) do nothing;
  update budget_law_amendment_packs set status='accepted',decided_at=now() where id=p.id;
  update budget_law_amendments set status='accepted',applied_at=now(),updated_at=now() where id=any(p.amendment_ids) and status='voting' and vote_id=new.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'rationale',a.rationale,'subject_key',a.subject_key,'author_id',a.author_id,'from_section',a.from_section,'to_section',a.to_section,'amount',a.amount,'vote_id',new.id,'revision',v_revision+1) order by a.created_at,a.id),'[]'::jsonb) into annex from budget_law_amendments a where id=any(p.amendment_ids);
  update budget_simulator_plans set draft=p.result_draft,calculation=p.result_calculation,revision=budget_simulator_plans.revision+1,updated_by=auth.uid(),updated_at=now() where id=pl.id;
  update formal_documents set body_text=p.result_body_text,metadata=metadata||jsonb_build_object('revision',v_revision+1,'budget_snapshot',p.result_calculation,'budget_draft',p.result_draft,
   'budget_law_amendments',coalesce(metadata->'budget_law_amendments','[]'::jsonb)||annex),updated_at=now() where id=d.id;
 elsif new.result_code='no_quorum' then
  update budget_law_amendment_packs set status='no_quorum',decided_at=now() where id=p.id;
  update budget_law_amendments set status='submitted',vote_id=null,updated_at=now() where id=any(p.amendment_ids) and status='voting' and vote_id=new.id;
 else
  update budget_law_amendment_packs set status='rejected',decided_at=now() where id=p.id;
  update budget_law_amendments set status='rejected',review_note=coalesce(new.decision_note,new.result_label),updated_at=now() where id=any(p.amendment_ids) and status='voting' and vote_id=new.id;
 end if;
 insert into formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,auth.uid(),case new.result_code when 'passed' then 'Принятые бюджетные поправки включены в проект' when 'no_quorum' then 'Нет кворума по бюджетным поправкам' else 'Бюджетный пакет отклонён' end,d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,'Пакет '||p.id||' · '||new.result_label);
 return new;
end;$$;
create trigger apply_budget_law_amendment_result after update of status on public.game_votes for each row execute function private.apply_budget_law_amendment_result();

create function private.guard_budget_law_document() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if old.workflow_key<>'budget' or old.doc_type<>'federal_budget' then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then
  if exists(select 1 from games where id=old.game_id) and exists(select 1 from budget_law_amendments where document_id=old.id) then raise exception 'История бюджетных поправок сохраняется до удаления игры.';end if;
  return old;
 end if;
 if exists(select 1 from budget_law_amendments where document_id=old.id and status in ('submitted','voting')) and (
  new.status_code is distinct from old.status_code or new.current_step is distinct from old.current_step or new.current_owner_key is distinct from old.current_owner_key
  or new.workflow_key is distinct from old.workflow_key or new.workflow_steps is distinct from old.workflow_steps or new.doc_type is distinct from old.doc_type or new.game_id is distinct from old.game_id)
  then raise exception 'Сначала рассмотрите или отзовите все поправки ко II чтению бюджета.';end if;
 if exists(select 1 from budget_law_amendment_packs where document_id=old.id and status in ('opening','voting')) and (
  new.body_text is distinct from old.body_text or new.title is distinct from old.title or new.metadata->>'revision' is distinct from old.metadata->>'revision'
  or new.metadata->'budget_snapshot' is distinct from old.metadata->'budget_snapshot' or new.metadata->'budget_draft' is distinct from old.metadata->'budget_draft')
  then raise exception 'Редакция бюджета зафиксирована до завершения голосования по пакету.';end if;
 if old.metadata ? 'budget_first_reading_snapshot' and (
  new.metadata->'budget_snapshot' is distinct from old.metadata->'budget_snapshot' or new.metadata->'budget_draft' is distinct from old.metadata->'budget_draft') and not exists(
   select 1 from budget_law_amendment_packs p where p.document_id=old.id and p.game_id=old.game_id and p.status='accepted'
    and p.source_revision=coalesce((old.metadata->>'revision')::integer,1) and p.source_calculation=old.metadata->'budget_snapshot' and p.source_draft=old.metadata->'budget_draft' and p.source_body_text=coalesce(old.body_text,'')
    and p.result_calculation=new.metadata->'budget_snapshot' and p.result_draft=new.metadata->'budget_draft' and p.result_body_text=new.body_text and coalesce((new.metadata->>'revision')::integer,1)=p.source_revision+1)
  then raise exception 'Числовые приложения после I чтения меняются только принятыми бюджетными поправками.';end if;
 return new;
end;$$;
create trigger guard_budget_law_document before update or delete on public.formal_documents for each row execute function private.guard_budget_law_document();
create function private.guard_budget_law_whole_reading() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d formal_documents%rowtype;
begin
 if new.formal_document_id is null then return new;end if;
 select * into d from formal_documents where id=new.formal_document_id for update;
 if d.workflow_key='budget' and d.doc_type='federal_budget' and d.status_code in ('amendments','reading2') and exists(select 1 from budget_law_amendments where document_id=d.id and status in ('submitted','voting')) then raise exception 'II чтение бюджета в целом голосуется после рассмотрения всех поправок.';end if;
 return new;
end;$$;
create trigger guard_budget_law_whole_reading before insert on public.game_votes for each row execute function private.guard_budget_law_whole_reading();
create function private.guard_budget_law_amendment_delete() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if exists(select 1 from games where id=old.game_id) then raise exception 'История бюджетных поправок сохраняется. До голосования автор может отозвать предложение.';end if;
 return old;
end;$$;
create trigger guard_budget_law_amendment_delete before delete on public.budget_law_amendments for each row execute function private.guard_budget_law_amendment_delete();
create trigger guard_budget_law_pack_delete before delete on public.budget_law_amendment_packs for each row execute function private.guard_budget_law_amendment_delete();

alter table public.budget_law_amendments enable row level security;
alter table public.budget_law_amendment_packs enable row level security;
revoke all on public.budget_law_amendments,public.budget_law_amendment_packs from public,anon,authenticated;
grant select on public.budget_law_amendments,public.budget_law_amendment_packs to authenticated;
create policy budget_law_amendment_member_read on public.budget_law_amendments for select to authenticated using(private.is_game_member(game_id));
create policy budget_law_amendment_pack_member_read on public.budget_law_amendment_packs for select to authenticated using(private.is_game_member(game_id));
revoke all on function private.budget_law_subject_available(uuid,text),private.can_manage_budget_law_amendments(uuid),private.guard_budget_law_first_reading(),private.ensure_budget_law_first_reading(uuid),private.preview_budget_law_reallocation(jsonb,jsonb,text,text,numeric),private.budget_law_expense_body(text,jsonb),private.guard_budget_law_vote_insert(),private.guard_budget_law_vote_update(),private.apply_budget_law_amendment_result(),private.guard_budget_law_document(),private.guard_budget_law_whole_reading(),private.guard_budget_law_amendment_delete() from public,anon,authenticated;
revoke all on function public.get_budget_law_amendments(uuid),public.submit_budget_law_amendment(uuid,integer,text,text,text,text,text,numeric,text),public.withdraw_budget_law_amendment(uuid),public.reject_budget_law_amendment(uuid,text),public.open_budget_law_amendment_vote(uuid,uuid[]),public.close_budget_law_amendment_vote(uuid,text) from public,anon,authenticated;
grant execute on function public.get_budget_law_amendments(uuid),public.submit_budget_law_amendment(uuid,integer,text,text,text,text,text,numeric,text),public.withdraw_budget_law_amendment(uuid),public.reject_budget_law_amendment(uuid,text),public.open_budget_law_amendment_vote(uuid,uuid[]),public.close_budget_law_amendment_vote(uuid,text) to authenticated;
do $$begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='budget_law_amendments') then alter publication supabase_realtime add table public.budget_law_amendments;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='budget_law_amendment_packs') then alter publication supabase_realtime add table public.budget_law_amendment_packs;end if;
end;$$;
