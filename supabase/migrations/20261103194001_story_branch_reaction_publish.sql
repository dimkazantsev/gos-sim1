create or replace function public.publish_story_branch_reaction_teacher(p_game_id uuid,p_branch_no smallint)
returns jsonb language plpgsql security definer set search_path=''
as $f$
declare c private.story_campaigns%rowtype; r private.story_branch_reviews%rowtype;
 rule private.story_branch_rules%rowtype; v_stage integer;v_first_stage integer;v_last_stage integer;
 v_body text;v_post uuid;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Доступ разрешён только преподавателю игры.' using errcode='42501';
 end if;
 select * into c from private.story_campaigns where game_id=p_game_id for update;
 select * into rule from private.story_branch_rules where branch_no=p_branch_no;
 select * into r from private.story_branch_reviews where game_id=p_game_id and branch_no=p_branch_no for update;
 if r.published_post_id is not null then
  return jsonb_build_object('published',true,'already_published',true,'post_id',r.published_post_id);
 end if;
 if c.game_id is null or not c.enabled or c.current_episode>=24 then
  raise exception 'Кампания выключена или завершена.';
 end if;
 if rule.branch_no is null or r.branch_no is null or r.outcome='undetermined' then
  raise exception 'Сначала подтвердите конкретный исход и источник.';
 end if;
 select current_round into v_stage from public.games where id=p_game_id;
 select stage_no into v_first_stage from private.story_episode_drafts where episode_no=rule.first_episode;
 select stage_no into v_last_stage from private.story_episode_drafts where episode_no=rule.last_episode;
 if c.current_episode < rule.first_episode or v_stage not between v_first_stage and least(14,v_last_stage+1) then
  raise exception 'Сюжетная развилка ещё не наступила или её окно закрыто.';
 end if;
 if r.outcome='recorded' then
  if not private.story_supplement_evidence_exists(p_game_id,r.evidence_kind,r.evidence_id) then
   raise exception 'Подтверждающий государственный документ или результат недоступен.';
  end if;
  v_body:=rule.recorded_body;
 else
  if v_stage<=v_last_stage and exists(select 1 from public.game_stages
   where game_id=p_game_id and stage_no=v_last_stage and status='open') then
   raise exception 'Нейтральную реакцию можно опубликовать только после завершения окна рассмотрения.';
  end if;
  v_body:=rule.neutral_body;
 end if;
 if length(btrim(coalesce(v_body,'')))<80 then raise exception 'Редакционная реакция не подготовлена.';end if;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,
 title,body,tags,source_key,context,status,impact_plan,effects_applied)
 values(p_game_id,auth.uid(),'news','system','ГОС.ID · Сюжетная хроника',
 'Горизонты: '||rule.title,v_body,array['Сюжет','Горизонты Республики','Реакция'],
 'story_branch:'||lpad(p_branch_no::text,2,'0'),
 jsonb_build_object('automatic',true,'source_table','story_campaign',
  'story_campaign',true,'story_branch',p_branch_no,'story_stage',v_stage),
 'published','{"metrics":{}}'::jsonb,false)
 on conflict(game_id,source_key) where source_key is not null do nothing returning id into v_post;
 if v_post is null then raise exception 'Реакция уже зарегистрирована в хронике.';end if;
 update private.story_branch_reviews set published_post_id=v_post,published_at=now()
 where game_id=p_game_id and branch_no=p_branch_no;
 return jsonb_build_object('published',true,'already_published',false,'post_id',v_post);
end $f$;

create or replace function public.get_story_branches_teacher(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $f$
declare v_result jsonb;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Доступ разрешён только преподавателю игры.' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'branch_no',b.branch_no,'first_episode',b.first_episode,'last_episode',b.last_episode,
  'title',b.title,'when_recorded',b.when_recorded,'when_absent',b.when_absent,
  'evidence_description',b.evidence_description,
  'automatic_evidence',case b.branch_no
   when 6 then exists(select 1 from public.government_program_agenda a join public.game_votes v
    on v.id=a.vote_id and v.game_id=a.game_id where a.game_id=p_game_id and v.status='closed')
   when 7 then exists(select 1 from public.game_votes v join public.formal_documents d
    on d.id=v.formal_document_id and d.game_id=v.game_id where v.game_id=p_game_id and v.stage_no=12 and v.status='closed')
   when 8 then exists(select 1 from public.game_votes v join public.formal_documents d
    on d.id=v.formal_document_id and d.game_id=v.game_id and d.doc_type='federal_budget'
    where v.game_id=p_game_id and v.stage_no=13 and v.status='closed')
   when 9 then exists(select 1 from public.municipal_projects p join public.game_votes v
    on v.id=p.vote_id and v.game_id=p.game_id where p.game_id=p_game_id and p.stage_no=14 and v.status='closed')
   else null::boolean end,
  'reviewed_outcome',r.outcome,'reviewed_at',r.reviewed_at,
  'evidence_kind',r.evidence_kind,'evidence_id',r.evidence_id,
  'teacher_note',r.teacher_note,'published',r.published_at is not null)
  order by b.branch_no),'[]'::jsonb) into v_result
 from private.story_branch_rules b left join private.story_branch_reviews r
  on r.game_id=p_game_id and r.branch_no=b.branch_no;
 return v_result;
end $f$;
revoke all on function public.publish_story_branch_reaction_teacher(uuid,smallint) from public,anon;
grant execute on function public.publish_story_branch_reaction_teacher(uuid,smallint) to authenticated;