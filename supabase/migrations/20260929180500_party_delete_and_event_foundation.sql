-- Teacher-only party disposal, including the party's own publications, documents and relationships.
-- File objects are returned to the client for explicit Storage removal (not silently assumed).
create or replace function public.delete_party_with_assets(p_party_id uuid)
returns jsonb language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare p public.game_parties%rowtype; assets jsonb; posts uuid[]; result jsonb;
begin
 select * into p from public.game_parties where id=p_party_id for update;
 if not found then raise exception 'Party not found';end if;
 if not private.is_game_teacher(p.game_id) then raise exception 'Teacher access required';end if;
 if private.has_open_duma_mandate_vote(p.game_id) then raise exception 'Close State Duma mandate votes before deleting this party';end if;
 select coalesce(jsonb_agg(jsonb_build_object('bucket','game-assets','path',path)),'[]'::jsonb) into assets from
 (select storage_path path from public.party_documents where party_id=p.id
  union select logo_path from public.game_parties where id=p.id and logo_path is not null
  union select pm.storage_path from public.political_post_media pm
    join public.political_posts pp on pp.id=pm.post_id
    where pp.game_id=p.game_id and pp.actor_key='party' and pp.actor_label=p.name) paths;
 select coalesce(array_agg(id),'{}'::uuid[]) into posts
 from public.political_posts where game_id=p.game_id and actor_key='party' and actor_label=p.name;
 -- Preserve teacher audit records and independent state acts that are not unambiguously party property.
 update public.game_members set team=null,party_joined_at=null where game_id=p.game_id and team=p.name;
 update public.chat_channels set name='Архив фракции · '||p.name
  where game_id=p.game_id and name='Фракция · '||p.name;
 delete from public.political_posts where id=any(posts);
 delete from public.game_parties where id=p.id;
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(p.game_id,auth.uid(),'party_deleted','game_parties',
 jsonb_build_object('party_name',p.name,'party_id',p.id,'deleted_posts',cardinality(posts),'assets',assets));
 result:=jsonb_build_object('party_name',p.name,'deleted_posts',cardinality(posts),'assets',assets);
 return result;
end;
$$;
revoke all on function public.delete_party_with_assets(uuid) from public,anon;
grant execute on function public.delete_party_with_assets(uuid) to authenticated;

-- Case library schema: content import will follow separate editorial and source validation.
create table if not exists public.event_cases (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 case_key text not null, title text not null, situation text not null,
 category text not null, seriousness text not null check(seriousness in ('serious','light')),
 audience text not null check(audience in ('single','group','all')),
 allowed_roles text[] not null default '{}', decision_options jsonb not null default '["Принять","Отклонить"]'::jsonb,
 effect_plan jsonb not null default '{}'::jsonb,
 source_url text,source_note text,verified boolean not null default false,
 status text not null default 'draft' check(status in ('draft','ready','archived')),
 created_by uuid,created_at timestamptz not null default now(),unique(game_id,case_key)
);
create table if not exists public.event_assignments (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.event_cases(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 recipient_id uuid not null, status text not null default 'pending'
 check(status in ('pending','accepted','rejected','resolved')),
 created_by uuid,created_at timestamptz not null default now(),
 unique(case_id,recipient_id)
);
create table if not exists public.event_decisions (
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null references public.event_assignments(id) on delete cascade,
 case_id uuid not null references public.event_cases(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 actor_id uuid not null, choice text not null check(choice in ('accept','reject')),
 rationale text,created_at timestamptz not null default now(),
 unique(case_id,actor_id)
);
alter table public.event_cases enable row level security;
alter table public.event_assignments enable row level security;
alter table public.event_decisions enable row level security;
create policy event_case_teacher on public.event_cases for all to authenticated
 using(private.is_game_teacher(game_id)) with check(private.is_game_teacher(game_id));
create policy event_case_invited on public.event_cases for select to authenticated
 using(exists(select 1 from public.event_assignments a where a.case_id=id and a.recipient_id=auth.uid()));
create policy event_assignment_read on public.event_assignments for select to authenticated
 using(private.is_game_teacher(game_id) or recipient_id=auth.uid());
create policy event_assignment_teacher on public.event_assignments for all to authenticated
 using(private.is_game_teacher(game_id)) with check(private.is_game_teacher(game_id));
create policy event_decision_read on public.event_decisions for select to authenticated
 using(private.is_game_teacher(game_id) or exists(select 1 from public.event_assignments a where a.case_id=case_id and a.recipient_id=auth.uid()));
create policy event_decision_self on public.event_decisions for insert to authenticated
 with check(actor_id=auth.uid() and exists(
 select 1 from public.event_assignments a where a.id=assignment_id and a.case_id=case_id and a.game_id=game_id and a.recipient_id=auth.uid() and a.status='pending'));
grant select,insert,update,delete on public.event_cases to authenticated;
grant select,insert,update,delete on public.event_assignments to authenticated;
grant select,insert on public.event_decisions to authenticated;

create or replace function public.submit_event_decision(p_assignment_id uuid,p_choice text,p_rationale text default null)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a public.event_assignments%rowtype;
begin
 select * into a from public.event_assignments where id=p_assignment_id for update;
 if not found or a.recipient_id<>auth.uid() then raise exception 'Assignment unavailable';end if;
 if a.status<>'pending' then raise exception 'Already decided';end if;
 if p_choice not in ('accept','reject') then raise exception 'Invalid choice';end if;
 insert into public.event_decisions(assignment_id,case_id,game_id,actor_id,choice,rationale)
 values(a.id,a.case_id,a.game_id,auth.uid(),p_choice,p_rationale);
 update public.event_assignments set status=case when p_choice='accept' then 'accepted' else 'rejected' end where id=a.id;
end;
$$;
revoke all on function public.submit_event_decision(uuid,text,text) from public,anon;
grant execute on function public.submit_event_decision(uuid,text,text) to authenticated;
