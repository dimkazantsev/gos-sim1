-- Current-classroom proposals during preparation, before the budget becomes an NPA.
-- Preliminary votes use the existing mandate, attendance and GV machinery.
create table public.budget_faction_amendments (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 plan_id uuid not null references public.budget_simulator_plans(id) on delete cascade,
 party_id uuid references public.game_parties(id) on delete set null,
 party_name text not null,
 created_by uuid not null references auth.users(id),
 title text not null check(length(title) between 3 and 160),
 reason text not null check(length(reason) between 30 and 6000),
 from_section text not null,
 to_section text not null check(to_section<>from_section),
 amount numeric not null check(amount>0 and amount<=1000000),
 base_revision integer not null,
 base_calculation jsonb not null,
 proposal_draft jsonb not null,
 proposal_calculation jsonb not null,
 status text not null default 'submitted' check(status in ('submitted','withdrawn','applied')),
 vote_id uuid unique references public.game_votes(id) on delete restrict,
 applied_revision integer,
 applied_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 applied_at timestamptz
);
create index budget_faction_amendments_game_created on public.budget_faction_amendments(game_id,created_at desc);
create index budget_faction_amendments_plan on public.budget_faction_amendments(plan_id);
create index budget_faction_amendments_party on public.budget_faction_amendments(party_id);
create index budget_faction_amendments_author on public.budget_faction_amendments(created_by);
create index budget_faction_amendments_applied_by on public.budget_faction_amendments(applied_by);
alter table public.budget_faction_amendments enable row level security;
revoke all on public.budget_faction_amendments from public,anon,authenticated;
grant select on public.budget_faction_amendments to authenticated;
create policy budget_amendment_member_read on public.budget_faction_amendments for select to authenticated using(private.is_game_member(game_id));
alter publication supabase_realtime add table public.budget_faction_amendments;

create function private.preview_budget_amendment(p_plan uuid,p_from text,p_to text,p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare pl budget_simulator_plans%rowtype;b jsonb;c jsonb;n jsonb;nc jsonb;f numeric;t numeric;cost numeric;available numeric;protected numeric;fp numeric;tp numeric;
begin
 select * into pl from budget_simulator_plans where id=p_plan;
 if pl.id is null or pl.status<>'draft' then raise exception 'Поправки готовятся к общему черновику. Для внесенного НПА создайте новый расчет.';end if;
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount not between .01 and 1000000 then raise exception 'Укажите сумму от 0,01 млн ₽ до 1 000 млрд ₽.';end if;
 if p_from is null or p_to is null or p_from=p_to or p_from='13' or p_to='13' then raise exception 'Выберите два разных раздела. Обслуживание долга не перераспределяется этой формой.';end if;
 select data into b from private.budget_baseline where year=2026;
 select (l->>'amount')::numeric into f from jsonb_array_elements(b->'expense_lines') l where l->>'key'=p_from;
 select (l->>'amount')::numeric into t from jsonb_array_elements(b->'expense_lines') l where l->>'key'=p_to;
 if f is null or t is null then raise exception 'Выберите разделы из бюджетной классификации.';end if;
 c:=private.calculate_budget_simulator(pl.game_id,pl.draft);cost:=(c->>'cost')::numeric;
 select (l->>'amount')::numeric into available from jsonb_array_elements(c->'expense_lines') l where l->>'key'=p_from;
 select coalesce(sum(r.amount),0) into protected from budget_transfer_requests r where r.game_id=pl.game_id and pl.draft->'transfer_ids' ? r.id::text and r.status<>'rejected' and r.kind<>'budget_credit' and r.section_key=p_from;
 if p_amount>available-protected then raise exception 'Нельзя сокращать включенные в проект целевые трансферты. Выберите другой источник или меньшую сумму.';end if;
 fp:=coalesce((pl.draft->'spending_changes'->>p_from)::numeric,0)-p_amount/(f*cost)*100;
 tp:=coalesce((pl.draft->'spending_changes'->>p_to)::numeric,0)+p_amount/(t*cost)*100;
 if fp< -80 or tp>200 then raise exception 'Перераспределение выходит за пределы модели: от −80 %% до +200 %% к исходным расходам раздела. Уменьшите сумму.';end if;
 n:=jsonb_set(pl.draft,'{spending_changes}',(pl.draft->'spending_changes')||jsonb_build_object(p_from,fp,p_to,tp));
 nc:=private.calculate_budget_simulator(pl.game_id,n);
 if abs((nc->>'expenditure')::numeric-(c->>'expenditure')::numeric)>.02 or nc->'income_lines' is distinct from c->'income_lines' then raise exception 'Изменились финансовые условия. Обновите расчет и направьте поправку заново.';end if;
 return jsonb_build_object('draft',n,'base',c,'proposal',nc);
end$$;
revoke all on function private.preview_budget_amendment(uuid,text,text,numeric) from public,anon,authenticated;

create function public.submit_budget_amendment(p_plan_id uuid,p_revision integer,p_party_id uuid,p_title text,p_reason text,p_from text,p_to text,p_amount numeric)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare pl budget_simulator_plans%rowtype;party game_parties%rowtype;name text;j jsonb;id uuid;uid uuid:=auth.uid();
begin
 select * into pl from budget_simulator_plans where id=p_plan_id;
 if uid is null or pl.id is null or not private.is_game_member(pl.game_id) then raise exception 'Нет доступа к бюджетному расчету этой игры.';end if;
 if not private.is_game_teacher(pl.game_id) and not exists(select 1 from game_members where game_id=pl.game_id and user_id=uid and kind='student') then raise exception 'Наблюдатель может читать предложения, но не направлять их.';end if;
 if not private.is_game_teacher(pl.game_id) and not private.role_is_available(pl.game_id,uid) then raise exception 'Во время отстранения нельзя направлять поправки.';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||pl.game_id::text,0));
 select * into pl from budget_simulator_plans where id=p_plan_id for update;
 if p_revision is distinct from pl.revision then raise exception 'Общий расчет изменен. Откройте последнюю редакцию и проверьте поправку заново.';end if;
 if p_party_id is not null then
  select * into party from game_parties where id=p_party_id and game_id=pl.game_id and registration_status='registered';
  if party.id is null then raise exception 'Выберите зарегистрированную фракцию этой игры.';end if;
  if not private.is_game_teacher(pl.game_id) and not exists(select 1 from game_members where game_id=pl.game_id and user_id=uid and team=party.name) then raise exception 'Можно направлять предложения только своей фракции.';end if;
  name:=party.name;
 else
  if not private.is_game_teacher(pl.game_id) then raise exception 'Выберите свою зарегистрированную фракцию.';end if;
  name:='Преподаватель';
 end if;
 if p_title is null or length(trim(p_title)) not between 3 and 160 or p_reason is null or length(trim(p_reason)) not between 30 and 6000 then raise exception 'Укажите название (3–160 символов) и обоснование (30–6 000 символов).';end if;
 j:=private.preview_budget_amendment(pl.id,p_from,p_to,round(p_amount,2));
 select a.id into id from budget_faction_amendments a left join game_votes v on v.id=a.vote_id where a.plan_id=pl.id and a.base_revision=pl.revision and a.party_id is not distinct from p_party_id and a.from_section=p_from and a.to_section=p_to and a.amount=round(p_amount,2) and a.status='submitted' and (a.vote_id is null or v.status='open') and a.base_calculation=j->'base' order by a.created_at limit 1;
 if id is not null then return id;end if;
 insert into budget_faction_amendments(game_id,plan_id,party_id,party_name,created_by,title,reason,from_section,to_section,amount,base_revision,base_calculation,proposal_draft,proposal_calculation)
 values(pl.game_id,pl.id,p_party_id,name,uid,trim(p_title),trim(p_reason),p_from,p_to,round(p_amount,2),pl.revision,j->'base',j->'draft',j->'proposal') returning budget_faction_amendments.id into id;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(pl.game_id,'amendment','Предложена поправка: '||name||' · '||trim(p_title),round(p_amount,2),'amendment-submit:'||id);
 return id;
end$$;

create function public.get_budget_amendments(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare parties jsonb;rows jsonb;teacher boolean;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then raise exception 'Нет доступа к поправкам этой игры.';end if;
 teacher:=private.is_game_teacher(p_game_id);
 select coalesce(jsonb_agg(p.id),'[]') into parties from game_parties p where p.game_id=p_game_id and p.registration_status='registered' and (teacher or (private.role_is_available(p_game_id,auth.uid()) and exists(select 1 from game_members m where m.game_id=p_game_id and m.user_id=auth.uid() and m.kind='student' and m.team=p.name)));
 with current_calculations as materialized (select p.id,case when p.status='draft' then private.calculate_budget_simulator(p.game_id,p.draft) else '{}'::jsonb end as calc from budget_simulator_plans p where p.game_id=p_game_id)
 select coalesce(jsonb_agg(r order by r.created_at desc),'[]') into rows from (
  select a.*,pl.title as plan_title,pl.document_id,coalesce(m.full_name,'Участник') as author_name,v.status as vote_status,v.result_code as vote_result,v.result_yes as vote_yes,v.result_no as vote_no,v.result_abstain as vote_abstain,v.result_eligible as vote_eligible,
   (pl.status<>'draft' or pl.revision<>a.base_revision or cc.calc is distinct from a.base_calculation) as stale
  from budget_faction_amendments a join budget_simulator_plans pl on pl.id=a.plan_id join current_calculations cc on cc.id=pl.id left join game_members m on m.game_id=a.game_id and m.user_id=a.created_by left join game_votes v on v.id=a.vote_id
  where a.game_id=p_game_id order by a.created_at desc limit 200
 ) r;
 return jsonb_build_object('amendments',rows,'party_ids',parties,'can_open',teacher,'can_apply',private.can_prepare_budget(p_game_id),'can_submit_neutral',teacher);
end$$;

create function public.open_budget_amendment_vote(p_amendment_id uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a budget_faction_amendments%rowtype;pl budget_simulator_plans%rowtype;vote_uuid uuid;
begin
 select * into a from budget_faction_amendments where id=p_amendment_id;
 if a.id is null or auth.uid() is null or not private.is_game_teacher(a.game_id) then raise exception 'Предварительное голосование открывает преподаватель этой игры.';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||a.game_id::text,0));
 select * into a from budget_faction_amendments where id=p_amendment_id for update;
 if a.vote_id is not null then return a.vote_id;end if;
 select * into pl from budget_simulator_plans where id=a.plan_id;
 if a.status<>'submitted' or pl.status<>'draft' or pl.revision<>a.base_revision then raise exception 'Поправка отозвана или исходный расчет изменен. Направьте новое предложение.';end if;
 if private.calculate_budget_simulator(a.game_id,pl.draft) is distinct from a.base_calculation then raise exception 'Изменились финансовые условия. Пересчитайте и направьте поправку заново.';end if;
 vote_uuid:=public.create_procedural_vote(a.game_id,'Бюджетная поправка: '||a.title,
  a.party_name||E'\n'||a.reason||E'\nПерераспределение: раздел '||a.from_section||' → раздел '||a.to_section||' · '||a.amount||E' млн ₽.\nОбщий объем расходов, доходы и источники дефицита сохраняются.\nПредварительное рассмотрение при подготовке общего проекта. Результат не заменяет чтения закона о бюджете и не меняет действующий бюджет.',
  'mandate','gd','budget_preparation_amendment','fraction',.5,'eligible_majority',.5,true,false,null,'none','none');
 update game_votes set stage_no=13 where game_votes.id=vote_uuid;
 update budget_faction_amendments set vote_id=vote_uuid where budget_faction_amendments.id=a.id;
 return vote_uuid;
end$$;

create function public.apply_budget_amendment(p_amendment_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a budget_faction_amendments%rowtype;pl budget_simulator_plans%rowtype;v game_votes%rowtype;r jsonb;d jsonb;
begin
 select * into a from budget_faction_amendments where id=p_amendment_id;
 if a.id is null or not private.can_prepare_budget(a.game_id) then raise exception 'Поправку включает преподаватель или бюджетная команда исполнительной власти этой игры.';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||a.game_id::text,0));
 select * into a from budget_faction_amendments where id=p_amendment_id for update;
 select * into pl from budget_simulator_plans where id=a.plan_id for update;
 if a.status='applied' then return jsonb_build_object('id',pl.id,'revision',pl.revision,'draft',pl.draft,'already_applied',true);end if;
 select * into v from game_votes where id=a.vote_id;
 if a.status<>'submitted' or v.id is null or v.status<>'closed' or v.result_code<>'passed' or v.game_id<>a.game_id or v.procedure_key<>'budget_preparation_amendment' then raise exception 'Сначала завершите связанное голосование. Включается только одобренная поправка.';end if;
 if pl.status<>'draft' or pl.revision<>a.base_revision then raise exception 'Общий расчет изменен или уже внесен как НПА. Направьте поправку к новой редакции.';end if;
 if private.calculate_budget_simulator(a.game_id,pl.draft) is distinct from a.base_calculation then raise exception 'Изменились финансовые условия. Пересчитайте и направьте поправку заново.';end if;
 d:=jsonb_set(a.proposal_draft,'{note}',to_jsonb(coalesce(a.proposal_draft->>'note','')||E'\n\nПоправка '||a.party_name||': '||a.title||E'\n'||a.reason));
 r:=public.save_budget_simulator(a.game_id,pl.id,d,pl.revision);
 update budget_faction_amendments set status='applied',applied_revision=(r->>'revision')::integer,applied_by=auth.uid(),applied_at=now() where id=a.id;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(a.game_id,'amendment','Включена одобренная поправка: '||a.party_name||' · '||a.title||'. Изменен общий черновик; действие бюджета ожидает принятия НПА.',a.amount,'amendment-apply:'||a.id);
 return r||jsonb_build_object('draft',d);
end$$;

create function public.withdraw_budget_amendment(p_amendment_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a budget_faction_amendments%rowtype;
begin
 select * into a from budget_faction_amendments where id=p_amendment_id;
 if a.id is null or auth.uid() is null or not private.is_game_member(a.game_id) or not (private.is_game_teacher(a.game_id) or (a.created_by=auth.uid() and exists(select 1 from game_members where game_id=a.game_id and user_id=auth.uid() and kind='student'))) then raise exception 'Отозвать предложение может его автор или преподаватель этой игры.';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:'||a.game_id::text,0));
 select * into a from budget_faction_amendments where id=p_amendment_id for update;
 if a.status='withdrawn' then return;end if;
 if a.status<>'submitted' or a.vote_id is not null then raise exception 'После открытия голосования предложение сохраняется вместе с результатом.';end if;
 update budget_faction_amendments set status='withdrawn' where id=a.id;
end$$;

revoke all on function public.submit_budget_amendment(uuid,integer,uuid,text,text,text,text,numeric),public.get_budget_amendments(uuid),public.open_budget_amendment_vote(uuid),public.apply_budget_amendment(uuid),public.withdraw_budget_amendment(uuid) from public,anon;
grant execute on function public.submit_budget_amendment(uuid,integer,uuid,text,text,text,text,numeric),public.get_budget_amendments(uuid),public.open_budget_amendment_vote(uuid),public.apply_budget_amendment(uuid),public.withdraw_budget_amendment(uuid) to authenticated;
comment on table public.budget_faction_amendments is 'Financially neutral reallocation proposals before an NPA is created. Voting does not enact a budget.';
