create or replace function private.record_event_authority() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.event_cases%rowtype;d record;o jsonb;qualified uuid[];ok boolean;lawful boolean;v_stage integer;violations int:=0;legal_delta numeric;v_authority_delta numeric;old_value numeric;new_value numeric;m public.state_metrics%rowtype;
begin
 select * into c from public.event_cases where id=new.case_id;
 select stage_no into v_stage from public.game_stages where game_id=c.game_id and status='open' order by stage_no desc limit 1;
 v_stage:=coalesce(v_stage,1);
 for d in select * from public.event_decisions where case_id=c.id loop
  o:=c.effect_plan->'options'->(substring(d.choice from 8)::int-1);
  select array_agg(x.actor_id) into qualified from public.event_decisions x where x.case_id=c.id and x.choice=d.choice and private.event_role_matches(x.role_snapshot,o->'authorized_roles');
  ok:=coalesce(cardinality(qualified),0)>0;
  lawful:=coalesce((o->>'lawful')::boolean,false);
  insert into public.event_authority_evidence(decision_id,case_id,game_id,actor_id,stage_no,authority_ok,lawful,strategy_point,role_snapshot,legal_basis,coalition_ids)
  values(d.id,c.id,c.game_id,d.actor_id,v_stage,ok,lawful,ok and lawful and coalesce((o->>'protects_role_interest')::boolean,false),d.role_snapshot,coalesce(o->>'legal_basis','Правовая разметка варианта отсутствует'),coalesce(qualified,'{}')) on conflict do nothing;
  if d.choice=new.winner and (not ok or not lawful) then violations:=violations+1;end if;
 end loop;
 if new.winner='tie' then return new;end if;
 v_authority_delta:=case when violations>0 then -greatest(0,new.requested_trust_delta)-least(6,violations*2) else 1 end;
 legal_delta:=case when violations>0 then -least(9,violations*3) else 2 end;
 perform private.apply_event_trust_delta(c.game_id,'authority-'||c.id,v_authority_delta,'Полномочия в событии: '||c.title);
 select * into m from public.state_metrics where game_id=c.game_id and metric_key='lawfulness' for update;
 if m.id is not null then
  old_value:=m.value;new_value:=greatest(coalesce(m.min_value,-1e9),least(coalesce(m.max_value,1e9),old_value+legal_delta));
  update public.state_metrics set previous_value=old_value,value=new_value where id=m.id;
  insert into public.state_metric_history(game_id,metric_id,metric_key,value,previous_value,delta,source_type,source_id,actor_id,note)
  values(c.game_id,m.id,m.metric_key,new_value,old_value,new_value-old_value,'event_authority',c.id::text,auth.uid(),'Правовая устойчивость: проверка полномочий по событию «'||c.title||'»');
 end if;
 update public.event_case_outcomes set trust_delta=new.trust_delta+coalesce((select delta from public.event_trust_ledger where game_id=c.game_id and action_key='authority-'||c.id),0),requested_trust_delta=new.requested_trust_delta+v_authority_delta where case_id=c.id;
 update public.political_posts set body=body||E'\n\nПроверка полномочий: нарушений '||violations||'. Суммарное фактическое изменение доверия: '||(select trust_delta from public.event_case_outcomes where case_id=c.id)||' п.п.' where id=new.media_post_id;
 return new;
end;$$;
