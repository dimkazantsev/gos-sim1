-- New stage closures create a factual chapter and a preview. No fabricated backfill.
create table public.republic_comic_chapters(
 id uuid primary key default gen_random_uuid(),game_id uuid not null references games(id) on delete cascade,
 stage_no integer not null check(stage_no between 1 and 16),kind text not null check(kind in ('completed','preview')),
 title text not null,body text not null,snapshot jsonb not null default '{}',created_at timestamptz not null default now(),
 unique(game_id,stage_no,kind)
);
alter table public.republic_comic_chapters enable row level security;
create policy comic_chapters_member_select on public.republic_comic_chapters for select to authenticated using(private.is_game_member(game_id));
revoke all on public.republic_comic_chapters from public,anon,authenticated;
grant select on public.republic_comic_chapters to authenticated;
create or replace function private.capture_completed_stage_comic() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare docs integer;finished integer;votes integer;passed integer;uid uuid;next_stage game_stages%rowtype;chapter_body text;snap jsonb;
begin
 if new.status<>'completed' or old.status='completed' then return new;end if;
 select count(*),count(*) filter(where status_code in ('published','adopted','signed')) into docs,finished from formal_documents where game_id=new.game_id and stage_no=new.stage_no;
 select count(*),count(*) filter(where result_code='passed') into votes,passed from game_votes where game_id=new.game_id and stage_no=new.stage_no;
 snap:=jsonb_build_object('documents',docs,'finished_documents',finished,'votes',votes,'passed_votes',passed,'metrics',(select jsonb_object_agg(metric_key,value) from state_metrics where game_id=new.game_id),'document_ids',(select coalesce(jsonb_agg(id),'[]') from formal_documents where game_id=new.game_id and stage_no=new.stage_no),'vote_ids',(select coalesce(jsonb_agg(id),'[]') from game_votes where game_id=new.game_id and stage_no=new.stage_no));
 chapter_body:=coalesce(new.summary,'')||E'\n\nИтог главы: документов — '||docs||', завершили процедуру — '||finished||'. Голосований — '||votes||', решений принято — '||passed||'. Подробные результаты сохранены в документах и голосованиях этапа.';
 insert into republic_comic_chapters(game_id,stage_no,kind,title,body,snapshot) values(new.game_id,new.stage_no,'completed',new.title,chapter_body,snap) on conflict do nothing;
 select * into next_stage from game_stages where game_id=new.game_id and stage_no=new.stage_no+1;
 if next_stage.id is not null then insert into republic_comic_chapters(game_id,stage_no,kind,title,body,snapshot) values(new.game_id,next_stage.stage_no,'preview','Следующая глава: '||next_stage.title,coalesce(next_stage.summary,'')||E'\n\nИзучите задачи этапа, подготовьте формы и договоритесь, кто действует от каждого института.',jsonb_build_object('after_stage',new.stage_no)) on conflict do nothing;end if;
 -- Enrich the existing automatic stage news, rather than creating a duplicate.
 update political_posts set actor_key='media',actor_label='Республиканский обозреватель',body=political_posts.body||E'\n\n'||private.stage_comic_summary(snap),tags=array['этап_gpyasu','итоги_gpyasu','сми_gpyasu'],context=context||jsonb_build_object('stage_snapshot',snap) where game_id=new.game_id and source_key like 'stage:'||new.id::text||':completed:%';
 return new;
end$$;
create or replace function private.stage_comic_summary(p jsonb) returns text language sql immutable as $$ select 'Документы: '||coalesce(p->>'documents','0')||'. Завершено процедур: '||coalesce(p->>'finished_documents','0')||'. Голосования: '||coalesce(p->>'votes','0')||'. Принято: '||coalesce(p->>'passed_votes','0')||'.' $$;
create trigger zz_capture_stage_comic after update of status on public.game_stages for each row execute function private.capture_completed_stage_comic();
revoke all on function private.capture_completed_stage_comic(),private.stage_comic_summary(jsonb) from public,anon,authenticated;
