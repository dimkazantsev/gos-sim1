-- Idempotent event-scoring correction. No event cases or choices are modified.
alter table public.event_authority_evidence
 add column if not exists delegated_ok boolean not null default false,
 add column if not exists best_option boolean not null default false,
 add column if not exists score_share numeric(8,5) not null default 0
   check(score_share>=0 and score_share<=1);

do $migration$
declare v_def text; v_old text; v_new text;
begin
 select pg_get_functiondef('private.record_event_authority()'::regprocedure) into v_def;
 v_old:='select array_agg(x.actor_id) into qualified from public.event_decisions x where x.case_id=c.id and x.choice=d.choice and private.event_role_matches(x.role_snapshot,o->''authorized_roles'');';
 v_new:='select array_agg(distinct x.actor_id) into qualified from public.event_decisions x where x.case_id=c.id and x.choice=d.choice and private.event_role_matches(x.role_snapshot,o->''authorized_roles'') and (x.actor_id=d.actor_id or exists(select 1 from public.event_collaboration_invites i where i.case_id=c.id and i.inviter_id=d.actor_id and i.recipient_id=x.actor_id and i.status=''accepted''));';
 if position(v_old in v_def)=0 then raise exception 'Authority scorer changed: review patch';end if;
 v_def:=replace(v_def,v_old,v_new);
 if position('legal_basis,coalition_ids)' in v_def)=0 then raise exception 'Evidence column signature changed';end if;
 v_def:=replace(v_def,'legal_basis,coalition_ids)','legal_basis,coalition_ids,delegated_ok,best_option)');
 v_old:='coalesce(qualified,''{}'')) on conflict do nothing;';
 v_new:='coalesce(qualified,''{}''),not private.event_role_matches(d.role_snapshot,o->''authorized_roles'') and ok,coalesce(o->>''public_interest'','''')=''beneficial'' and lawful and d.choice=new.winner) on conflict do nothing;';
 if position(v_old in v_def)=0 then raise exception 'Evidence insertion changed';end if;
 v_def:=replace(v_def,v_old,v_new);
 v_old:='if new.winner=''tie'' then return new;end if;';
 v_new:='update public.event_authority_evidence ev set score_share=case when ev.best_option and ev.authority_ok and ev.lawful then round(1.0/nullif((select count(*) from public.event_authority_evidence ec where ec.case_id=c.id and ec.best_option and ec.authority_ok and ec.lawful),0),5) else 0 end where ev.case_id=c.id; '||v_old;
 if position(v_old in v_def)=0 then raise exception 'Outcome guard changed';end if;
 v_def:=replace(v_def,v_old,v_new);
 execute v_def;
end
$migration$;

-- Return the fractional contribution to the individual participant.
do $migration$
declare v_def text; v_old text; v_new text;
begin
 select pg_get_functiondef('public.get_event_decision_feedback(uuid)'::regprocedure) into v_def;
 v_old:='''authority_ok'',coalesce(e.authority_ok,false),''lawful'',coalesce(e.lawful,(o->>''lawful'')::boolean,false)';
 v_new:='''authority_ok'',coalesce(e.authority_ok,false),''delegated_ok'',coalesce(e.delegated_ok,false),''best_option'',coalesce(e.best_option,false),''score_share'',coalesce(e.score_share,0),''lawful'',coalesce(e.lawful,(o->>''lawful'')::boolean,false)';
 if position(v_old in v_def)=0 then raise exception 'Decision feedback changed';end if;
 execute replace(v_def,v_old,v_new);
end
$migration$;
