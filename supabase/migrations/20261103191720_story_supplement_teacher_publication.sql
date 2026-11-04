create or replace function public.publish_story_supplement_teacher(p_game_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path=''
as $f$
declare c private.story_campaigns%rowtype;t private.story_supplement_templates%rowtype;
 r private.story_supplement_releases%rowtype;v_stage integer;v_post uuid;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Доступ разрешён только преподавателю игры.' using errcode='42501';
 end if;
 select * into c from private.story_campaigns where game_id=p_game_id for update;
 select * into t from private.story_supplement_templates where code=p_code;
 select * into r from private.story_supplement_releases where game_id=p_game_id and code=p_code for update;
 if r.published_post_id is not null then
  return jsonb_build_object('published',true,'already_published',true,'post_id',r.published_post_id);
 end if;
 if t.code is null or r.code is null or r.approved_at is null then raise exception 'Сначала сохраните и утвердите материал.';end if;
 if t.final_only then raise exception 'К-30 не является отдельной новостью: он включается в ЭП-24.';end if;
 if c.game_id is null or not c.enabled or c.current_episode=24 then raise exception 'Сюжетная кампания выключена или завершена.';end if;
 select current_round into v_stage from public.games where id=p_game_id;
 if v_stage not between t.stage_from and t.stage_to or c.current_episode<t.after_episode
 or not exists(select 1 from public.game_stages where game_id=p_game_id and stage_no=v_stage and status='open') then
  raise exception 'Окно публикации не наступило или уже закрыто.';
 end if;
 if t.evidence_required and not private.story_supplement_evidence_exists(p_game_id,r.evidence_kind,r.evidence_id) then
  raise exception 'Подтверждающая запись недоступна.';
 end if;
 if r.draft_body ~ '@[[:alpha:]0-9_]' then raise exception 'Упоминания @ запрещены для исключения лишних уведомлений.';end if;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,
 title,body,tags,source_key,context,status,impact_plan,effects_applied)
 values(p_game_id,auth.uid(),'news','system','ГОС.ID · Сюжетная хроника',
  r.draft_title,r.draft_body,
  array['Сюжет','Горизонты Республики',case when t.kind='archive' then 'Архив' else 'Короткая новость' end],
  'story_supplement:'||p_code,
  jsonb_build_object('automatic',true,'source_table','story_campaign','story_campaign',true,
    'story_supplement',p_code,'story_kind',t.kind,'story_stage',v_stage),
  'published','{"metrics":{}}'::jsonb,false)
 on conflict(game_id,source_key) where source_key is not null do nothing returning id into v_post;
 if v_post is null then raise exception 'Этот материал уже существует в хронике.';end if;
 update private.story_supplement_releases set published_post_id=v_post,published_at=now(),published_by=auth.uid()
 where game_id=p_game_id and code=p_code;
 return jsonb_build_object('published',true,'already_published',false,'post_id',v_post);
end $f$;

revoke all on function public.get_story_supplements_teacher(uuid),
 public.save_story_supplement_teacher(uuid,text,text,text,text,text,uuid),
 public.approve_story_supplement_teacher(uuid,text,boolean),
 public.publish_story_supplement_teacher(uuid,text) from public,anon;
grant execute on function public.get_story_supplements_teacher(uuid),
 public.save_story_supplement_teacher(uuid,text,text,text,text,text,uuid),
 public.approve_story_supplement_teacher(uuid,text,boolean),
 public.publish_story_supplement_teacher(uuid,text) to authenticated;