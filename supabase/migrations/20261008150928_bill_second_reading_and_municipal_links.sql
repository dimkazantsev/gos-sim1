-- Separate second-reading amendment packs. Their votes deliberately have no
-- game_votes.formal_document_id: closing a pack must not advance the whole bill.
create table public.bill_amendments (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 document_id uuid not null references public.formal_documents(id) on delete cascade,
 author_id uuid not null references auth.users(id),
 subject_key text not null check(subject_key in ('president','gd_deputy','sf','sf_member','government','region','ks','vs')),
 old_text text not null check(length(trim(old_text))>0 and length(old_text)<=120000),
 new_text text not null check(length(new_text)<=120000),
 rationale text not null check(length(trim(rationale))>=10 and length(rationale)<=4000),
 competence_note text not null default '' check(length(competence_note)<=4000),
 source_body_text text not null,
 quote_start integer not null check(quote_start>0),
 status text not null default 'submitted' check(status in ('submitted','voting','accepted','rejected','withdrawn')),
 vote_id uuid references public.game_votes(id),
 review_note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 applied_at timestamptz
);
create index bill_amendments_document_status_idx on public.bill_amendments(document_id,status,created_at);

create table public.bill_amendment_packs (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 document_id uuid not null references public.formal_documents(id) on delete cascade,
 amendment_ids uuid[] not null check(cardinality(amendment_ids) between 1 and 100),
 created_by uuid not null references auth.users(id),
 vote_id uuid unique references public.game_votes(id),
 vote_title text not null,
 vote_body text not null,
 source_status text not null,
 source_body_text text not null,
 result_body_text text not null,
 status text not null default 'opening' check(status in ('opening','voting','accepted','rejected','no_quorum')),
 created_at timestamptz not null default now(),
 decided_at timestamptz
);
create unique index bill_amendment_packs_one_active on public.bill_amendment_packs(document_id) where status in ('opening','voting');

create or replace function private.bill_amendment_actor_available(p_game uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select p_user is not null and ((p_user=auth.uid() and private.is_platform_admin()) or exists(
  select 1 from public.game_members m
  where m.game_id=p_game and m.user_id=p_user and m.kind<>'observer' and m.roster_archived_at is null
   and private.role_is_available(p_game,p_user)
 ));
$$;

-- Serialize membership/archival changes with every amendment mutation. Acquire
-- the actor first, then the document, then the amendment/pack/vote row.
create or replace function private.lock_bill_amendment_actor(p_game uuid,p_user uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare actor public.game_members%rowtype;
begin
 if p_user is null or p_user is distinct from auth.uid() then raise exception 'Нет полномочий для изменения поправок';end if;
 select * into actor from public.game_members
 where game_id=p_game and user_id=p_user for update;
 -- A global platform administrator retains authority without classroom
 -- membership, but locks any membership row that exists before the bill.
 if private.is_platform_admin() then return;end if;
 if actor.user_id is null or actor.kind='observer' or actor.roster_archived_at is not null
  or not private.role_is_available(p_game,p_user)
  then raise exception 'Нет полномочий для изменения поправок';end if;
end;$$;

create or replace function private.can_manage_bill_amendments(p_document uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(select 1 from public.formal_documents d where d.id=p_document and d.workflow_key='bill'
  and private.bill_amendment_actor_available(d.game_id,p_user) and (
   (p_user=auth.uid() and private.is_platform_admin())
   or exists(select 1 from public.game_members m
    where m.game_id=d.game_id and m.user_id=p_user and m.kind='teacher' and m.roster_archived_at is null)
   or exists(select 1 from private.formal_user_roles(d.game_id,p_user) r where r like '%председател%дум%' or r like '%совет%дум%')
   or private.is_bill_committee_member(d.id,p_user)
  ));
$$;

-- This context exists only inside open_bill_amendment_vote's transaction.
-- No client can create an opening pack or write/link its vote directly.
create or replace function private.bill_amendment_vote_context(p_game uuid,p_user uuid,p_title text,p_body text)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
 select exists(select 1 from public.bill_amendment_packs p where p.game_id=p_game and p.created_by=p_user
  and p.status='opening' and p.vote_id is null and p.vote_title=p_title and p.vote_body=p_body
  and private.can_manage_bill_amendments(p.document_id,p_user));
$$;

create or replace function public.get_bill_amendments(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;uid uuid:=auth.uid();subjects jsonb:='[]';subject text;available boolean;
begin
 select * into d from public.formal_documents where id=p_document_id;
 if d.id is null or d.workflow_key<>'bill' or uid is null or (not private.is_platform_admin() and not exists(
  select 1 from public.game_members m where m.game_id=d.game_id and m.user_id=uid and m.roster_archived_at is null
 )) then raise exception 'Нет доступа к поправкам этого законопроекта';end if;
 available:=private.bill_amendment_actor_available(d.game_id,uid);
 if available then
  foreach subject in array array['president','gd_deputy','sf','sf_member','government','region','ks','vs'] loop
   if private.can_create_formal_subject(d.game_id,uid,subject) then subjects:=subjects||jsonb_build_array(subject);end if;
  end loop;
 end if;
 return jsonb_build_object('document_id',d.id,'body_text',coalesce(d.body_text,''),'status_code',d.status_code,
  'can_manage',private.can_manage_bill_amendments(d.id,uid),'subjects',subjects,
  'can_submit',available and jsonb_array_length(subjects)>0 and d.status_code in ('amendments','reading2')
   and not exists(select 1 from public.game_votes v where v.formal_document_id=d.id and v.status='open'),
  'pending_count',(select count(*) from public.bill_amendments a where a.document_id=d.id and a.status in ('submitted','voting')),
  'open_vote_id',(select vote_id from public.bill_amendment_packs where document_id=d.id and status='voting'),
  'amendments',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('can_withdraw',available and a.author_id=uid and a.status='submitted','stale',a.source_body_text is distinct from coalesce(d.body_text,'')) order by a.created_at,a.id),'[]'::jsonb) from public.bill_amendments a where a.document_id=d.id),
  'packs',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('result_code',v.result_code,'result_label',v.result_label) order by p.created_at desc,p.id),'[]'::jsonb) from public.bill_amendment_packs p left join public.game_votes v on v.id=p.vote_id where p.document_id=d.id));
end;$$;

-- An isolated amendment closer: no legacy voting function or grant is replaced.
-- The existing electorate/registration helpers and weighted ballots remain the
-- source of truth; only the linked amendment pack can be decided by this RPC.
create or replace function public.close_bill_amendment_vote(p_vote_id uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare uid uuid:=auth.uid();v public.game_votes%rowtype;pack public.bill_amendment_packs%rowtype;d public.formal_documents%rowtype;
 eligible numeric;casted numeric;present numeric;y numeric;n numeric;a numeric;needed numeric;q boolean;pass boolean;result text;label text;
begin
 select * into pack from public.bill_amendment_packs where vote_id=p_vote_id;
 if pack.id is null then raise exception 'Голосование не связано с пакетом поправок';end if;
 perform private.lock_bill_amendment_actor(pack.game_id,uid);
 select * into d from public.formal_documents where id=pack.document_id for update;
 if d.id is null or d.game_id is distinct from pack.game_id or d.workflow_key is distinct from 'bill'
  or not private.can_manage_bill_amendments(d.id,uid)
  then raise exception 'Завершить пакет может действующий председатель ГД или профильный комитет';end if;
 select * into v from public.game_votes where id=p_vote_id for update;
 if v.id is null or v.game_id is distinct from pack.game_id or v.procedure_key is distinct from 'bill_amendments'
  or v.formal_document_id is not null or v.institution_key is distinct from 'gd' or v.voting_mode is distinct from 'mandate'
  or v.quorum_kind is distinct from 'fraction' or v.quorum_value is distinct from 0.5::numeric
  or v.majority_kind is distinct from (case when d.doc_type='fkz_bill' then 'eligible_fraction' else 'eligible_majority' end)
  or v.majority_value is distinct from (case when d.doc_type='fkz_bill' then 2.0/3 else 0.5::numeric end)
  or v.allow_abstain is distinct from true or v.tie_breaker_chair is distinct from false
  or v.pass_transition is distinct from 'none' or v.fail_transition is distinct from 'none'
  then raise exception 'Некорректная связь голосования с пакетом поправок';end if;
 if v.status='closed' then return jsonb_build_object('result',v.result_code,'label',v.result_label);end if;
 if v.status is distinct from 'open' or pack.status is distinct from 'voting' or d.status_code not in ('amendments','reading2')
  or d.status_code is distinct from pack.source_status or d.body_text is distinct from pack.source_body_text
  then raise exception 'Законопроект или пакет изменился во время голосования';end if;
 eligible:=private.vote_total_eligible_weight(v);present:=private.vote_present_weight(v);
 select coalesce(sum(weight),0),coalesce(sum(coalesce(yes_weight,case when choice='yes' then weight else 0 end)),0),coalesce(sum(coalesce(no_weight,case when choice='no' then weight else 0 end)),0),coalesce(sum(coalesce(abstain_weight,case when choice='abstain' then weight else 0 end)),0)
 into casted,y,n,a from public.game_ballots where vote_id=v.id;
 needed:=floor(eligible/2)+1;q:=eligible>0 and present>=needed;
 if not q then pass:=false;result:='no_quorum';label:='Нет кворума';
 else
  -- An exact ratio avoids ceil(450 * rounded(2/3)) accidentally requiring 301.
  pass:=case when d.doc_type='fkz_bill' then y*3>=eligible*2 else y>eligible/2 end;
  result:=case when pass then 'passed' else 'rejected' end;label:=case when pass then 'Решение принято' else 'Решение отклонено' end;
 end if;
 update public.game_votes set status='closed',closed_at=now(),result_code=result,result_label=label,result_yes=y,result_no=n,result_abstain=a,result_eligible=eligible,result_cast=casted,result_present=present,result_quorum_met=q,decision_note=nullif(trim(p_note),'') where id=v.id;
 -- Only bill_amendment_vote_closed applies this pack; there is no whole-bill
 -- transition, and this RPC can never close an unrelated legacy vote.
 return jsonb_build_object('result',result,'label',label,'yes',y,'no',n,'abstain',a,'eligible',eligible,'cast',casted,'present',present,'quorum',q,'needed',needed);
end;$$;

create or replace function public.submit_bill_amendment(p_document_id uuid,p_subject_key text,p_old_text text,p_new_text text,p_rationale text,p_competence_note text default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;uid uuid:=auth.uid();actor_game uuid;position integer;amendment uuid;
begin
 select game_id into actor_game from public.formal_documents where id=p_document_id;
 perform private.lock_bill_amendment_actor(actor_game,uid);
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null or d.game_id is distinct from actor_game or d.workflow_key<>'bill' or not private.bill_amendment_actor_available(d.game_id,uid)
  then raise exception 'Нет полномочий для внесения поправки';end if;
 if d.status_code not in ('amendments','reading2') then raise exception 'Поправки вносятся только при подготовке и проведении II чтения';end if;
 if exists(select 1 from public.game_votes where formal_document_id=d.id and status='open')
  or exists(select 1 from public.bill_amendment_packs where document_id=d.id and status in ('opening','voting'))
  then raise exception 'Сначала завершите открытое голосование по законопроекту';end if;
 if p_subject_key is null or p_subject_key not in ('president','gd_deputy','sf','sf_member','government','region','ks','vs')
  or not private.can_create_formal_subject(d.game_id,uid,p_subject_key)
  then raise exception 'Выбранный субъект законодательной инициативы не соответствует вашим полномочиям';end if;
 if p_subject_key in ('ks','vs') and length(trim(coalesce(p_competence_note,'')))<10
  then raise exception 'Суд должен обосновать связь поправки с вопросами своего ведения';end if;
 if p_old_text is null or length(trim(p_old_text))=0 or length(p_old_text)>120000
  or p_new_text is null or length(p_new_text)>120000 or p_old_text=p_new_text
  then raise exception 'Укажите точный непустой фрагмент и отличающуюся новую редакцию';end if;
 if length(trim(coalesce(p_rationale,'')))<10 or length(p_rationale)>4000 or length(coalesce(p_competence_note,''))>4000
  then raise exception 'Заполните обоснование поправки (10–4000 знаков)';end if;
 position:=strpos(coalesce(d.body_text,''),p_old_text);
 if position=0 or strpos(substring(d.body_text from position+1),p_old_text)>0
  then raise exception 'Исходный фрагмент должен точно и однозначно встречаться в действующем тексте один раз';end if;
 if length(d.body_text)-length(p_old_text)+length(p_new_text)>120000 then raise exception 'Новая редакция превышает 120000 знаков';end if;
 insert into public.bill_amendments(game_id,document_id,author_id,subject_key,old_text,new_text,rationale,competence_note,source_body_text,quote_start)
 values(d.game_id,d.id,uid,p_subject_key,p_old_text,p_new_text,trim(p_rationale),trim(coalesce(p_competence_note,'')),d.body_text,position) returning id into amendment;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,uid,'Внесена поправка ко II чтению',d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,'Поправка '||amendment||' · '||trim(p_rationale));
 return amendment;
end;$$;

create or replace function public.withdraw_bill_amendment(p_amendment_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.bill_amendments%rowtype;d public.formal_documents%rowtype;uid uuid:=auth.uid();
begin
 select * into a from public.bill_amendments where id=p_amendment_id;
 perform private.lock_bill_amendment_actor(a.game_id,uid);
 select * into d from public.formal_documents where id=a.document_id for update;
 select * into a from public.bill_amendments where id=p_amendment_id for update;
 if a.id is null or a.author_id is distinct from uid or not private.bill_amendment_actor_available(a.game_id,uid)
  then raise exception 'Отозвать поправку может только её действующий автор';end if;
 if a.status<>'submitted' then raise exception 'Отзыв возможен только до голосования';end if;
 update public.bill_amendments set status='withdrawn',updated_at=now() where id=a.id;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,uid,'Автор отозвал поправку',d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,'Поправка '||a.id);
end;$$;

create or replace function public.reject_bill_amendment(p_amendment_id uuid,p_note text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.bill_amendments%rowtype;d public.formal_documents%rowtype;uid uuid:=auth.uid();
begin
 select * into a from public.bill_amendments where id=p_amendment_id;
 perform private.lock_bill_amendment_actor(a.game_id,uid);
 select * into d from public.formal_documents where id=a.document_id for update;
 select * into a from public.bill_amendments where id=p_amendment_id for update;
 if a.id is null or not private.can_manage_bill_amendments(a.document_id,uid) then raise exception 'Решение принимает председатель ГД или профильный комитет';end if;
 if a.status<>'submitted' then raise exception 'Поправка уже находится на голосовании или рассмотрена';end if;
 if length(trim(coalesce(p_note,'')))<10 or length(p_note)>4000 then raise exception 'Укажите причину невключения поправки (10–4000 знаков)';end if;
 update public.bill_amendments set status='rejected',review_note=trim(p_note),updated_at=now() where id=a.id;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,uid,'Поправка не включена в пакет',d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,'Поправка '||a.id||' · '||trim(p_note));
end;$$;

create or replace function public.open_bill_amendment_vote(p_document_id uuid,p_amendment_ids uuid[])
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;a public.bill_amendments%rowtype;uid uuid:=auth.uid();actor_game uuid;pack uuid;vote uuid;
 result_text text;vote_text text;vote_title text;count_selected integer;last_end integer:=0;position integer;
begin
 select game_id into actor_game from public.formal_documents where id=p_document_id;
 perform private.lock_bill_amendment_actor(actor_game,uid);
 select * into d from public.formal_documents where id=p_document_id for update;
 if d.id is null or d.game_id is distinct from actor_game or not private.can_manage_bill_amendments(d.id,uid) then raise exception 'Пакет выбирает председатель ГД или профильный комитет';end if;
 if d.status_code not in ('amendments','reading2') then raise exception 'Голосование по поправкам доступно только во II чтении';end if;
 if exists(select 1 from public.game_votes where formal_document_id=d.id and status='open')
  or exists(select 1 from public.bill_amendment_packs where document_id=d.id and status in ('opening','voting'))
  then raise exception 'Сначала завершите открытое голосование';end if;
 if p_amendment_ids is null or cardinality(p_amendment_ids) not between 1 and 100
  or exists(select 1 from unnest(p_amendment_ids) x where x is null)
  or (select count(distinct x) from unnest(p_amendment_ids) x)<>cardinality(p_amendment_ids)
  then raise exception 'Выберите 1–100 разных поправок';end if;
 select count(*) into count_selected from public.bill_amendments where id=any(p_amendment_ids) and document_id=d.id and game_id=d.game_id and status='submitted';
 if count_selected<>cardinality(p_amendment_ids) then raise exception 'Пакет содержит чужую или уже рассмотренную поправку';end if;
 vote_text:='Законопроект '||d.registry_no||': '||d.title||E'\nПакет поправок ко II чтению. Голосование не завершает чтение законопроекта.\n';
 for a in select * from public.bill_amendments where id=any(p_amendment_ids) order by quote_start,id for update loop
  if a.source_body_text is distinct from d.body_text then raise exception 'Текст изменился после внесения поправки; требуется отзыв и новая поправка';end if;
  position:=strpos(d.body_text,a.old_text);
  if position<>a.quote_start or position=0 or strpos(substring(d.body_text from position+1),a.old_text)>0 then raise exception 'Исходный фрагмент поправки изменился или неоднозначен';end if;
  if position<=last_end then raise exception 'Выбранные поправки перекрывают один и тот же фрагмент';end if;
  last_end:=position+length(a.old_text)-1;
  vote_text:=vote_text||E'\nПоправка '||a.id||E'\nБыло: '||a.old_text||E'\nПредлагается: '||a.new_text||E'\nОбоснование: '||a.rationale||case when a.competence_note<>'' then E'\nВопросы ведения суда: '||a.competence_note else '' end||E'\n';
 end loop;
 result_text:=d.body_text;
 -- Apply from the right: replacements cannot shift the next quote or replace
 -- identical words introduced by another amendment in the same pack.
 for a in select * from public.bill_amendments where id=any(p_amendment_ids) order by quote_start desc,id loop
  result_text:=overlay(result_text placing a.new_text from a.quote_start for length(a.old_text));
 end loop;
 if length(trim(result_text))=0 or length(result_text)>120000 then raise exception 'Итоговый текст должен содержать 1–120000 знаков';end if;
 vote_title:='Поправки ко II чтению · '||d.registry_no;
 insert into public.bill_amendment_packs(game_id,document_id,amendment_ids,created_by,vote_title,vote_body,source_status,source_body_text,result_body_text)
 values(d.game_id,d.id,p_amendment_ids,uid,vote_title,vote_text,d.status_code,d.body_text,result_text) returning id into pack;
 -- The verified opening pack is visible only in this transaction. Existing
 -- BEFORE INSERT metadata/electorate triggers still take the GD snapshot.
 perform set_config('app.vote_group','',true);
 insert into public.game_votes(game_id,stage_no,title,body,voting_mode,created_by,
  formal_document_id,formal_step_code,institution_key,procedure_key,quorum_kind,quorum_value,
  majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(d.game_id,(select current_round from public.games where id=d.game_id),vote_title,vote_text,'mandate',uid,
  null,null,'gd','bill_amendments','fraction',0.5,
  case when d.doc_type='fkz_bill' then 'eligible_fraction' else 'eligible_majority' end,
  case when d.doc_type='fkz_bill' then 2.0/3 else 0.5::numeric end,true,false,'none','none') returning id into vote;
 update public.bill_amendment_packs set status='voting',vote_id=vote where id=pack;
 update public.bill_amendments set status='voting',vote_id=vote,updated_at=now() where id=any(p_amendment_ids);
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,uid,'Открыто голосование по пакету поправок',d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,'Пакет '||pack||' · голосование '||vote);
 return vote;
end;$$;

create or replace function private.bill_amendment_vote_closed()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.bill_amendment_packs%rowtype;d public.formal_documents%rowtype;v_revision integer;uid uuid:=auth.uid();
begin
 if new.procedure_key is distinct from 'bill_amendments' then return new;end if;
 if new.status<>'closed' or old.status='closed' then return new;end if;
 select * into p from public.bill_amendment_packs where vote_id=new.id;
 if p.id is null then return new;end if;
 perform private.lock_bill_amendment_actor(p.game_id,uid);
 select * into d from public.formal_documents where id=p.document_id for update;
 select * into p from public.bill_amendment_packs where vote_id=new.id for update;
 if p.status<>'voting' then raise exception 'Пакет поправок уже рассмотрен';end if;
 if not private.can_manage_bill_amendments(d.id,uid) then raise exception 'Нет полномочий для завершения голосования по поправкам';end if;
 if new.formal_document_id is not null or new.game_id<>p.game_id or new.procedure_key<>'bill_amendments'
  or new.result_code not in ('passed','rejected','no_quorum') then raise exception 'Некорректная связь голосования с пакетом поправок';end if;
 if d.body_text is distinct from p.source_body_text or d.status_code is distinct from p.source_status then raise exception 'Законопроект изменился во время голосования';end if;
 if new.result_code='passed' then
  if not coalesce(new.result_quorum_met,false) then raise exception 'Поправки не могут быть приняты без кворума';end if;
  v_revision:=coalesce((d.metadata->>'revision')::integer,1);
  insert into public.formal_document_revisions(game_id,document_id,revision,title,body_text,metadata,editor_id)
  values(d.game_id,d.id,v_revision,d.title,d.body_text,d.metadata,uid) on conflict(document_id,revision) do nothing;
  update public.bill_amendment_packs set status='accepted',decided_at=now() where id=p.id;
  update public.bill_amendments set status='accepted',applied_at=now(),updated_at=now() where id=any(p.amendment_ids) and status='voting' and vote_id=new.id;
  update public.formal_documents set body_text=p.result_body_text,metadata=coalesce(metadata,'{}')||jsonb_build_object('revision',v_revision+1,'bill_amendment_pack_id',p.id),updated_at=now() where id=d.id;
 elsif new.result_code='no_quorum' then
  update public.bill_amendment_packs set status='no_quorum',decided_at=now() where id=p.id;
  update public.bill_amendments set status='submitted',updated_at=now() where id=any(p.amendment_ids) and status='voting' and vote_id=new.id;
 else
  update public.bill_amendment_packs set status='rejected',decided_at=now() where id=p.id;
  update public.bill_amendments set status='rejected',review_note=coalesce(new.decision_note,new.result_label),updated_at=now() where id=any(p.amendment_ids) and status='voting' and vote_id=new.id;
 end if;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 values(d.id,d.game_id,uid,case new.result_code when 'passed' then 'Принятые поправки включены в текст' when 'no_quorum' then 'Нет кворума: поправки возвращены на рассмотрение' else 'Пакет поправок отклонён' end,d.status_code,d.status_code,d.current_owner_key,d.current_owner_key,'Пакет '||p.id||' · голосование '||new.id||' · '||coalesce(new.result_label,new.result_code));
 return new;
end;$$;
create trigger bill_amendment_vote_closed after update of status on public.game_votes for each row execute function private.bill_amendment_vote_closed();

create or replace function private.guard_bill_amendment_vote()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.bill_amendment_packs%rowtype;d public.formal_documents%rowtype;eligible numeric;present numeric;yes_votes numeric;quorum boolean;result text;
begin
 if old.procedure_key is distinct from 'bill_amendments' then return new;end if;
 select * into p from public.bill_amendment_packs where vote_id=old.id;
 if p.id is null then return new;end if;
 if old.status='closed' and to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'Итог поправочного голосования зафиксирован';end if;
 if new.game_id is distinct from old.game_id or new.formal_document_id is not null
  or new.procedure_key is distinct from old.procedure_key or new.institution_key is distinct from old.institution_key
  or new.voting_mode is distinct from old.voting_mode or new.electorate_snapshot is distinct from old.electorate_snapshot
  or new.quorum_kind is distinct from old.quorum_kind or new.quorum_value is distinct from old.quorum_value
  or new.majority_kind is distinct from old.majority_kind or new.majority_value is distinct from old.majority_value
  or new.allow_abstain is distinct from old.allow_abstain or new.tie_breaker_chair is distinct from old.tie_breaker_chair
  or new.pass_transition is distinct from 'none' or new.fail_transition is distinct from 'none'
  or new.body is distinct from p.vote_body or new.title is distinct from p.vote_title
  then raise exception 'Состав, пороги и текст поправочного голосования зафиксированы';end if;
 if new.status='closed' and old.status='open' then
  perform private.lock_bill_amendment_actor(p.game_id,auth.uid());
  select * into d from public.formal_documents where id=p.document_id for update;
  if not private.can_manage_bill_amendments(p.document_id,auth.uid()) then raise exception 'Нет полномочий для завершения пакета';end if;
  eligible:=private.vote_total_eligible_weight(old);present:=private.vote_present_weight(old);
  select coalesce(sum(coalesce(yes_weight,case when choice='yes' then weight else 0 end)),0) into yes_votes from public.game_ballots where vote_id=old.id;
  quorum:=eligible>0 and present>=floor(eligible/2)+1;
  result:=case when not quorum then 'no_quorum'
   when case when d.doc_type='fkz_bill' then yes_votes*3>=eligible*2 else yes_votes>eligible/2 end then 'passed' else 'rejected' end;
  if new.result_code is distinct from result or new.result_quorum_met is distinct from quorum
   then raise exception 'Итог должен соответствовать зарегистрированным депутатам и поданным голосам';end if;
 end if;
 return new;
end;$$;
create trigger guard_bill_amendment_vote before update on public.game_votes for each row execute function private.guard_bill_amendment_vote();

create or replace function private.guard_bill_amendment_document()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if tg_op='DELETE' then
  -- FK cascades from games run after the parent row has gone. Preserve the
  -- audit of a live classroom, while allowing complete classroom deletion.
  if exists(select 1 from public.games where id=old.game_id)
   and exists(select 1 from public.bill_amendments where document_id=old.id)
   then raise exception 'Законопроект с историей поправок сохраняется в реестре до удаления игры';end if;
  return old;
 end if;
 if exists(select 1 from public.bill_amendments where document_id=old.id and status in ('submitted','voting'))
  and (new.status_code is distinct from old.status_code or new.current_step is distinct from old.current_step
   or new.current_owner_key is distinct from old.current_owner_key or new.workflow_steps is distinct from old.workflow_steps
   or new.doc_type is distinct from old.doc_type or new.workflow_key is distinct from old.workflow_key or new.game_id is distinct from old.game_id)
  then raise exception 'Сначала рассмотрите или отзовите все поправки ко II чтению';end if;
 if (new.body_text is distinct from old.body_text or new.title is distinct from old.title or new.metadata->>'revision' is distinct from old.metadata->>'revision')
  and exists(select 1 from public.bill_amendment_packs where document_id=old.id and status in ('opening','voting'))
  then raise exception 'Текст законопроекта зафиксирован до завершения голосования по поправкам';end if;
 return new;
end;$$;
create trigger guard_bill_amendment_document before update or delete on public.formal_documents for each row execute function private.guard_bill_amendment_document();

create or replace function private.guard_bill_amendment_delete()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if exists(select 1 from public.games where id=old.game_id) then raise exception 'История поправок сохраняется; до голосования автор может отозвать поправку';end if;
 return old;
end;$$;
create trigger guard_bill_amendment_delete before delete on public.bill_amendments for each row execute function private.guard_bill_amendment_delete();
create trigger guard_bill_amendment_pack_delete before delete on public.bill_amendment_packs for each row execute function private.guard_bill_amendment_delete();

-- This new protocol is reserved for a verified opening pack. Legacy procedure
-- keys return immediately; none of their creation rules or functions change.
create or replace function private.guard_bill_amendment_vote_insert()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.bill_amendment_packs%rowtype;d public.formal_documents%rowtype;uid uuid:=auth.uid();
begin
 if new.procedure_key is distinct from 'bill_amendments' then return new;end if;
 if uid is null or new.created_by is distinct from uid then raise exception 'Поправочное голосование открывается только из проверенного пакета';end if;
 perform private.lock_bill_amendment_actor(new.game_id,uid);
 select * into p from public.bill_amendment_packs where game_id=new.game_id and created_by=uid
  and status='opening' and vote_id is null and vote_title=new.title and vote_body=new.body order by created_at,id limit 1;
 if p.id is null then raise exception 'Поправочное голосование открывается только из проверенного пакета';end if;
 select * into d from public.formal_documents where id=p.document_id for update;
 select * into p from public.bill_amendment_packs where id=p.id for update;
 if d.id is null or d.game_id is distinct from new.game_id or d.workflow_key is distinct from 'bill'
  or d.status_code not in ('amendments','reading2') or d.status_code is distinct from p.source_status
  or d.body_text is distinct from p.source_body_text or not private.can_manage_bill_amendments(d.id,uid)
  or p.status is distinct from 'opening' or p.vote_id is not null
  or new.status is distinct from 'open' or new.formal_document_id is not null or new.formal_step_code is not null
  or new.institution_key is distinct from 'gd' or new.voting_mode is distinct from 'mandate'
  or new.stage_no is distinct from (select current_round from public.games where id=new.game_id)
  or new.quorum_kind is distinct from 'fraction' or new.quorum_value is distinct from 0.5::numeric
  or new.majority_kind is distinct from (case when d.doc_type='fkz_bill' then 'eligible_fraction' else 'eligible_majority' end)
  or new.majority_value is distinct from (case when d.doc_type='fkz_bill' then 2.0/3 else 0.5::numeric end)
  or new.allow_abstain is distinct from true or new.tie_breaker_chair is distinct from false
  or new.pass_transition is distinct from 'none' or new.fail_transition is distinct from 'none'
  or nullif(current_setting('app.vote_group',true),'') is not null or new.group_name is not null
  or new.title is distinct from p.vote_title or new.body is distinct from p.vote_body
  then raise exception 'Состав, пороги и текст поправочного голосования должны соответствовать проверенному пакету';end if;
 return new;
end;$$;
create trigger guard_bill_amendment_vote_insert before insert on public.game_votes for each row execute function private.guard_bill_amendment_vote_insert();

create or replace function private.guard_bill_second_reading_vote()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;
begin
 if new.formal_document_id is null then return new;end if;
 select * into d from public.formal_documents where id=new.formal_document_id for update;
 if d.workflow_key='bill' and d.status_code in ('amendments','reading2')
  and exists(select 1 from public.bill_amendments where document_id=d.id and status in ('submitted','voting'))
  then raise exception 'Голосование по законопроекту доступно после рассмотрения всех поправок';end if;
 return new;
end;$$;
create trigger guard_bill_second_reading_vote before insert on public.game_votes for each row execute function private.guard_bill_second_reading_vote();

alter table public.bill_amendments enable row level security;
alter table public.bill_amendment_packs enable row level security;
revoke all on table public.bill_amendments,public.bill_amendment_packs from public,anon,authenticated;
grant select on table public.bill_amendments,public.bill_amendment_packs to authenticated;
create policy bill_amendments_member_read on public.bill_amendments for select to authenticated using(exists(select 1 from public.game_members m where m.game_id=bill_amendments.game_id and m.user_id=auth.uid() and m.roster_archived_at is null));
create policy bill_amendment_packs_member_read on public.bill_amendment_packs for select to authenticated using(exists(select 1 from public.game_members m where m.game_id=bill_amendment_packs.game_id and m.user_id=auth.uid() and m.roster_archived_at is null));

revoke all on function private.bill_amendment_actor_available(uuid,uuid),private.lock_bill_amendment_actor(uuid,uuid),private.can_manage_bill_amendments(uuid,uuid),private.bill_amendment_vote_context(uuid,uuid,text,text),private.bill_amendment_vote_closed(),private.guard_bill_amendment_vote(),private.guard_bill_amendment_document(),private.guard_bill_amendment_delete(),private.guard_bill_amendment_vote_insert(),private.guard_bill_second_reading_vote() from public,anon,authenticated;
revoke all on function public.get_bill_amendments(uuid),public.submit_bill_amendment(uuid,text,text,text,text,text),public.withdraw_bill_amendment(uuid),public.reject_bill_amendment(uuid,text),public.open_bill_amendment_vote(uuid,uuid[]),public.close_bill_amendment_vote(uuid,text) from public,anon,authenticated;
grant execute on function public.get_bill_amendments(uuid),public.submit_bill_amendment(uuid,text,text,text,text,text),public.withdraw_bill_amendment(uuid),public.reject_bill_amendment(uuid,text),public.open_bill_amendment_vote(uuid,uuid[]),public.close_bill_amendment_vote(uuid,text) to authenticated;

do $$begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bill_amendments')then alter publication supabase_realtime add table public.bill_amendments;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bill_amendment_packs')then alter publication supabase_realtime add table public.bill_amendment_packs;end if;
end;$$;
