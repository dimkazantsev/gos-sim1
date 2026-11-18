-- Keep teacher/student evidence cards consistent with parallel-stage automatic score ownership.
CREATE OR REPLACE FUNCTION public.get_stage_assessment_evidence(p_game_id uuid, p_user_id uuid, p_stage_no integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_uid uuid:=(select auth.uid());
  v_start timestamptz; v_end timestamptz; out_json jsonb;
  v_unique tstzmultirange; v_other record;
begin
  if v_uid is null or not private.is_game_member(p_game_id) then raise exception 'Game access required'; end if;
  if p_stage_no<1 or p_stage_no>16 then raise exception 'Stage must be 1-16'; end if;
  if v_uid<>p_user_id and not private.is_game_teacher(p_game_id) then
    raise exception 'Detailed evidence is available only to the student and teacher';
  end if;
  select w.start_at,w.end_at into v_start,v_end from private.vsn_stage_window(p_game_id,p_stage_no) w;
  v_end:=greatest(v_start,least(coalesce(v_end,clock_timestamp()),clock_timestamp()));
  v_unique:=tstzmultirange(tstzrange(v_start,v_end,'[)'));
  for v_other in
    select s.opened_at start_at,
      least(coalesce(s.completed_at,clock_timestamp()),
        coalesce(s.score_closed_at,case when s.status='open' then s.deadline end,'infinity'::timestamptz),
        clock_timestamp()) end_at
    from public.game_stages s where s.game_id=p_game_id and s.stage_no<>p_stage_no
      and s.status in ('open','completed') and s.opened_at is not null and s.opened_at<v_end
  loop
    if v_other.end_at>v_other.start_at then
      v_unique:=v_unique-tstzmultirange(tstzrange(v_other.start_at,v_other.end_at,'[)'));
    end if;
  end loop;

  select jsonb_build_object(
    'window',jsonb_build_object('from',v_start,'to',v_end),
    'chat',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'created_at',m.created_at,'channel',c.name,'kind',m.kind,'text',m.text,
      'mime_type',m.mime_type,'storage_path',m.storage_path) order by m.created_at)
      from public.chat_messages m left join public.chat_channels c on c.id=m.channel_id
      where m.game_id=p_game_id and m.author_id=p_user_id and m.created_at <@ v_unique),'[]'::jsonb),
    'political_posts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'created_at',p.created_at,'title',p.title,'body',p.body,'actor_label',p.actor_label,'status',p.status,'tags',p.tags) order by p.created_at)
      from public.political_posts p where p.game_id=p_game_id and p.author_id=p_user_id
        and (p.created_at <@ v_unique or (p.context->>'stage_source'='explicit'
          and p.context->>'stage_no'=p_stage_no::text and p.created_at>=v_start and p.created_at<=v_end))
        and p.source_key is null and (p.context->>'automatic') is distinct from 'true'),'[]'::jsonb),
    'ballots',coalesce((select jsonb_agg(jsonb_build_object(
      'vote_id',v.id,'title',v.title,'choice',b.choice,'weight',b.weight,'created_at',b.created_at,'formal_document_id',v.formal_document_id) order by b.created_at)
      from public.game_ballots b join public.game_votes v on v.id=b.vote_id
      where v.game_id=p_game_id and v.stage_no=p_stage_no and b.voter_id=p_user_id),'[]'::jsonb),
    'formal_documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'registry_no',d.registry_no,'title',d.title,'doc_type',d.doc_type,'body_text',d.body_text,'status',d.status_label,'created_at',d.created_at) order by d.created_at)
      from public.formal_documents d where d.game_id=p_game_id and d.stage_no=p_stage_no and d.author_id=p_user_id
        and coalesce(d.metadata->>'registry_independent','false')<>'true'),'[]'::jsonb),
    'formal_actions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',h.id,'document_id',h.document_id,'action',h.action,'from_status',h.from_status,'to_status',h.to_status,'note',h.note,'created_at',h.created_at) order by h.created_at)
      from public.formal_document_history h join public.formal_documents d on d.id=h.document_id
      where h.game_id=p_game_id and h.actor_id=p_user_id and d.stage_no=p_stage_no),'[]'::jsonb),
    'actions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'action_type',a.action_type,'title',a.title,'body',a.body,'budget',a.budget,'status',a.status,'teacher_feedback',a.teacher_feedback,'submitted_at',a.submitted_at) order by a.submitted_at)
      from public.player_actions a where a.game_id=p_game_id and a.round_no=p_stage_no and a.author_id=p_user_id),'[]'::jsonb),
    'game_documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'title',d.title,'doc_type',d.doc_type,'body',d.body,'created_at',d.created_at) order by d.created_at)
      from public.game_documents d where d.game_id=p_game_id and d.created_by=p_user_id and d.created_at <@ v_unique),'[]'::jsonb),
    'party_documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'party_id',d.party_id,'doc_kind',d.doc_kind,'title',d.title,'file_name',d.file_name,'status',d.status,'note',d.note,'created_at',d.created_at) order by d.created_at)
      from public.party_documents d where d.game_id=p_game_id and d.uploaded_by=p_user_id and d.created_at <@ v_unique),'[]'::jsonb),
    'party_actions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'party_id',i.party_id,'invited_user_id',i.invited_user_id,'invited_by',i.invited_by,
      'status',i.status,'created_at',i.created_at,'responded_at',i.responded_at,
      'role',case when i.invited_by=p_user_id then 'inviter' else 'invitee' end) order by coalesce(i.responded_at,i.created_at))
      from public.party_invitations i where i.game_id=p_game_id
        and ((i.invited_by=p_user_id and i.created_at <@ v_unique)
          or (i.invited_user_id=p_user_id and i.responded_at <@ v_unique))),'[]'::jsonb),
    'debrief',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'body',d.body,'created_at',d.created_at,'updated_at',d.updated_at))
      from public.stage_debriefs d where d.game_id=p_game_id and d.stage_no=p_stage_no and d.user_id=p_user_id),'[]'::jsonb),
    'activity',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'event_type',a.event_type,'label',a.label,'view_key',a.view_key,'created_at',a.created_at) order by a.created_at)
      from public.game_activity a where a.game_id=p_game_id and a.actor_id=p_user_id
        and (a.created_at <@ v_unique
          or (a.payload->>'stage_source'='explicit' and a.payload->>'stage_no'=p_stage_no::text
            and a.created_at>=v_start and a.created_at<=v_end)
          or (a.event_type='vote' and a.created_at>=v_start and a.created_at<=v_end
            and exists(select 1 from public.game_votes v
              where v.game_id=p_game_id and v.stage_no=p_stage_no and v.id::text=a.payload->>'vote_id')))
        and a.event_type not in ('navigation','presence')),'[]'::jsonb)
  ) into out_json;
  return out_json;
end;
$function$
;
