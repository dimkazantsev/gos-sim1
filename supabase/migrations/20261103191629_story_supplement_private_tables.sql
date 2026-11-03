-- Structured story supplement templates; no original unpublished plot text in public Git.
create table if not exists private.story_supplement_templates (
 code text primary key,kind text not null check(kind in ('short_news','archive')),
 stage_from integer not null check(stage_from between 4 and 14),
 stage_to integer not null check(stage_to between 4 and 14),
 after_episode integer not null check(after_episode between 1 and 24),
 title text not null,requirement text not null,template_body text not null default '',
 source_status text not null,evidence_required boolean not null default false,
 final_only boolean not null default false,check(stage_from<=stage_to)
);
create table if not exists private.story_supplement_releases (
 game_id uuid not null references private.story_campaigns(game_id) on delete cascade,
 code text not null references private.story_supplement_templates(code),
 draft_title text not null,draft_body text not null,source_reference text not null default '',
 evidence_kind text,evidence_id uuid,approved_by uuid,approved_at timestamptz,
 published_at timestamptz,published_by uuid,published_post_id uuid references public.political_posts(id),
 primary key(game_id,code),check(published_at is null or (approved_at is not null and published_post_id is not null))
);
alter table private.story_supplement_templates enable row level security;
alter table private.story_supplement_releases enable row level security;
revoke all on private.story_supplement_templates,private.story_supplement_releases from public,anon,authenticated;