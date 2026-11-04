-- Teacher-confirmed one-time story reaction, never a replacement for official decisions.
alter table private.story_branch_rules add column if not exists recorded_body text not null default '';
alter table private.story_branch_rules add column if not exists neutral_body text not null default '';
alter table private.story_branch_reviews add column if not exists published_at timestamptz;
alter table private.story_branch_reviews add column if not exists published_post_id uuid references public.political_posts(id);

create or replace function public.save_story_branch_review_teacher(
 p_game_id uuid,p_branch_no smallint,p_outcome text,
 p_evidence_kind text default null,p_evidence_id uuid default null,p_teacher_note text default '')
returns jsonb language plpgsql security definer set search_path=''
as $f$
declare rule private.story_branch_rules%rowtype; v_round integer;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Доступ разрешён только преподавателю игры.' using errcode='42501';
 end if;
 select * into rule from private.story_branch_rules where branch_no=p_branch_no;
 if rule.branch_no is null or p_outcome not in ('recorded','neutral','undetermined') then
  raise exception 'Некорректный вариант проверки.';
 end if;
 if not exists(select 1 from private.story_campaigns where game_id=p_game_id) then
  raise exception 'Кампания не подготовлена.';
 end if;
 if exists(select 1 from private.story_branch_reviews where game_id=p_game_id and branch_no=p_branch_no and published_at is not null) then
  raise exception 'Опубликованную реакцию нельзя менять.';
 end if;
 if length(coalesce(p_teacher_note,''))>1500 then raise exception 'Примечание слишком длинное.';end if;
 select current_round into v_round from public.games where id=p_game_id;
 if v_round < (select stage_no from private.story_episode_drafts where episode_no=rule.first_episode) then
  raise exception 'Сюжетная развилка ещё не открыта.';
 end if;
 if p_outcome='recorded' and
  (not private.story_supplement_evidence_exists(p_game_id,p_evidence_kind,p_evidence_id)
   or length(btrim(coalesce(p_teacher_note,'')))<15) then
  raise exception 'Укажите существующее подтверждение игры и смысл решения.';
 end if;
 insert into private.story_branch_reviews(game_id,branch_no,outcome,evidence_kind,evidence_id,teacher_note,reviewed_by,reviewed_at)
 values(p_game_id,p_branch_no,p_outcome,p_evidence_kind,p_evidence_id,btrim(coalesce(p_teacher_note,'')),auth.uid(),now())
 on conflict(game_id,branch_no) do update set outcome=excluded.outcome,evidence_kind=excluded.evidence_kind,
 evidence_id=excluded.evidence_id,teacher_note=excluded.teacher_note,reviewed_by=excluded.reviewed_by,reviewed_at=now()
 where private.story_branch_reviews.published_at is null;
 return jsonb_build_object('saved',true,'branch_no',p_branch_no,'outcome',p_outcome);
end $f$;