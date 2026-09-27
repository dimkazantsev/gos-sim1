-- Procedural voting linked to formal documents.
alter table public.game_votes
  add column if not exists formal_document_id uuid references public.formal_documents(id) on delete set null,
  add column if not exists formal_step_code text,
  add column if not exists institution_key text not null default 'all',
  add column if not exists procedure_key text not null default 'generic',
  add column if not exists quorum_kind text not null default 'fraction',
  add column if not exists quorum_value numeric not null default 0.6666667,
  add column if not exists majority_kind text not null default 'yes_no_simple',
  add column if not exists majority_value numeric not null default 0.5,
  add column if not exists allow_abstain boolean not null default true,
  add column if not exists tie_breaker_chair boolean not null default false,
  add column if not exists pass_transition text not null default 'none',
  add column if not exists fail_transition text not null default 'none',
  add column if not exists result_code text,
  add column if not exists result_label text,
  add column if not exists result_yes numeric,
  add column if not exists result_no numeric,
  add column if not exists result_abstain numeric,
  add column if not exists result_eligible numeric,
  add column if not exists result_cast numeric,
  add column if not exists result_quorum_met boolean,
  add column if not exists decision_note text;

create index if not exists game_votes_formal_idx on public.game_votes(formal_document_id,opened_at desc);
create unique index if not exists game_votes_one_open_per_formal_step
  on public.game_votes(formal_document_id,formal_step_code)
  where formal_document_id is not null and status='open';

alter table public.game_votes drop constraint if exists game_votes_result_code_check;
alter table public.game_votes add constraint game_votes_result_code_check
 check(result_code is null or result_code in ('passed','rejected','no_quorum'));
alter table public.game_votes drop constraint if exists game_votes_quorum_kind_check;
alter table public.game_votes add constraint game_votes_quorum_kind_check
 check(quorum_kind in ('none','fraction'));
alter table public.game_votes drop constraint if exists game_votes_majority_kind_check;
alter table public.game_votes add constraint game_votes_majority_kind_check
 check(majority_kind in ('yes_no_simple','present_majority','eligible_majority','eligible_fraction'));
alter table public.game_votes drop constraint if exists game_votes_transition_check;
alter table public.game_votes add constraint game_votes_transition_check
 check(pass_transition in ('none','advance','reject','return_author','return_previous')
   and fail_transition in ('none','advance','reject','return_author','return_previous'));

create or replace function private.vote_member_matches(p_game uuid,p_user uuid,p_institution text)
returns boolean language sql stable security definer
set search_path=public,private,pg_temp as $$
select exists(
 select 1 from public.game_members gm
 where gm.game_id=p_game and gm.user_id=p_user and gm.kind<>'observer'
 and case
  when p_institution in ('all','factions') then gm.kind='student'
  when p_institution='gd' then coalesce(gm.role_title,'') ilike '%депутат%' or coalesce(gm.role_title,'') ilike '%государственн%дум%'
  when p_institution='government' then coalesce(gm.role_title,'') ilike '%правительств%' or coalesce(gm.role_title,'') ilike '%министр%'
  when p_institution='sf' then coalesce(gm.role_title,'') ilike '%совет%федерац%' or coalesce(gm.role_title,'') ilike '%сенатор%'
  when p_institution='committee' then coalesce(gm.role_title,'') ilike '%комитет%' or coalesce(gm.role_title,'') ilike '%депутат%'
  when p_institution='municipality' then coalesce(gm.role_title,'') ilike '%муницип%' or coalesce(gm.role_title,'') ilike '%администрац%' or coalesce(gm.role_title,'') ilike '%глава города%'
  else false end
);
$$;

create or replace function private.vote_eligible_weight(p_vote public.game_votes,p_user uuid)
returns numeric language plpgsql stable security definer
set search_path=public,private,pg_temp as $$
declare p public.game_parties%rowtype;
begin
 if p_vote.voting_mode in ('faction','mandate') then
  select gp.* into p from public.game_parties gp
  join public.game_members gm on gm.game_id=gp.game_id and gm.team=gp.name
  where gp.game_id=p_vote.game_id and gm.user_id=p_user and gp.leader_user_id=p_user limit 1;
  if p.id is null then return 0; end if;
  if p_vote.voting_mode='mandate' then return greatest(1,coalesce(p.mandates,0)); end if;
  return 1;
 end if;
 if private.vote_member_matches(p_vote.game_id,p_user,p_vote.institution_key) then return 1; end if;
 return 0;
end;
$$;

create or replace function private.vote_total_eligible_weight(p_vote public.game_votes)
returns numeric language plpgsql stable security definer
set search_path=public,private,pg_temp as $$
declare v numeric;
begin
 if p_vote.voting_mode='faction' then
  select count(*)::numeric into v from public.game_parties where game_id=p_vote.game_id and leader_user_id is not null;
 elsif p_vote.voting_mode='mandate' then
  select coalesce(sum(greatest(1,coalesce(mandates,0))),0)::numeric into v from public.game_parties where game_id=p_vote.game_id and leader_user_id is not null;
 else
  select count(*)::numeric into v from public.game_members gm where gm.game_id=p_vote.game_id and private.vote_member_matches(p_vote.game_id,gm.user_id,p_vote.institution_key);
 end if;
 return coalesce(v,0);
end;
$$;

create or replace function private.apply_formal_vote_transition(p_document uuid,p_transition text,p_actor uuid,p_vote uuid,p_note text)
returns void language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare d public.formal_documents%rowtype;v_step jsonb;v_next integer;v_action text;
begin
 if p_document is null or p_transition='none' then return; end if;
 select * into d from public.formal_documents where id=p_document for update;
 if d.id is null then return; end if;
 if p_transition='advance' then
  v_next:=d.current_step+1;if v_next>=jsonb_array_length(d.workflow_steps) then return;end if;
  v_step:=d.workflow_steps->v_next;
  update public.formal_documents set current_step=v_next,status_code=v_step->>'code',status_label=v_step->>'label',current_owner_key=v_step->>'owner',updated_at=now() where id=d.id;
  v_action:='Документ продвинут по результатам голосования';
 elsif p_transition='reject' then
  update public.formal_documents set status_code='rejected',status_label='Отклонён голосованием',current_owner_key='system',updated_at=now() where id=d.id;
  v_action:='Документ отклонён голосованием';
 elsif p_transition='return_author' then
  v_step:=d.workflow_steps->0;
  update public.formal_documents set current_step=0,status_code='revision',status_label='Возвращён автору по результатам голосования',current_owner_key='author',updated_at=now() where id=d.id;
  v_action:='Документ возвращён автору по результатам голосования';
 elsif p_transition='return_previous' then
  v_next:=greatest(0,d.current_step-1);v_step:=d.workflow_steps->v_next;
  update public.formal_documents set current_step=v_next,status_code='revision',status_label='Возвращён на предыдущую стадию',current_owner_key=v_step->>'owner',updated_at=now() where id=d.id;
  v_action:='Документ возвращён на предыдущую стадию по результатам голосования';
 else return;
 end if;
 insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
 select d.id,d.game_id,p_actor,v_action,d.status_code,fd.status_code,d.current_owner_key,fd.current_owner_key,
 'Голосование '||p_vote::text||coalesce(' · '||nullif(p_note,''),'')
 from public.formal_documents fd where fd.id=d.id;
end;
$$;

create or replace function private.can_close_procedural_vote(p_game uuid,p_user uuid,p_institution text,p_formal uuid)
returns boolean language plpgsql stable security definer
set search_path=public,private,pg_temp as $$
declare v_role text;d public.formal_documents%rowtype;
begin
 if private.is_game_teacher(p_game) then return true;end if;
 select coalesce(role_title,'') into v_role from public.game_members where game_id=p_game and user_id=p_user;
 if p_formal is not null then
  select * into d from public.formal_documents where id=p_formal;
  if d.id is not null and private.matches_formal_owner(d.game_id,p_user,d.current_owner_key,d.author_id)
   and ((p_institution='gd' and (v_role ilike '%председател%дум%' or v_role ilike '%совет%дум%'))
    or (p_institution='government' and v_role ilike '%председател%правительств%')
    or (p_institution='sf' and v_role ilike '%председател%совет%федерац%')
    or (p_institution='committee' and v_role ilike '%председател%комитет%')
    or (p_institution='municipality' and (v_role ilike '%глава города%' or v_role ilike '%глава%муницип%'))
    or p_institution='all') then return true;end if;
 end if;
 return case
  when p_institution='gd' then v_role ilike '%председател%дум%' or v_role ilike '%совет%дум%'
  when p_institution='government' then v_role ilike '%председател%правительств%'
  when p_institution='sf' then v_role ilike '%председател%совет%федерац%'
  when p_institution='committee' then v_role ilike '%председател%комитет%'
  when p_institution='municipality' then v_role ilike '%глава города%' or v_role ilike '%глава%муницип%'
  else false end;
end;
$$;

create or replace function public.create_procedural_vote(
 p_game_id uuid,p_title text,p_body text,p_voting_mode text,p_institution_key text,p_procedure_key text,
 p_quorum_kind text default 'fraction',p_quorum_value numeric default 0.6666667,
 p_majority_kind text default 'yes_no_simple',p_majority_value numeric default 0.5,
 p_allow_abstain boolean default true,p_tie_breaker_chair boolean default false,
 p_formal_document_id uuid default null,p_pass_transition text default 'none',p_fail_transition text default 'none'
) returns uuid language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v_id uuid:=gen_random_uuid();d public.formal_documents%rowtype;v_step_code text;
begin
 if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 if p_voting_mode not in ('member','faction','mandate') then raise exception 'Unsupported voting mode';end if;
 if length(trim(coalesce(p_title,'')))<3 then raise exception 'Vote title is required';end if;
 if p_formal_document_id is not null then
  select * into d from public.formal_documents where id=p_formal_document_id;
  if d.id is null or d.game_id<>p_game_id then raise exception 'Formal document not found';end if;
  if not (private.is_game_teacher(p_game_id) or private.matches_formal_owner(d.game_id,v_uid,d.current_owner_key,d.author_id)) then raise exception 'Current institution cannot open this vote';end if;
  v_step_code:=d.status_code;
 else
  if not private.is_game_teacher(p_game_id) then raise exception 'Only teacher can open an unlinked vote';end if;
 end if;
 insert into public.game_votes(id,game_id,stage_no,title,body,voting_mode,created_by,formal_document_id,formal_step_code,institution_key,procedure_key,quorum_kind,quorum_value,majority_kind,majority_value,allow_abstain,tie_breaker_chair,pass_transition,fail_transition)
 values(v_id,p_game_id,coalesce(d.stage_no,1),trim(p_title),nullif(trim(coalesce(p_body,'')),''),p_voting_mode,v_uid,p_formal_document_id,v_step_code,p_institution_key,p_procedure_key,p_quorum_kind,p_quorum_value,p_majority_kind,p_majority_value,p_allow_abstain,p_tie_breaker_chair,p_pass_transition,p_fail_transition);
 return v_id;
end;
$$;
revoke all on function public.create_procedural_vote(uuid,text,text,text,text,text,text,numeric,text,numeric,boolean,boolean,uuid,text,text) from public,anon;
grant execute on function public.create_procedural_vote(uuid,text,text,text,text,text,text,numeric,text,numeric,boolean,boolean,uuid,text,text) to authenticated;

create or replace function public.cast_procedural_vote(p_vote_id uuid,p_choice text)
returns void language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v public.game_votes%rowtype;v_weight numeric;
begin
 select * into v from public.game_votes where id=p_vote_id for update;
 if v.id is null then raise exception 'Vote not found';end if;
 if v.status<>'open' then raise exception 'Vote is closed';end if;
 if p_choice not in ('yes','no','abstain') then raise exception 'Unsupported choice';end if;
 if p_choice='abstain' and not v.allow_abstain then raise exception 'Abstention is not allowed';end if;
 if v_uid is null or not private.is_game_member(v.game_id) then raise exception 'Game access required';end if;
 v_weight:=private.vote_eligible_weight(v,v_uid);
 if v_weight<=0 then raise exception 'You are not eligible to vote in this procedure';end if;
 insert into public.game_ballots(vote_id,voter_id,choice,weight) values(v.id,v_uid,p_choice,v_weight)
 on conflict(vote_id,voter_id) do update set choice=excluded.choice,weight=excluded.weight,created_at=now();
end;
$$;
revoke all on function public.cast_procedural_vote(uuid,text) from public,anon;
grant execute on function public.cast_procedural_vote(uuid,text) to authenticated;
revoke insert,update,delete on public.game_ballots from authenticated;

create or replace function public.close_procedural_vote(p_vote_id uuid,p_note text default null)
returns jsonb language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());v public.game_votes%rowtype;v_eligible numeric;v_cast numeric;v_yes numeric;v_no numeric;v_abstain numeric;v_needed numeric;v_quorum boolean;v_pass boolean;v_result text;v_label text;v_chair_choice text;
begin
 select * into v from public.game_votes where id=p_vote_id for update;
 if v.id is null then raise exception 'Vote not found';end if;
 if v.status<>'open' then return jsonb_build_object('result',v.result_code,'label',v.result_label);end if;
 if v_uid is null or not private.is_game_member(v.game_id) then raise exception 'Game access required';end if;
 if not private.can_close_procedural_vote(v.game_id,v_uid,v.institution_key,v.formal_document_id) then raise exception 'Only the presiding institution or teacher can close this vote';end if;
 v_eligible:=private.vote_total_eligible_weight(v);
 select coalesce(sum(weight),0),coalesce(sum(weight) filter(where choice='yes'),0),coalesce(sum(weight) filter(where choice='no'),0),coalesce(sum(weight) filter(where choice='abstain'),0)
 into v_cast,v_yes,v_no,v_abstain from public.game_ballots where vote_id=v.id;
 if v.quorum_kind='none' then v_quorum:=true;v_needed:=0;else v_needed:=ceil(v_eligible*v.quorum_value);v_quorum:=v_eligible>0 and v_cast>=v_needed;end if;
 if not v_quorum then v_pass:=false;v_result:='no_quorum';v_label:='Нет кворума';
 else
  if v.majority_kind='eligible_majority' then v_pass:=v_yes>v_eligible/2;
  elsif v.majority_kind='eligible_fraction' then v_pass:=v_yes>=ceil(v_eligible*v.majority_value);
  elsif v.majority_kind='present_majority' then
   v_pass:=v_yes>v_cast/2;
   if not v_pass and v.tie_breaker_chair and v_yes=v_no then
    select b.choice into v_chair_choice from public.game_ballots b join public.game_members gm on gm.user_id=b.voter_id and gm.game_id=v.game_id
    where b.vote_id=v.id and (coalesce(gm.role_title,'') ilike '%председател%правительств%' or coalesce(gm.role_title,'') ilike '%председател%дум%' or coalesce(gm.role_title,'') ilike '%председател%совет%федерац%') limit 1;
    v_pass:=v_chair_choice='yes';
   end if;
  else v_pass:=v_yes>v_no;end if;
  v_result:=case when v_pass then 'passed' else 'rejected' end;v_label:=case when v_pass then 'Решение принято' else 'Решение отклонено' end;
 end if;
 update public.game_votes set status='closed',closed_at=now(),result_code=v_result,result_label=v_label,result_yes=v_yes,result_no=v_no,result_abstain=v_abstain,result_eligible=v_eligible,result_cast=v_cast,result_quorum_met=v_quorum,decision_note=nullif(trim(coalesce(p_note,'')),'') where id=v.id;
 if v_quorum then perform private.apply_formal_vote_transition(v.formal_document_id,case when v_pass then v.pass_transition else v.fail_transition end,v_uid,v.id,p_note);end if;
 return jsonb_build_object('result',v_result,'label',v_label,'yes',v_yes,'no',v_no,'abstain',v_abstain,'eligible',v_eligible,'cast',v_cast,'quorum',v_quorum,'needed',v_needed);
end;
$$;
revoke all on function public.close_procedural_vote(uuid,text) from public,anon;
grant execute on function public.close_procedural_vote(uuid,text) to authenticated;
