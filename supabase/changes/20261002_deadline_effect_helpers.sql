-- Future teacher-recorded sanctions, shared on every screen. No historical reset.
alter table public.game_parties add column if not exists regional_seats_awarded integer check(regional_seats_awarded between 0 and 89);
alter table public.party_member_mandates add column if not exists representation_loss integer not null default 0 check(representation_loss>=0);
CREATE OR REPLACE FUNCTION private.rebalance_party_mandates(p_party uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.game_parties%rowtype;custom_ok boolean;loss integer;remaining integer;
begin
 select * into p from public.game_parties where id=p_party for update;
 if p.id is null then return;end if;
 delete from public.party_member_mandates a where a.party_id=p.id and not exists(select 1 from public.game_members m where m.game_id=p.game_id and m.user_id=a.user_id and m.kind='student' and m.team=p.name);
 custom_ok:=p.mandate_allocation_mode='custom'
 and (select coalesce(sum(base_mandates),0) from public.party_member_mandates where party_id=p.id)=p.mandates
 and not exists(select 1 from public.game_members m where m.game_id=p.game_id and m.kind='student' and m.team=p.name and not exists(select 1 from public.party_member_mandates a where a.party_id=p.id and a.user_id=m.user_id));
 if not custom_ok then
  update public.game_parties set mandate_allocation_mode='equal' where id=p.id and mandate_allocation_mode<>'equal';
  with ranked as (select user_id,row_number() over(order by coalesce(party_joined_at,joined_at),user_id) rn,count(*) over() n from public.game_members where game_id=p.game_id and kind='student' and team=p.name)
  insert into public.party_member_mandates(game_id,party_id,user_id,base_mandates,ghost_loss,effective_mandates,updated_at)
  select p.game_id,p.id,user_id,floor(p.mandates::numeric/n)::int+case when rn<=p.mandates%n then 1 else 0 end,0,0,now() from ranked
  on conflict(game_id,party_id,user_id) do update set base_mandates=excluded.base_mandates,updated_at=now();
 end if;
 loss:=least(greatest(0,p.ghost_loss_current),greatest(0,p.mandates));
 with shares as (select user_id,base_mandates,case when p.mandates>0 then loss*base_mandates::numeric/p.mandates else 0 end raw from public.party_member_mandates where party_id=p.id),
 ranked as (select *,row_number() over(order by raw-floor(raw) desc,user_id) rn,loss-sum(floor(raw)) over() remainder from shares),
 calculated as (select user_id,floor(raw)::int+case when rn<=remainder then 1 else 0 end deduction from ranked)
 update public.party_member_mandates a set ghost_loss=c.deduction,effective_mandates=a.base_mandates-c.deduction,updated_at=now() from calculated c where a.party_id=p.id and a.user_id=c.user_id;
 remaining:=greatest(0,p.mandates-loss);
 loss:=least(greatest(0,p.representation_penalty),remaining);
 with shares as (
  select user_id,base_mandates-ghost_loss available,
   case when remaining>0 then loss*(base_mandates-ghost_loss)::numeric/remaining else 0 end raw
  from party_member_mandates where party_id=p.id
 ),ranked as (
  select *,row_number() over(order by raw-floor(raw) desc,user_id) rn,
   loss-sum(floor(raw)) over() remainder from shares
 ),calculated as (
  select user_id,floor(raw)::int+case when rn<=remainder then 1 else 0 end deduction from ranked
 )
 update party_member_mandates a set representation_loss=c.deduction,
 effective_mandates=greatest(0,a.base_mandates-a.ghost_loss-c.deduction),updated_at=now()
 from calculated c where a.party_id=p.id and a.user_id=c.user_id;
 -- Already-open votes retain the electorate and weights captured at their opening.
end;$function$;

CREATE OR REPLACE FUNCTION public.record_deadline_consequence(p_game_id uuid, p_stage_no integer, p_party_id uuid, p_user_id uuid, p_consequence_type text, p_magnitude numeric, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare v_uid uuid:=(select auth.uid());v_id uuid;v_mag numeric:=coalesce(p_magnitude,0);
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Требуются права преподавателя'; end if;
 if p_consequence_type='representation_loss' and private.has_open_duma_mandate_vote(p_game_id) then raise exception 'Сначала завершите открытое голосование Государственной Думы';end if;
 if p_stage_no<1 or p_stage_no>16 then raise exception 'Номер этапа должен быть от 1 до 16'; end if;
 if p_party_id is null and p_user_id is null then raise exception 'Выберите партию или студента'; end if;
 if p_party_id is not null and not exists(select 1 from public.game_parties where id=p_party_id and game_id=p_game_id)
   then raise exception 'Партия не найдена в этой игре'; end if;
 if p_user_id is not null and not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_user_id)
   then raise exception 'Студент не найден в этой игре'; end if;
 if p_consequence_type not in ('representation_loss','regional_seat_loss','ghost_risk','presidential_rating_loss','other')
   then raise exception 'Неизвестный вид последствия'; end if;
 if length(trim(coalesce(p_note,'')))<5 then raise exception 'Укажите основание для применения последствия'; end if;
 if p_consequence_type<>'other' and v_mag<=0 then raise exception 'Укажите положительную величину последствия'; end if;
 if p_party_id is null and p_consequence_type<>'other' then raise exception 'Для этого последствия выберите партию'; end if;

 if p_consequence_type in ('representation_loss','regional_seat_loss') and (v_mag<>trunc(v_mag) or v_mag>case when p_consequence_type='representation_loss' then 450 else 89 end) then raise exception 'Потеря мест должна быть целой и не превышать число мест органа';end if;
 if p_consequence_type='presidential_rating_loss' and v_mag>100 then raise exception 'Снижение рейтинга не может превышать 100 процентных пунктов';end if;
 insert into public.stage_deadline_incidents(game_id,stage_no,party_id,user_id,consequence_type,magnitude,note,created_by)
 values(p_game_id,p_stage_no,p_party_id,p_user_id,p_consequence_type,p_magnitude,trim(p_note),v_uid)
 returning id into v_id;

 if p_party_id is not null then
  update public.game_parties
  set representation_penalty=representation_penalty+
        case when p_consequence_type='representation_loss' then ceil(v_mag)::integer else 0 end,
      regional_seat_penalty=regional_seat_penalty+
        case when p_consequence_type='regional_seat_loss' then ceil(v_mag)::integer else 0 end,
      ghost_risk_weight=greatest(0.1,ghost_risk_weight+
        case when p_consequence_type='ghost_risk' then v_mag else 0 end),
      presidential_rating_modifier=presidential_rating_modifier-
        case when p_consequence_type='presidential_rating_loss' then v_mag else 0 end
  where id=p_party_id;
 end if;

 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,p_stage_no,'Дедлайн','warning','Зафиксировано последствие за нарушение срока',
   trim(p_note),v_uid);

 return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revert_deadline_consequence(p_incident_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare i public.stage_deadline_incidents%rowtype;v_uid uuid:=(select auth.uid());v_mag numeric;
begin
 select * into i from public.stage_deadline_incidents where id=p_incident_id for update;
 if i.id is null then raise exception 'Запись о нарушении не найдена'; end if;
 if not private.is_game_teacher(i.game_id) then raise exception 'Требуются права преподавателя'; end if;
 if i.status='reverted' then return; end if;
 if i.consequence_type='representation_loss' and private.has_open_duma_mandate_vote(i.game_id) then raise exception 'Сначала завершите открытое голосование Государственной Думы';end if;
 v_mag:=coalesce(i.magnitude,0);

 if i.party_id is not null then
  update public.game_parties
  set representation_penalty=greatest(0,representation_penalty-
        case when i.consequence_type='representation_loss' then ceil(v_mag)::integer else 0 end),
      regional_seat_penalty=greatest(0,regional_seat_penalty-
        case when i.consequence_type='regional_seat_loss' then ceil(v_mag)::integer else 0 end),
      ghost_risk_weight=greatest(0.1,ghost_risk_weight-
        case when i.consequence_type='ghost_risk' then v_mag else 0 end),
      presidential_rating_modifier=presidential_rating_modifier+
        case when i.consequence_type='presidential_rating_loss' then v_mag else 0 end
  where id=i.party_id;
 end if;

 update public.stage_deadline_incidents set status='reverted',reverted_at=now(),reverted_by=v_uid where id=i.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_presidential_scorecard(p_candidate_id uuid, p_round_no integer, p_teacher_program_pct numeric, p_teacher_campaign_pct numeric, p_game_rating_pct numeric, p_poll_pct numeric, p_teacher_runoff_pct numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c public.presidential_candidates%rowtype;s public.presidential_election_settings%rowtype;
 v_uid uuid:=(select auth.uid());v_score numeric;v_den numeric;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id;
 if c.id is null then raise exception 'Candidate not found'; end if;
 if not private.is_game_teacher(c.game_id) then raise exception 'Teacher access required'; end if;
 if c.registration_status<>'registered' then raise exception 'Only registered candidates can be scored'; end if;
 if p_round_no not in (1,2) then raise exception 'Round must be 1 or 2'; end if;
 insert into public.presidential_election_settings(game_id,updated_by) values(c.game_id,v_uid)
 on conflict(game_id) do nothing;
 select * into s from public.presidential_election_settings where game_id=c.game_id;

 if p_round_no=1 then
  if p_teacher_program_pct is null or p_teacher_campaign_pct is null or p_game_rating_pct is null then
   raise exception 'Program, campaign and game rating percentages are required';
  end if;
  if s.poll_enabled and p_poll_pct is null then raise exception 'Poll percentage is required while poll component is enabled'; end if;
  v_den:=case when s.poll_enabled then 4 else 3 end;
  v_score:=(p_teacher_program_pct+p_teacher_campaign_pct+p_game_rating_pct+
    case when s.poll_enabled then p_poll_pct else 0 end)/v_den;
  v_score:=greatest(0,least(100,v_score-c.rating_penalty+coalesce((select presidential_rating_modifier from game_parties where id=c.party_id and game_id=c.game_id),0)));
 else
  if p_teacher_runoff_pct is null then raise exception 'Runoff teacher vote percentage is required'; end if;
  select computed_pct into v_score from public.presidential_scorecards where candidate_id=c.id and round_no=1;
  if v_score is null then raise exception 'Round 1 score is required'; end if;
  v_score:=(v_score+p_teacher_runoff_pct)/2;
 end if;

 insert into public.presidential_scorecards(
  game_id,candidate_id,round_no,teacher_program_pct,teacher_campaign_pct,game_rating_pct,poll_pct,teacher_runoff_pct,computed_pct,updated_by
 ) values(c.game_id,c.id,p_round_no,p_teacher_program_pct,p_teacher_campaign_pct,p_game_rating_pct,p_poll_pct,p_teacher_runoff_pct,round(v_score,2),v_uid)
 on conflict(candidate_id,round_no) do update set teacher_program_pct=excluded.teacher_program_pct,
  teacher_campaign_pct=excluded.teacher_campaign_pct,game_rating_pct=excluded.game_rating_pct,poll_pct=excluded.poll_pct,
  teacher_runoff_pct=excluded.teacher_runoff_pct,computed_pct=excluded.computed_pct,updated_at=now(),updated_by=v_uid;

 return round(v_score,2);
end;
$function$;

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
 values(r.game_id,3,'Региональные выборы','notice','Распределены 89 законодательных органов субъектов РФ',
   'Метод: '||r.method||'. Итог сохранён в партийных показателях.',v_uid);
 return v_result;
end;$function$;

create or replace function private.deadline_regional_seats() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if tg_op='INSERT' then new.regional_seats_awarded:=coalesce(new.regional_seats_awarded,new.regions);
 elsif new.regions is distinct from old.regions and new.regional_seats_awarded is not distinct from old.regional_seats_awarded then new.regional_seats_awarded:=new.regions;
 else new.regional_seats_awarded:=coalesce(new.regional_seats_awarded,old.regions);end if;
 new.regions:=greatest(0,new.regional_seats_awarded-new.regional_seat_penalty);
 return new;
end$$;
create or replace function private.deadline_party_effects() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s record;election_status text;
begin
 if new.representation_penalty is distinct from old.representation_penalty then
  if private.has_open_duma_mandate_vote(new.game_id) then raise exception 'Сначала завершите открытое голосование Государственной Думы';end if;
  perform private.rebalance_party_mandates(new.id);
 end if;
 if new.presidential_rating_modifier is distinct from old.presidential_rating_modifier then
  select status into election_status from presidential_election_settings where game_id=new.game_id;
  -- A completed election remains an historical result.
  if coalesce(election_status,'draft')<>'finished' then
   for s in select sc.* from presidential_scorecards sc join presidential_candidates c on c.id=sc.candidate_id where c.party_id=new.id and c.game_id=new.game_id order by sc.round_no,sc.id loop
    perform public.set_presidential_scorecard(s.candidate_id,s.round_no,s.teacher_program_pct,s.teacher_campaign_pct,s.game_rating_pct,s.poll_pct,s.teacher_runoff_pct);
   end loop;
  end if;
 end if;
 return new;
end$$;
revoke all on function private.deadline_regional_seats(),private.deadline_party_effects(),private.rebalance_party_mandates(uuid) from public,anon,authenticated;

