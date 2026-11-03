create or replace function private.story_supplement_evidence_exists(p_game uuid,p_kind text,p_id uuid)
returns boolean language sql stable security definer set search_path=''
as $f$
select case
 when p_id is null then false
 when p_kind='political_post' then exists(select 1 from public.political_posts p where p.id=p_id and p.game_id=p_game and p.status='published' and coalesce(p.context->>'story_campaign','false')<>'true')
 when p_kind='formal_document' then exists(select 1 from public.formal_documents d where d.id=p_id and d.game_id=p_game and d.status_code='published')
 when p_kind='game_vote' then exists(select 1 from public.game_votes v where v.id=p_id and v.game_id=p_game and v.status='closed')
 when p_kind='municipal_project' then exists(select 1 from public.municipal_projects m where m.id=p_id and m.game_id=p_game)
 when p_kind='government_program' then exists(select 1 from public.government_program_agenda a where a.id=p_id and a.game_id=p_game)
 else false end;
$f$;
revoke all on function private.story_supplement_evidence_exists(uuid,text,uuid) from public,anon,authenticated;

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
  'approved',r.approved_at is not null,'published',r.published_at is not null)
  order by t.kind,t.code),'[]'::jsonb) into v_list
 from private.story_supplement_templates t
 left join private.story_supplement_releases r on r.game_id=p_game_id and r.code=t.code;
 return v_list;
end $f$;