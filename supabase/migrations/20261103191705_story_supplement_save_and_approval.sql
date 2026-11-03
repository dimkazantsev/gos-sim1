create or replace function public.save_story_supplement_teacher(
 p_game_id uuid,p_code text,p_title text,p_body text,p_source_reference text default '',
 p_evidence_kind text default null,p_evidence_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $f$
declare t private.story_supplement_templates%rowtype;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Доступ разрешён только преподавателю игры.' using errcode='42501';
 end if;
 if not exists(select 1 from private.story_campaigns c where c.game_id=p_game_id) then
  raise exception 'Сначала подготовьте кампанию.';
 end if;
 select * into t from private.story_supplement_templates where code=p_code;
 if t.code is null then raise exception 'Материал не найден.';end if;
 if length(btrim(coalesce(p_title,''))) not between 8 and 200
 or length(btrim(coalesce(p_body,''))) not between 80 and 9000 then
  raise exception 'Заголовок или текст слишком короткий либо длинный.';
 end if;
 if length(coalesce(p_source_reference,''))>500 then raise exception 'Источник слишком длинный.';end if;
 insert into private.story_supplement_releases(game_id,code,draft_title,draft_body,source_reference,evidence_kind,evidence_id)
 values(p_game_id,p_code,btrim(p_title),btrim(p_body),btrim(coalesce(p_source_reference,'')),p_evidence_kind,p_evidence_id)
 on conflict(game_id,code) do update set draft_title=excluded.draft_title,
  draft_body=excluded.draft_body,source_reference=excluded.source_reference,
  evidence_kind=excluded.evidence_kind,evidence_id=excluded.evidence_id,
  approved_by=null,approved_at=null
 where private.story_supplement_releases.published_at is null;
 if not found then raise exception 'Опубликованный материал нельзя редактировать.';end if;
 return jsonb_build_object('saved',true,'code',p_code);
end $f$;

create or replace function public.approve_story_supplement_teacher(p_game_id uuid,p_code text,p_approved boolean)
returns jsonb language plpgsql security definer set search_path=''
as $f$
declare r private.story_supplement_releases%rowtype; t private.story_supplement_templates%rowtype;
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then
  raise exception 'Доступ разрешён только преподавателю игры.' using errcode='42501';
 end if;
 select * into t from private.story_supplement_templates where code=p_code;
 select * into r from private.story_supplement_releases where game_id=p_game_id and code=p_code for update;
 if t.code is null or r.code is null then raise exception 'Сначала сохраните редакцию.';end if;
 if r.published_at is not null then raise exception 'Опубликованное нельзя отозвать.';end if;
 if p_approved then
  if t.kind='archive' and length(btrim(r.source_reference))<12 then
   raise exception 'Для архива требуется проверенный оригинал и указание источника.';
  end if;
  if t.evidence_required and
   (length(btrim(r.source_reference))<12 or not private.story_supplement_evidence_exists(p_game_id,r.evidence_kind,r.evidence_id)) then
   raise exception 'Нужна ссылка на действительную запись игры, подтверждающую содержание.';
  end if;
 end if;
 update private.story_supplement_releases set approved_by=case when p_approved then auth.uid() end,
 approved_at=case when p_approved then now() end where game_id=p_game_id and code=p_code;
 return jsonb_build_object('approved',p_approved,'code',p_code);
end $f$;