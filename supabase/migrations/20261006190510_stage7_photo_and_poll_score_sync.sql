create or replace function public.submit_presidential_candidate_to_cec(p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_review jsonb;v_was_submitted boolean;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id and archived_at is null for update;
 if c.id is null then raise exception 'Candidate not found';end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) or private.is_game_teacher(c.game_id) and c.created_by<>v_uid then
   raise exception 'Candidate dossier owner access required';
 end if;
 if c.registration_status in ('registered','withdrawn') then raise exception 'Candidate dossier is locked';end if;
 if c.photo_path is null or length(trim(c.photo_path))<3 then raise exception 'Upload candidate photo before submission';end if;
 v_review:=private.presidential_submission_review_json(c.id);
 if exists(select 1 from jsonb_array_elements(v_review->'items') x where x->>'state'='missing') then
   raise exception 'Complete the required document list before submission';
 end if;
 if coalesce((v_review->>'program_points')::int,0)<10 and c.nomination_type<>'fictional' then raise exception 'Program must contain at least 10 points';end if;
 if c.nomination_type='self' and (coalesce((v_review->>'support_group')::int,0)<5 or coalesce((v_review->>'signatures')::int,0)<15)
 then raise exception 'Self-nomination support requirements are incomplete';end if;
 v_was_submitted:=c.cec_submitted_at is not null;
 update public.presidential_candidate_documents set is_submitted=true,submitted_at=now(),status='submitted',updated_at=now()
 where candidate_id=c.id and archived_at is null;
 update public.presidential_candidates set cec_submitted_at=now(),cec_submission_version=cec_submission_version+1,
   registration_status='submitted',registration_attempts=registration_attempts+case when v_was_submitted then 1 else 0 end,updated_at=now()
 where id=c.id;
 return private.presidential_submission_review_json(c.id);
end;$$;
revoke all on function public.submit_presidential_candidate_to_cec(uuid) from public,anon;
grant execute on function public.submit_presidential_candidate_to_cec(uuid) to authenticated;

drop policy if exists presidential_campaign_read on public.presidential_campaign_materials;
create policy presidential_campaign_read on public.presidential_campaign_materials
for select to authenticated using(
 private.is_game_member(game_id) and (
   status='approved' or author_id=(select auth.uid()) or private.is_game_teacher(game_id)
 )
);

create or replace function public.close_presidential_public_poll(p_game_id uuid,p_round_no integer)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_public_polls%rowtype;v_total integer;v_result jsonb;v_uid uuid:=(select auth.uid());
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 select * into p from public.presidential_public_polls where game_id=p_game_id and round_no=p_round_no for update;
 if p.id is null then raise exception 'Poll not found';end if;
 update public.presidential_public_polls set status='closed',closed_at=now() where id=p.id;
 select count(*) into v_total from public.presidential_public_poll_votes where poll_id=p.id;

 insert into public.presidential_scorecards(game_id,candidate_id,round_no,poll_pct,updated_by)
 select p_game_id,c.id,p_round_no,
   case when v_total=0 then 0 else round(100.0*count(pv.*)/v_total,2) end,
   v_uid
 from public.presidential_candidates c
 left join public.presidential_public_poll_votes pv on pv.candidate_id=c.id and pv.poll_id=p.id
 where c.game_id=p_game_id and c.archived_at is null and c.registration_status='registered'
 group by c.id
 on conflict(candidate_id,round_no) do update
 set poll_pct=excluded.poll_pct,updated_at=now(),updated_by=v_uid;

 select coalesce(jsonb_agg(jsonb_build_object(
   'candidate_id',c.id,'candidate',c.display_name,'votes',coalesce(v.cnt,0),
   'pct',case when v_total=0 then 0 else round(100.0*coalesce(v.cnt,0)/v_total,2) end
 ) order by coalesce(v.cnt,0) desc,c.display_name),'[]'::jsonb)
 into v_result
 from public.presidential_candidates c
 left join lateral(
  select count(*) cnt from public.presidential_public_poll_votes pv
  where pv.poll_id=p.id and pv.candidate_id=c.id
 )v on true
 where c.game_id=p_game_id and c.archived_at is null and c.registration_status='registered';

 return jsonb_build_object('total',v_total,'results',v_result);
end;$$;
revoke all on function public.close_presidential_public_poll(uuid,integer) from public,anon;
grant execute on function public.close_presidential_public_poll(uuid,integer) to authenticated;
