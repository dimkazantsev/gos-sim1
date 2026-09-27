-- VSN evidence drill-down and schedules.

create or replace function public.get_stage_assessment_evidence(
  p_game_id uuid,p_user_id uuid,p_stage_no integer
) returns jsonb
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  v_uid uuid:=(select auth.uid());
  v_start timestamptz;
  v_end timestamptz;
  out_json jsonb;
begin
  if v_uid is null or not private.is_game_member(p_game_id) then
    raise exception 'Game access required';
  end if;
  if p_stage_no<1 or p_stage_no>16 then raise exception 'Stage must be 1-16'; end if;
  if v_uid<>p_user_id and not private.is_game_teacher(p_game_id) then
    raise exception 'Detailed evidence is available only to the student and teacher';
  end if;

  select w.start_at,w.end_at into v_start,v_end
  from private.vsn_stage_window(p_game_id,p_stage_no) w;

  select jsonb_build_object(
    'window',jsonb_build_object('from',v_start,'to',v_end),
    'chat',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'created_at',m.created_at,'channel',c.name,'kind',m.kind,
        'text',m.text,'mime_type',m.mime_type,'storage_path',m.storage_path
      ) order by m.created_at)
      from public.chat_messages m
      left join public.chat_channels c on c.id=m.channel_id
      where m.game_id=p_game_id and m.author_id=p_user_id
        and m.created_at>=v_start and m.created_at<=v_end
    ),'[]'::jsonb),
    'political_posts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,'created_at',p.created_at,'title',p.title,'body',p.body,
        'actor_label',p.actor_label,'status',p.status,'tags',p.tags
      ) order by p.created_at)
      from public.political_posts p
      where p.game_id=p_game_id and p.author_id=p_user_id
        and p.created_at>=v_start and p.created_at<=v_end
    ),'[]'::jsonb),
    'ballots',coalesce((
      select jsonb_agg(jsonb_build_object(
        'vote_id',v.id,'title',v.title,'choice',b.choice,'weight',b.weight,
        'created_at',b.created_at,'formal_document_id',v.formal_document_id
      ) order by b.created_at)
      from public.game_ballots b
      join public.game_votes v on v.id=b.vote_id
      where v.game_id=p_game_id and v.stage_no=p_stage_no and b.voter_id=p_user_id
    ),'[]'::jsonb),
    'formal_documents',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',d.id,'registry_no',d.registry_no,'title',d.title,'doc_type',d.doc_type,
        'body_text',d.body_text,'status',d.status_label,'created_at',d.created_at
      ) order by d.created_at)
      from public.formal_documents d
      where d.game_id=p_game_id and d.stage_no=p_stage_no and d.author_id=p_user_id
    ),'[]'::jsonb),
    'formal_actions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',h.id,'document_id',h.document_id,'action',h.action,
        'from_status',h.from_status,'to_status',h.to_status,
        'note',h.note,'created_at',h.created_at
      ) order by h.created_at)
      from public.formal_document_history h
      join public.formal_documents d on d.id=h.document_id
      where h.game_id=p_game_id and h.actor_id=p_user_id and d.stage_no=p_stage_no
    ),'[]'::jsonb),
    'actions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'action_type',a.action_type,'title',a.title,'body',a.body,
        'budget',a.budget,'status',a.status,
        'teacher_feedback',a.teacher_feedback,'submitted_at',a.submitted_at
      ) order by a.submitted_at)
      from public.player_actions a
      where a.game_id=p_game_id and a.round_no=p_stage_no and a.author_id=p_user_id
    ),'[]'::jsonb),
    'party_actions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'party_id',i.party_id,'invited_user_id',i.invited_user_id,
        'status',i.status,'created_at',i.created_at
      ) order by i.created_at)
      from public.party_invitations i
      where i.game_id=p_game_id and i.invited_by=p_user_id
        and i.created_at>=v_start and i.created_at<=v_end
    ),'[]'::jsonb),
    'debrief',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',d.id,'body',d.body,'created_at',d.created_at,'updated_at',d.updated_at
      ))
      from public.stage_debriefs d
      where d.game_id=p_game_id and d.stage_no=p_stage_no and d.user_id=p_user_id
    ),'[]'::jsonb),
    'activity',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'event_type',a.event_type,'label',a.label,
        'view_key',a.view_key,'created_at',a.created_at
      ) order by a.created_at)
      from public.game_activity a
      where a.game_id=p_game_id and a.actor_id=p_user_id
        and a.created_at>=v_start and a.created_at<=v_end
        and a.event_type not in ('navigation','presence')
    ),'[]'::jsonb)
  ) into out_json;

  return out_json;
end;
$$;
revoke all on function public.get_stage_assessment_evidence(uuid,uuid,integer) from public,anon;
grant execute on function public.get_stage_assessment_evidence(uuid,uuid,integer) to authenticated;

do $$
declare jid bigint;
begin
  for jid in select jobid from cron.job
    where jobname in ('gos_sim_vsn_hourly','gos_sim_vsn_nightly')
  loop
    perform cron.unschedule(jid);
  end loop;

  perform cron.schedule(
    'gos_sim_vsn_hourly',
    '7 * * * *',
    'select private.run_vsn_all(''hourly'');'
  );

  perform cron.schedule(
    'gos_sim_vsn_nightly',
    '0 * * * *',
    'select private.run_due_nightly_vsn();'
  );
end $$;
