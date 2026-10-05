-- Unify stage deadline, score penalty and game consequence into one rule.
-- The violation UI only selects an addressee; sanction values are reused automatically.

alter table public.stage_deadline_rules
  add column if not exists consequence_type text not null default 'none',
  add column if not exists consequence_magnitude numeric;

alter table public.stage_deadline_rules
  drop constraint if exists stage_deadline_rules_consequence_type_check,
  add constraint stage_deadline_rules_consequence_type_check
    check (consequence_type in ('none','representation_loss','regional_seat_loss','ghost_risk','presidential_rating_loss'));

alter table public.stage_deadline_incidents
  add column if not exists penalty_points numeric not null default 0,
  add column if not exists penalty_description text not null default '';

alter table public.stage_deadline_incidents
  drop constraint if exists stage_deadline_incidents_penalty_points_check,
  add constraint stage_deadline_incidents_penalty_points_check
    check (penalty_points >= 0 and penalty_points <= 3);

create unique index if not exists stage_deadline_incidents_active_user_uidx
  on public.stage_deadline_incidents(game_id,stage_no,user_id)
  where status='active' and user_id is not null;

create unique index if not exists stage_deadline_incidents_active_party_uidx
  on public.stage_deadline_incidents(game_id,stage_no,party_id)
  where status='active' and party_id is not null;

create or replace function public.configure_stage_deadline_rule(
  p_game_id uuid,
  p_stage_no integer,
  p_deadline timestamptz,
  p_inclusive boolean,
  p_penalty_points numeric,
  p_penalty_description text,
  p_consequence_type text default 'none',
  p_consequence_magnitude numeric default null
)
returns void
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $function$
begin
  if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required'; end if;
  if p_stage_no not between 1 and 16 then raise exception 'Unknown stage'; end if;
  if p_penalty_points is null or p_penalty_points<0 or p_penalty_points>3 then raise exception 'Penalty must be between 0 and 3'; end if;
  if p_consequence_type not in ('none','representation_loss','regional_seat_loss','ghost_risk','presidential_rating_loss') then raise exception 'Unknown consequence type'; end if;
  if p_consequence_type<>'none' and coalesce(p_consequence_magnitude,0)<=0 then raise exception 'Set a positive consequence magnitude'; end if;
  if not exists(select 1 from public.game_stages where game_id=p_game_id and stage_no=p_stage_no) then raise exception 'Stage not found'; end if;

  insert into public.stage_deadline_rules(
    game_id,stage_no,deadline_at,inclusive,penalty_points,penalty_description,
    consequence_type,consequence_magnitude,updated_by,updated_at
  )
  values(
    p_game_id,p_stage_no,p_deadline,p_inclusive,p_penalty_points,
    coalesce(nullif(trim(p_penalty_description),''),'За несданный результат этапа к установленному сроку'),
    p_consequence_type,case when p_consequence_type='none' then null else p_consequence_magnitude end,
    auth.uid(),now()
  )
  on conflict(game_id,stage_no) do update set
    deadline_at=excluded.deadline_at,inclusive=excluded.inclusive,
    penalty_points=excluded.penalty_points,penalty_description=excluded.penalty_description,
    consequence_type=excluded.consequence_type,consequence_magnitude=excluded.consequence_magnitude,
    updated_by=excluded.updated_by,updated_at=now();

  update public.game_stages set deadline=p_deadline where game_id=p_game_id and stage_no=p_stage_no;
end;
$function$;

revoke all on function public.configure_stage_deadline_rule(uuid,integer,timestamptz,boolean,numeric,text,text,numeric) from public;
revoke all on function public.configure_stage_deadline_rule(uuid,integer,timestamptz,boolean,numeric,text,text,numeric) from anon;
grant execute on function public.configure_stage_deadline_rule(uuid,integer,timestamptz,boolean,numeric,text,text,numeric) to authenticated;

create or replace function private.stage_assessment_deadline_penalty()
returns trigger
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $function$
declare v_penalty numeric:=0;
begin
  select coalesce(sum(i.penalty_points),0) into v_penalty
  from public.stage_deadline_incidents i
  where i.game_id=new.game_id and i.stage_no=new.stage_no and i.user_id=new.user_id and i.status='active';

  new.auto_score:=greatest(0,least(3,new.auto_score-v_penalty))::integer;
  new.evidence_summary:=coalesce(new.evidence_summary,'{}'::jsonb)||jsonb_build_object('deadline_penalty_points',v_penalty);
  return new;
end;
$function$;

drop trigger if exists trg_stage_assessment_deadline_penalty on public.stage_assessments;
create trigger trg_stage_assessment_deadline_penalty
before insert or update of auto_score on public.stage_assessments
for each row execute function private.stage_assessment_deadline_penalty();

create or replace function public.apply_stage_deadline_rule(
  p_game_id uuid,
  p_stage_no integer,
  p_party_id uuid default null,
  p_user_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $function$
declare
  v_uid uuid:=(select auth.uid());
  r public.stage_deadline_rules%rowtype;
  v_id uuid; v_type text; v_mag numeric; v_note text;
begin
  if not private.is_game_teacher(p_game_id) then raise exception 'Требуются права преподавателя'; end if;
  if p_stage_no not between 1 and 16 then raise exception 'Номер этапа должен быть от 1 до 16'; end if;
  if (p_party_id is null)=(p_user_id is null) then raise exception 'Выберите ровно одного адресата: партию или студента'; end if;

  select * into r from public.stage_deadline_rules where game_id=p_game_id and stage_no=p_stage_no;
  if r.game_id is null then raise exception 'Сначала настройте правило дедлайна этапа'; end if;
  if r.deadline_at is null then raise exception 'Сначала установите дедлайн этапа'; end if;
  if now()<=r.deadline_at then raise exception 'Дедлайн этапа ещё не наступил'; end if;

  if p_party_id is not null then
    if not exists(select 1 from public.game_parties where id=p_party_id and game_id=p_game_id) then raise exception 'Партия не найдена в этой игре'; end if;
    if r.consequence_type='none' then raise exception 'Для партии не настроено игровое последствие'; end if;
    if exists(select 1 from public.stage_deadline_incidents where game_id=p_game_id and stage_no=p_stage_no and party_id=p_party_id and status='active') then raise exception 'Для этой партии уже действует последствие по этапу'; end if;
    if r.consequence_type='representation_loss' and private.has_open_duma_mandate_vote(p_game_id) then raise exception 'Сначала завершите открытое голосование Государственной Думы'; end if;
    v_type:=r.consequence_type; v_mag:=r.consequence_magnitude;
  else
    if not exists(select 1 from public.game_members where game_id=p_game_id and user_id=p_user_id and kind='student') then raise exception 'Студент не найден в этой игре'; end if;
    if r.penalty_points<=0 then raise exception 'Для студентов не настроен штраф в баллах'; end if;
    if exists(select 1 from public.stage_deadline_incidents where game_id=p_game_id and stage_no=p_stage_no and user_id=p_user_id and status='active') then raise exception 'Для этого студента уже действует штраф по этапу'; end if;
    v_type:='other'; v_mag:=null;
  end if;

  v_note:=coalesce(nullif(trim(p_note),''),r.penalty_description);

  insert into public.stage_deadline_incidents(
    game_id,stage_no,party_id,user_id,consequence_type,magnitude,note,created_by,
    penalty_points,penalty_description
  )
  values(
    p_game_id,p_stage_no,p_party_id,p_user_id,v_type,v_mag,v_note,v_uid,
    case when p_user_id is not null then r.penalty_points else 0 end,r.penalty_description
  )
  returning id into v_id;

  if p_party_id is not null then
    update public.game_parties
    set representation_penalty=representation_penalty+case when v_type='representation_loss' then ceil(v_mag)::integer else 0 end,
        regional_seat_penalty=regional_seat_penalty+case when v_type='regional_seat_loss' then ceil(v_mag)::integer else 0 end,
        ghost_risk_weight=greatest(0.1,ghost_risk_weight+case when v_type='ghost_risk' then v_mag else 0 end),
        presidential_rating_modifier=presidential_rating_modifier-case when v_type='presidential_rating_loss' then v_mag else 0 end
    where id=p_party_id;
  else
    perform private.compute_vsn_assessment(p_game_id,p_user_id,p_stage_no,'manual');
  end if;

  return v_id;
end;
$function$;

revoke all on function public.apply_stage_deadline_rule(uuid,integer,uuid,uuid,text) from public;
revoke all on function public.apply_stage_deadline_rule(uuid,integer,uuid,uuid,text) from anon;
grant execute on function public.apply_stage_deadline_rule(uuid,integer,uuid,uuid,text) to authenticated;

revoke all on function public.configure_stage_deadline(uuid,integer,timestamptz,boolean,numeric,text) from public;
revoke all on function public.configure_stage_deadline(uuid,integer,timestamptz,boolean,numeric,text) from anon;
revoke all on function public.configure_stage_deadline(uuid,integer,timestamptz,boolean,numeric,text) from authenticated;
revoke all on function public.record_deadline_consequence(uuid,integer,uuid,uuid,text,numeric,text) from public;
revoke all on function public.record_deadline_consequence(uuid,integer,uuid,uuid,text,numeric,text) from anon;
revoke all on function public.record_deadline_consequence(uuid,integer,uuid,uuid,text,numeric,text) from authenticated;
