create or replace function public.get_story_supplements_teacher(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $f$
declare v_list jsonb;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Доступ разрешён только преподавателю игры.' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'code',t.code,'kind',t.kind,'title',coalesce(r.draft_title,t.title),
  'body',coalesce(r.draft_body,t.template_body),'stage_from',t.stage_from,'stage_to',t.stage_to,
  'after_episode',t.after_episode,'requirement',t.requirement,
  'source_status',t.source_status,'source_reference',coalesce(r.source_reference,''),
  'evidence_required',t.evidence_required,'evidence_kind',r.evidence_kind,
  'evidence_id',r.evidence_id,'final_only',t.final_only,
  'saved',r.code is not null,'approved',r.approved_at is not null,'published',r.published_at is not null)
  order by t.kind,t.code),'[]'::jsonb) into v_list
 from private.story_supplement_templates t
 left join private.story_supplement_releases r on r.game_id=p_game_id and r.code=t.code;
 return v_list;
end $f$;