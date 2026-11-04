-- Teacher-only story branch evidence. No change to votes, assessments or state metrics.
create table if not exists private.story_branch_rules (
 branch_no smallint primary key check(branch_no between 1 and 9),
 first_episode smallint not null check(first_episode between 1 and 24),
 last_episode smallint not null check(last_episode between 1 and 24),
 title text not null,
 when_recorded text not null,
 when_absent text not null,
 evidence_description text not null
);
create table if not exists private.story_branch_reviews (
 game_id uuid not null references private.story_campaigns(game_id) on delete cascade,
 branch_no smallint not null references private.story_branch_rules(branch_no),
 outcome text not null check(outcome in ('recorded','neutral','undetermined')),
 evidence_kind text,evidence_id uuid,teacher_note text not null default '',
 reviewed_by uuid not null,reviewed_at timestamptz not null default now(),
 primary key(game_id,branch_no)
);
alter table private.story_branch_rules enable row level security;
alter table private.story_branch_reviews enable row level security;
revoke all on private.story_branch_rules,private.story_branch_reviews from public,anon,authenticated;

create or replace function public.get_story_branches_teacher(p_game_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
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
    on d.id=v.formal_document_id and d.game_id=v.game_id
    where v.game_id=p_game_id and v.stage_no=12 and v.status='closed')
   when 8 then exists(select 1 from public.game_votes v join public.formal_documents d
    on d.id=v.formal_document_id and d.game_id=v.game_id and d.doc_type='federal_budget'
    where v.game_id=p_game_id and v.stage_no=13 and v.status='closed')
   when 9 then exists(select 1 from public.municipal_projects p join public.game_votes v
    on v.id=p.vote_id and v.game_id=p.game_id where p.game_id=p_game_id and p.stage_no=14 and v.status='closed')
   else null::boolean end,
  'reviewed_outcome',r.outcome,'reviewed_at',r.reviewed_at,
  'evidence_kind',r.evidence_kind,'evidence_id',r.evidence_id,
  'teacher_note',r.teacher_note) order by b.branch_no),'[]'::jsonb) into v_result
 from private.story_branch_rules b left join private.story_branch_reviews r
  on r.game_id=p_game_id and r.branch_no=b.branch_no;
 return v_result;
end $fn$;

create or replace function public.save_story_branch_review_teacher(
 p_game_id uuid,p_branch_no smallint,p_outcome text,
 p_evidence_kind text default null,p_evidence_id uuid default null,p_teacher_note text default '')
returns jsonb language plpgsql security definer set search_path=''
as $fn$
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
 evidence_id=excluded.evidence_id,teacher_note=excluded.teacher_note,reviewed_by=excluded.reviewed_by,reviewed_at=now();
 return jsonb_build_object('saved',true,'branch_no',p_branch_no,'outcome',p_outcome);
end $fn$;
revoke all on function public.get_story_branches_teacher(uuid),
 public.save_story_branch_review_teacher(uuid,smallint,text,text,uuid,text) from public,anon;
grant execute on function public.get_story_branches_teacher(uuid),
 public.save_story_branch_review_teacher(uuid,smallint,text,text,uuid,text) to authenticated;