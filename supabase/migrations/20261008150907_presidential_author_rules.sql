-- Author rules: shares of PPS ballots and candidate game points; no runoff renormalisation.
alter table public.presidential_election_settings add column if not exists jury_size integer not null default 8 check(jury_size between 1 and 50);
alter table public.presidential_scorecards add column if not exists game_rating_points numeric check(game_rating_points>=0 and game_rating_points::text not in ('NaN','Infinity','-Infinity'));
alter table public.presidential_scorecards add column if not exists unrounded_pct numeric;
create table public.presidential_teacher_ballots(
 game_id uuid not null references public.games(id) on delete cascade,
 round_no integer not null check(round_no in (1,2)),
 criterion text not null check(criterion in ('program','campaign','runoff')),
 slot_no integer not null check(slot_no between 1 and 50),
 candidate_id uuid not null references public.presidential_candidates(id) on delete cascade,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),
 primary key(game_id,round_no,criterion,slot_no),
 check((round_no=1 and criterion in ('program','campaign')) or (round_no=2 and criterion='runoff'))
);
create index presidential_teacher_ballots_candidate_idx on public.presidential_teacher_ballots(candidate_id);
alter table public.presidential_teacher_ballots enable row level security;
revoke all on public.presidential_teacher_ballots from public,anon,authenticated;
grant select on public.presidential_teacher_ballots to authenticated;
create policy presidential_teacher_ballots_read on public.presidential_teacher_ballots for select to authenticated using(private.is_game_teacher(game_id));
alter publication supabase_realtime add table public.presidential_teacher_ballots;

create function public.set_presidential_jury_size(p_game_id uuid,p_size integer) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s presidential_election_settings%rowtype;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 select * into s from presidential_election_settings where game_id=p_game_id for update;
 if s.game_id is null or s.status not in ('setup','round1') then raise exception 'Состав ППС первого тура уже зафиксирован или система не утверждена';end if;
 if p_size is null or p_size not between 1 and 50 then raise exception 'Укажите от 1 до 50 преподавателей';end if;
 update presidential_election_settings set jury_size=p_size,updated_at=now() where game_id=p_game_id;
 delete from presidential_teacher_ballots where game_id=p_game_id and slot_no>p_size;
end;$$;

create function public.set_presidential_teacher_ballot(p_game_id uuid,p_round_no integer,p_criterion text,p_slot_no integer,p_candidate_id uuid default null) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s presidential_election_settings%rowtype;c presidential_candidates%rowtype;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 select * into s from presidential_election_settings where game_id=p_game_id for update;
 if s.game_id is null then raise exception 'Сначала утвердите систему выборов';end if;
 if p_slot_no is null or p_slot_no not between 1 and s.jury_size then raise exception 'Неверный номер преподавателя';end if;
 if p_round_no is null or p_criterion is null or not ((p_round_no=1 and p_criterion in ('program','campaign') and s.status in ('setup','round1')) or (p_round_no=2 and p_criterion='runoff' and s.status='runoff')) then raise exception 'Голосование этого тура недоступно';end if;
 if p_candidate_id is null then
  delete from presidential_teacher_ballots where game_id=p_game_id and round_no=p_round_no and criterion=p_criterion and slot_no=p_slot_no;
  return;
 end if;
 select * into c from presidential_candidates where id=p_candidate_id and game_id=p_game_id and archived_at is null and registration_status='registered';
 if c.id is null or c.user_id is null or not exists(select 1 from game_members where game_id=p_game_id and user_id=c.user_id and kind='student' and roster_archived_at is null) then raise exception 'Выберите действующего зарегистрированного кандидата; ППС не голосуют за вымышленных кандидатов';end if;
 if p_round_no=2 and not (s.result->'candidate_ids' ? c.id::text) then raise exception 'Кандидат не прошёл во второй тур';end if;
 insert into presidential_teacher_ballots(game_id,round_no,criterion,slot_no,candidate_id,updated_by)
 values(p_game_id,p_round_no,p_criterion,p_slot_no,p_candidate_id,auth.uid())
 on conflict(game_id,round_no,criterion,slot_no) do update set candidate_id=excluded.candidate_id,updated_by=excluded.updated_by,updated_at=now();
end;$$;

create function public.set_presidential_rules_input(p_candidate_id uuid,p_game_points numeric default null,p_poll_pct numeric default null) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c presidential_candidates%rowtype;s presidential_election_settings%rowtype;
begin
 select * into c from presidential_candidates where id=p_candidate_id and archived_at is null;
 if c.id is null or auth.uid() is null or not private.is_game_teacher(c.game_id) then raise exception 'Teacher access required';end if;
 select * into s from presidential_election_settings where game_id=c.game_id for update;
 if s.game_id is null or s.status not in ('setup','round1') then raise exception 'Первый тур недоступен для изменений';end if;
 if c.registration_status<>'registered' then raise exception 'Кандидат не зарегистрирован';end if;
 if p_game_points<0 or p_game_points>100000000 or p_game_points::text in ('NaN','Infinity','-Infinity') then raise exception 'Баллы должны быть конечным неотрицательным числом';end if;
 if p_poll_pct<0 or p_poll_pct>100 or p_poll_pct::text in ('NaN','Infinity','-Infinity') then raise exception 'Процент опроса должен быть от 0 до 100';end if;
 insert into presidential_scorecards(game_id,candidate_id,round_no,game_rating_points,poll_pct,updated_by)
 values(c.game_id,c.id,1,p_game_points,p_poll_pct,auth.uid())
 on conflict(candidate_id,round_no) do update set game_rating_points=excluded.game_rating_points,poll_pct=excluded.poll_pct,computed_pct=null,unrounded_pct=null,updated_by=auth.uid(),updated_at=now();
end;$$;

create function private.presidential_author_result(p_game_id uuid,p_round_no integer) returns jsonb
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare s presidential_election_settings%rowtype;c record;rows_json jsonb:='[]';issues jsonb:='[]';
 n_program integer;n_campaign integer;n_runoff integer;total_points numeric;poll_total numeric;poll_count integer;candidate_count integer;
 program_pct numeric;campaign_pct numeric;game_pct numeric;teacher_pct numeric;base numeric;result_pct numeric;modifier numeric;first_pct numeric;
begin
 select * into s from presidential_election_settings where game_id=p_game_id;
 if s.game_id is null then return jsonb_build_object('ready',false,'issues',jsonb_build_array('Сначала утвердите систему выборов на этапе 6'),'rows','[]'::jsonb,'jury_size',8);end if;
 if p_round_no is null or p_round_no is null or p_round_no not in (1,2) then raise exception 'Неверный тур';end if;
 select count(*) filter(where criterion='program'),count(*) filter(where criterion='campaign'),count(*) filter(where criterion='runoff')
 into n_program,n_campaign,n_runoff from presidential_teacher_ballots b join presidential_candidates pc on pc.id=b.candidate_id
 where b.game_id=p_game_id and b.round_no=p_round_no and b.slot_no<=s.jury_size and pc.archived_at is null and pc.registration_status='registered'
 and exists(select 1 from game_members gm where gm.game_id=p_game_id and gm.user_id=pc.user_id and gm.kind='student' and gm.roster_archived_at is null);
 select count(*),coalesce(sum(coalesce(sc.game_rating_points,gm.score,0)),0),sum(sc.poll_pct),count(sc.poll_pct)
 into candidate_count,total_points,poll_total,poll_count from presidential_candidates pc
 left join presidential_scorecards sc on sc.candidate_id=pc.id and sc.round_no=1
 left join game_members gm on gm.game_id=p_game_id and gm.user_id=pc.user_id
 where pc.game_id=p_game_id and pc.archived_at is null and pc.registration_status='registered' and (pc.user_id is null or (gm.kind='student' and gm.roster_archived_at is null));
 if p_round_no=1 and total_points<=0 then issues:=issues||jsonb_build_array('Сумма игровых баллов кандидатов должна быть больше нуля');end if;
 if candidate_count=0 then issues:=issues||jsonb_build_array('Нет действующих зарегистрированных кандидатов');end if;
 if p_round_no=1 then
  if n_program<>s.jury_size or n_campaign<>s.jury_size then issues:=issues||jsonb_build_array('Внесите по одному голосу каждого преподавателя за программу и агитацию');end if;
  if s.poll_enabled and (poll_count<>candidate_count or abs(coalesce(poll_total,0)-100)>0.05) then issues:=issues||jsonb_build_array('Заполните доли социологического опроса для всех кандидатов; сумма должна составлять 100%');end if;
 else
  if s.status<>'runoff' or jsonb_array_length(coalesce(s.result->'candidate_ids','[]'))<>2 then issues:=issues||jsonb_build_array('Второй тур ещё не объявлен');end if;
  if n_runoff<>s.jury_size then issues:=issues||jsonb_build_array('Внесите повторные голоса всех преподавателей');end if;
 end if;
 for c in select pc.*,coalesce(sc.game_rating_points,gm.score,0) as points,sc.poll_pct,
   coalesce(sc.unrounded_pct,sc.computed_pct) as first_score from presidential_candidates pc
  left join presidential_scorecards sc on sc.candidate_id=pc.id and sc.round_no=1
  left join game_members gm on gm.game_id=p_game_id and gm.user_id=pc.user_id
  where pc.game_id=p_game_id and pc.archived_at is null and pc.registration_status='registered'
  and (pc.user_id is null or (gm.kind='student' and gm.roster_archived_at is null))
  and (p_round_no=1 or s.result->'candidate_ids' ? pc.id::text) order by pc.created_at,pc.id
 loop
  select coalesce(count(*) filter(where criterion='program'),0)*100.0/s.jury_size,
         coalesce(count(*) filter(where criterion='campaign'),0)*100.0/s.jury_size,
         coalesce(count(*) filter(where criterion='runoff'),0)*100.0/s.jury_size
  into program_pct,campaign_pct,teacher_pct from presidential_teacher_ballots where game_id=p_game_id and round_no=p_round_no and candidate_id=c.id and slot_no<=s.jury_size;
  if p_round_no=1 and c.points<0 then issues:=issues||jsonb_build_array('Отрицательные игровые баллы: '||c.display_name);end if;
  game_pct:=case when total_points>0 then c.points*100/total_points else 0 end;
  select coalesce(presidential_rating_modifier,0) into modifier from game_parties where id=c.party_id and game_id=p_game_id;
  if p_round_no=1 then
   base:=(program_pct+campaign_pct+game_pct+case when s.poll_enabled then coalesce(c.poll_pct,0) else 0 end)/(case when s.poll_enabled then 4 else 3 end);
   result_pct:=greatest(0,least(100,base-coalesce(c.rating_penalty,0)+coalesce(modifier,0)));
  else
   first_pct:=c.first_score;
   if first_pct is null then issues:=issues||jsonb_build_array('Нет зафиксированного результата первого тура: '||c.display_name);end if;
   result_pct:=(first_pct+teacher_pct)/2;
  end if;
  rows_json:=rows_json||jsonb_build_array(jsonb_build_object('candidate_id',c.id,'name',c.display_name,'points',c.points,'program_pct',program_pct,'campaign_pct',campaign_pct,'game_pct',game_pct,'poll_pct',c.poll_pct,'penalty',c.rating_penalty,'modifier',coalesce(modifier,0),'first_pct',c.first_score,'teacher_runoff_pct',teacher_pct,'result_pct',result_pct));
 end loop;
 if p_round_no=2 and jsonb_array_length(rows_json)<>2 then issues:=issues||jsonb_build_array('Во втором туре должны оставаться два действующих финалиста');end if;
 return jsonb_build_object('ready',jsonb_array_length(issues)=0,'issues',issues,'round',p_round_no,'rows',rows_json,'jury_size',s.jury_size,'total_points',total_points,'program_votes',n_program,'campaign_votes',n_campaign,'runoff_votes',n_runoff,'poll_enabled',s.poll_enabled);
end;$$;

create function public.get_presidential_rules_calculation(p_game_id uuid,p_round_no integer default 1) returns jsonb
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 if exists(select 1 from presidential_election_settings where game_id=p_game_id and status='finished' and result->'calculation' is not null and (result->>'round')::integer=p_round_no) then
  return (select result->'calculation' from presidential_election_settings where game_id=p_game_id);
 end if;
 return private.presidential_author_result(p_game_id,p_round_no);
end;$$;

create or replace function public.finalize_presidential_round(p_game_id uuid,p_round_no integer) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s presidential_election_settings%rowtype;r jsonb;x jsonb;top1 jsonb;top2 jsonb;out_json jsonb;new_status text;tied integer;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 select * into s from presidential_election_settings where game_id=p_game_id for update;
 if s.game_id is null then raise exception 'Система выборов не утверждена';end if;
 if s.status='finished' then return s.result;end if;
 if (p_round_no=1 and s.status not in ('setup','round1')) or (p_round_no=2 and s.status<>'runoff') or p_round_no is null or p_round_no not in (1,2) then raise exception 'Неверное состояние тура';end if;
 r:=private.presidential_author_result(p_game_id,p_round_no);
 if not coalesce((r->>'ready')::boolean,false) then raise exception 'Расчёт не завершён: %',r->'issues';end if;
 for x in select value from jsonb_array_elements(r->'rows') loop
  insert into presidential_scorecards(game_id,candidate_id,round_no,teacher_program_pct,teacher_campaign_pct,game_rating_pct,poll_pct,teacher_runoff_pct,computed_pct,unrounded_pct,updated_by)
  values(p_game_id,(x->>'candidate_id')::uuid,p_round_no,case when p_round_no=1 then (x->>'program_pct')::numeric end,case when p_round_no=1 then (x->>'campaign_pct')::numeric end,case when p_round_no=1 then (x->>'game_pct')::numeric end,case when p_round_no=1 then (x->>'poll_pct')::numeric end,case when p_round_no=2 then (x->>'teacher_runoff_pct')::numeric end,round((x->>'result_pct')::numeric,2),(x->>'result_pct')::numeric,auth.uid())
  on conflict(candidate_id,round_no) do update set teacher_program_pct=excluded.teacher_program_pct,teacher_campaign_pct=excluded.teacher_campaign_pct,game_rating_pct=excluded.game_rating_pct,poll_pct=excluded.poll_pct,teacher_runoff_pct=excluded.teacher_runoff_pct,computed_pct=excluded.computed_pct,unrounded_pct=excluded.unrounded_pct,updated_by=auth.uid(),updated_at=now();
 end loop;
 select value into top1 from jsonb_array_elements(r->'rows') order by (value->>'result_pct')::numeric desc,value->>'candidate_id' limit 1;
 select count(*) into tied from jsonb_array_elements(r->'rows') where (value->>'result_pct')::numeric=(top1->>'result_pct')::numeric;
 if s.system_type='preferential' and p_round_no=1 then
  new_status:='manual_required';out_json:=jsonb_build_object('reason','Для преференциальной системы нужны ранжированные бюллетени; данная формула их не заменяет');
 elsif tied>1 and (p_round_no=2 or s.system_type='relative' or (s.system_type='absolute' and (top1->>'result_pct')::numeric>50) or (s.system_type='qualified' and (top1->>'result_pct')::numeric>=s.threshold_pct)) then
  new_status:=case when p_round_no=2 then 'runoff' else 'round1' end;out_json:=s.result||jsonb_build_object('tie',true,'reason','Равенство итогов: требуется повторное голосование или мотивированное решение ЦИК');
 elsif p_round_no=2 or s.system_type='relative' or (s.system_type='absolute' and (top1->>'result_pct')::numeric>50) or (s.system_type='qualified' and (top1->>'result_pct')::numeric>=s.threshold_pct) then
  new_status:='finished';out_json:=jsonb_build_object('winner_id',top1->'candidate_id','winner',top1->'name','score',top1->'result_pct');
 else
  select value into top2 from jsonb_array_elements(r->'rows') where value->>'candidate_id'<>top1->>'candidate_id' order by (value->>'result_pct')::numeric desc,value->>'candidate_id' limit 1;
  if top2 is null then raise exception 'Для второго тура нужны два кандидата';end if;
  select count(*) into tied from jsonb_array_elements(r->'rows') where (value->>'result_pct')::numeric>=(top2->>'result_pct')::numeric;
  if tied>2 then new_status:='round1';out_json:=jsonb_build_object('tie',true,'reason','Равенство на границе двух финалистов: ЦИК должна разрешить равенство повторным голосованием');
  else new_status:='runoff';out_json:=jsonb_build_object('candidate_ids',jsonb_build_array(top1->'candidate_id',top2->'candidate_id'),'leaders',jsonb_build_array(jsonb_build_object('id',top1->'candidate_id','name',top1->'name','score',top1->'result_pct'),jsonb_build_object('id',top2->'candidate_id','name',top2->'name','score',top2->'result_pct')));end if;
 end if;
 out_json:=out_json||jsonb_build_object('round',p_round_no,'status',new_status,'rules_version',2,'calculation',r);
 update presidential_election_settings set status=new_status,result=out_json,updated_at=now() where game_id=p_game_id;
 return out_json;
end;$$;

revoke all on function private.presidential_author_result(uuid,integer) from public,anon,authenticated;
revoke all on function public.set_presidential_jury_size(uuid,integer),public.set_presidential_teacher_ballot(uuid,integer,text,integer,uuid),public.set_presidential_rules_input(uuid,numeric,numeric),public.get_presidential_rules_calculation(uuid,integer) from public,anon;
grant execute on function public.set_presidential_jury_size(uuid,integer),public.set_presidential_teacher_ballot(uuid,integer,text,integer,uuid),public.set_presidential_rules_input(uuid,numeric,numeric),public.get_presidential_rules_calculation(uuid,integer) to authenticated;
revoke all on function public.finalize_presidential_round(uuid,integer) from public,anon;
grant execute on function public.finalize_presidential_round(uuid,integer) to authenticated;

-- Legacy score RPCs cannot rewrite a finished protocol or first-round snapshots.
create function private.lock_presidential_protocol_score() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s presidential_election_settings%rowtype;g uuid;r integer;
begin
 g:=case when tg_op='DELETE' then old.game_id else new.game_id end;
 r:=case when tg_op='DELETE' then old.round_no else new.round_no end;
 if not exists(select 1 from games where id=g) then if tg_op='DELETE' then return old;else return new;end if;end if;
 select * into s from presidential_election_settings where game_id=g for update;
 if s.status='finished' or (s.status='runoff' and r=1) then raise exception 'Итог этого тура уже зафиксирован';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
create trigger presidential_scorecards_protocol_lock before insert or update or delete on public.presidential_scorecards for each row execute function private.lock_presidential_protocol_score();
revoke all on function private.lock_presidential_protocol_score() from public,anon,authenticated;

create function private.lock_presidential_protocol_settings() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if old.status in ('runoff','finished','manual_required') and row(new.system_type,new.threshold_pct,new.poll_enabled,new.jury_size) is distinct from row(old.system_type,old.threshold_pct,old.poll_enabled,old.jury_size) then raise exception 'Система и состав голосующих уже зафиксированы для этой процедуры';end if;
 if old.status='finished' and (new.status is distinct from old.status or new.result is distinct from old.result) then raise exception 'Завершённый протокол выборов защищён от изменений';end if;
 if old.status='runoff' and (new.status in ('setup','round1') or (new.status='runoff' and new.result->'candidate_ids' is distinct from old.result->'candidate_ids')) then raise exception 'Результат первого тура и состав финалистов уже зафиксированы';end if;
 return new;
end;$$;
create trigger presidential_settings_protocol_lock before update on public.presidential_election_settings for each row execute function private.lock_presidential_protocol_settings();
revoke all on function private.lock_presidential_protocol_settings() from public,anon,authenticated;

create function private.require_active_presidential_teacher(p_game_id uuid) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare m game_members%rowtype;
begin
 if auth.uid() is null then raise exception 'Teacher access required';end if;
 if private.is_platform_admin() then return;end if;
 select * into m from game_members where game_id=p_game_id and user_id=auth.uid() for update;
 if m.user_id is null or m.kind<>'teacher' or m.roster_archived_at is not null then raise exception 'Доступ действующего преподавателя этой игры обязателен';end if;
end;$$;
revoke all on function private.require_active_presidential_teacher(uuid) from public,anon,authenticated;

-- Keep the RPC signatures/grants while adding the same actor lock at entry.
do $actor_guards$
declare f record;definition text;count_functions integer:=0;call_text text;
begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('set_presidential_jury_size','set_presidential_teacher_ballot','set_presidential_rules_input','finalize_presidential_round','get_presidential_rules_calculation','set_presidential_scorecard') loop
  definition:=pg_get_functiondef(f.oid);
  if f.proname='get_presidential_rules_calculation' then
   call_text:=E'\n if not private.is_platform_admin() and not exists(select 1 from game_members where game_id=p_game_id and user_id=auth.uid() and kind=\'teacher\' and roster_archived_at is null) then raise exception \'Teacher access required\';end if;\n';
  elsif f.proname in ('set_presidential_rules_input','set_presidential_scorecard') then
   call_text:=E'\n perform private.require_active_presidential_teacher((select game_id from presidential_candidates where id=p_candidate_id));\n';
  else call_text:=E'\n perform private.require_active_presidential_teacher(p_game_id);\n';end if;
  if position(call_text in definition)=0 then
   if position(E'\nbegin\n' in definition)=0 then raise exception 'Unsupported RPC body: %',f.proname;end if;
   execute regexp_replace(definition,E'\nbegin\n',E'\nbegin\n'||call_text);
  end if;
  count_functions:=count_functions+1;
 end loop;
 if count_functions<>6 then raise exception 'Expected exactly six election RPCs';end if;
end;$actor_guards$;
