create or replace function public.apply_ghost_voting_batch(
 p_game_id uuid,p_losses jsonb
) returns jsonb language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare item jsonb; target public.game_parties%rowtype; total integer:=0; applied jsonb:='[]'::jsonb; loss integer;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 if jsonb_typeof(p_losses)<>'array' or jsonb_array_length(p_losses)<1 or jsonb_array_length(p_losses)>100
 then raise exception 'Supply an array of party losses';end if;
 if private.has_open_duma_mandate_vote(p_game_id)
 then raise exception 'Close State Duma mandate votes before Ghost Voting';end if;
 if (select count(distinct item->>'party_id') from jsonb_array_elements(p_losses) item)
 <>jsonb_array_length(p_losses) then raise exception 'Duplicate party in batch';end if;
 for item in select value from jsonb_array_elements(p_losses) loop
  select * into target from public.game_parties where id=(item->>'party_id')::uuid and game_id=p_game_id for update;
  if not found then raise exception 'Party not found';end if;
  if (item->>'loss') is null or (item->>'loss') !~ '^[0-9]{1,3}$' then raise exception 'Invalid loss';end if;
  loss:=(item->>'loss')::integer;
  if loss<0 or loss>50 then raise exception 'Ghost loss must be 0..50';end if;
  update public.game_parties set ghost_loss_current=loss,ghost_active=loss>0,
    ghost_started_at=case when loss>0 then now() else null end where id=target.id;
  perform private.rebalance_party_mandates(target.id);
  applied:=applied||jsonb_build_array(jsonb_build_object('party_id',target.id,'name',target.name,'loss',loss,'effective_loss',least(loss,target.mandates),'mandates',target.mandates));
  total:=total+least(loss,target.mandates);
 end loop;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,5,'Ghost voting','warning','Назначенные потери мандатов',
 'Преподаватель назначил Ghost Voting: текущая фактическая потеря '||total||' мандатов. Плановые потери без мандатов вступают в силу после их распределения. '||applied::text,auth.uid());
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(p_game_id,auth.uid(),'ghost_voting_batch','game_parties',jsonb_build_object('losses',applied));
 return jsonb_build_object('total_loss',total,'result',applied);
end;
$$;
