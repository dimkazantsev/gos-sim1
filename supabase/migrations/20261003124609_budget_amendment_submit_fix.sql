CREATE OR REPLACE FUNCTION public.submit_budget_amendment(p_plan_id uuid, p_revision integer, p_party_id uuid, p_title text, p_reason text, p_from text, p_to text, p_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare pl budget_simulator_plans%rowtype;party game_parties%rowtype;name text;j jsonb;amendment_uuid uuid;uid uuid:=auth.uid();
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
 select a.id into amendment_uuid from budget_faction_amendments a left join game_votes v on v.id=a.vote_id where a.plan_id=pl.id and a.base_revision=pl.revision and a.party_id is not distinct from p_party_id and a.from_section=p_from and a.to_section=p_to and a.amount=round(p_amount,2) and a.status='submitted' and (a.vote_id is null or v.status='open') and a.base_calculation=j->'base' order by a.created_at limit 1;
 if amendment_uuid is not null then return amendment_uuid;end if;
 insert into budget_faction_amendments(game_id,plan_id,party_id,party_name,created_by,title,reason,from_section,to_section,amount,base_revision,base_calculation,proposal_draft,proposal_calculation)
 values(pl.game_id,pl.id,p_party_id,name,uid,trim(p_title),trim(p_reason),p_from,p_to,round(p_amount,2),pl.revision,j->'base',j->'draft',j->'proposal') returning budget_faction_amendments.id into amendment_uuid;
 insert into budget_simulator_ledger(game_id,kind,note,amount,source_key) values(pl.game_id,'amendment','Предложена поправка: '||name||' · '||trim(p_title),round(p_amount,2),'amendment-submit:'||amendment_uuid);
 return amendment_uuid;
end$function$;
