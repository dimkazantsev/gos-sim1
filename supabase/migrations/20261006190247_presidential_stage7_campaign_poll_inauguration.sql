alter table public.presidential_candidates
 add column if not exists photo_path text;

create table if not exists public.presidential_campaign_materials(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 candidate_id uuid not null references public.presidential_candidates(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete cascade,
 title text not null,
 body text not null,
 material_type text not null default 'poster' check(material_type in ('poster','leaflet','video','audio','news','other')),
 print_run integer not null default 0 check(print_run>=0),
 publisher_name text,
 production_date date,
 imprint_text text,
 external_url text,
 files jsonb not null default '[]'::jsonb,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 review_note text,
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz,
 post_id uuid references public.political_posts(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists presidential_campaign_game_idx on public.presidential_campaign_materials(game_id,status,created_at desc);

create table if not exists public.presidential_poll_decision(
 game_id uuid primary key references public.games(id) on delete cascade,
 status text not null default 'open' check(status in ('open','closed')),
 result boolean,
 opened_at timestamptz not null default now(),
 closed_at timestamptz,
 created_by uuid references auth.users(id) on delete set null
);
create table if not exists public.presidential_poll_decision_votes(
 game_id uuid not null references public.games(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 choice boolean not null,
 created_at timestamptz not null default now(),
 primary key(game_id,user_id)
);

create table if not exists public.presidential_public_polls(
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 round_no integer not null default 1 check(round_no in (1,2)),
 slug text not null unique,
 title text not null default 'Социологический опрос: выборы Президента РФ',
 status text not null default 'draft' check(status in ('draft','open','closed')),
 opened_at timestamptz,
 closes_at timestamptz,
 closed_at timestamptz,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(game_id,round_no)
);
create table if not exists public.presidential_public_poll_votes(
 poll_id uuid not null references public.presidential_public_polls(id) on delete cascade,
 candidate_id uuid not null references public.presidential_candidates(id) on delete cascade,
 voter_token text not null,
 created_at timestamptz not null default now(),
 primary key(poll_id,voter_token)
);
create index if not exists presidential_public_poll_candidate_idx on public.presidential_public_poll_votes(poll_id,candidate_id);

create table if not exists public.presidential_inauguration(
 game_id uuid primary key references public.games(id) on delete cascade,
 scheduled_at timestamptz,
 venue text,
 notes text,
 hymn_path text,
 ceremonial_music_path text,
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);

alter table public.presidential_campaign_materials enable row level security;
alter table public.presidential_poll_decision enable row level security;
alter table public.presidential_poll_decision_votes enable row level security;
alter table public.presidential_public_polls enable row level security;
alter table public.presidential_public_poll_votes enable row level security;
alter table public.presidential_inauguration enable row level security;

revoke all on public.presidential_campaign_materials,public.presidential_poll_decision,public.presidential_poll_decision_votes,public.presidential_public_polls,public.presidential_public_poll_votes,public.presidential_inauguration from anon,authenticated;
grant select on public.presidential_campaign_materials,public.presidential_poll_decision,public.presidential_poll_decision_votes,public.presidential_public_polls,public.presidential_public_poll_votes,public.presidential_inauguration to authenticated;

create policy presidential_campaign_read on public.presidential_campaign_materials for select to authenticated
using(private.is_game_member(game_id));
create policy presidential_poll_decision_read on public.presidential_poll_decision for select to authenticated
using(private.is_game_member(game_id));
create policy presidential_poll_decision_votes_read on public.presidential_poll_decision_votes for select to authenticated
using(private.is_game_member(game_id));
create policy presidential_public_polls_read on public.presidential_public_polls for select to authenticated
using(private.is_game_member(game_id));
create policy presidential_public_poll_votes_read on public.presidential_public_poll_votes for select to authenticated
using(private.is_game_member((select game_id from public.presidential_public_polls p where p.id=poll_id)));
create policy presidential_inauguration_read on public.presidential_inauguration for select to authenticated
using(private.is_game_member(game_id));

create or replace function public.set_presidential_candidate_photo(p_candidate_id uuid,p_storage_path text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());
begin
 select * into c from public.presidential_candidates where id=p_candidate_id and archived_at is null for update;
 if c.id is null then raise exception 'Candidate not found';end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate dossier access required';end if;
 if length(trim(coalesce(p_storage_path,'')))<3 then raise exception 'Photo path required';end if;
 update public.presidential_candidates set photo_path=trim(p_storage_path),updated_at=now() where id=c.id;
end;$$;
revoke all on function public.set_presidential_candidate_photo(uuid,text) from public,anon;
grant execute on function public.set_presidential_candidate_photo(uuid,text) to authenticated;

create or replace function public.submit_presidential_campaign_material(
 p_candidate_id uuid,p_title text,p_body text,p_material_type text,p_print_run integer,
 p_publisher_name text,p_production_date date,p_imprint_text text,p_external_url text,p_files jsonb
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into c from public.presidential_candidates where id=p_candidate_id and archived_at is null;
 if c.id is null or c.registration_status<>'registered' then raise exception 'Only registered candidate may submit campaign materials';end if;
 if not private.can_manage_presidential_candidate(c.id,v_uid) then raise exception 'Candidate campaign access required';end if;
 if length(trim(coalesce(p_title,'')))<3 or length(trim(coalesce(p_body,'')))<3 then raise exception 'Title and text are required';end if;
 if p_material_type not in ('poster','leaflet','video','audio','news','other') then raise exception 'Unsupported material type';end if;
 if p_print_run<0 then raise exception 'Print run cannot be negative';end if;
 if p_material_type in ('poster','leaflet') and (p_print_run<=0 or length(trim(coalesce(p_imprint_text,'')))<3) then
  raise exception 'Printed campaign material requires print run and imprint data';
 end if;
 insert into public.presidential_campaign_materials(game_id,candidate_id,author_id,title,body,material_type,print_run,publisher_name,production_date,imprint_text,external_url,files)
 values(c.game_id,c.id,v_uid,trim(p_title),trim(p_body),p_material_type,p_print_run,nullif(trim(coalesce(p_publisher_name,'')),''),p_production_date,
  nullif(trim(coalesce(p_imprint_text,'')),''),nullif(trim(coalesce(p_external_url,'')),''),coalesce(p_files,'[]'::jsonb))
 returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.submit_presidential_campaign_material(uuid,text,text,text,integer,text,date,text,text,jsonb) from public,anon;
grant execute on function public.submit_presidential_campaign_material(uuid,text,text,text,integer,text,date,text,text,jsonb) to authenticated;

create or replace function public.review_presidential_campaign_material(p_material_id uuid,p_approve boolean,p_note text default null)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare m public.presidential_campaign_materials%rowtype;c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_post uuid;f jsonb;
begin
 select * into m from public.presidential_campaign_materials where id=p_material_id for update;
 if m.id is null then raise exception 'Material not found';end if;
 if not private.is_game_teacher(m.game_id) then raise exception 'Teacher / CEC access required';end if;
 if m.status<>'pending' then raise exception 'Material already reviewed';end if;
 select * into c from public.presidential_candidates where id=m.candidate_id;
 if p_approve then
  insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,external_url,internal_view,internal_ref_id,source_key,context)
  values(m.game_id,m.author_id,'information','candidate:'||c.id::text,c.display_name,m.title,
   m.body||E'\n\nВыходные данные: '||coalesce(m.imprint_text,'не применяются')||
   case when m.print_run>0 then E'\nТираж: '||m.print_run::text else '' end||
   case when m.publisher_name is not null then E'\nИзготовитель/распространитель: '||m.publisher_name else '' end,
   array['выборы_gpyasu','президент_gpyasu','агитация_gpyasu'],m.external_url,'stages',m.candidate_id::text,
   'presidential-campaign:'||m.id::text,
   jsonb_build_object('automatic',true,'stage_no',7,'candidate_id',m.candidate_id,'campaign_material_id',m.id,'print_run',m.print_run,'imprint_text',m.imprint_text))
  returning id into v_post;
  for f in select * from jsonb_array_elements(coalesce(m.files,'[]'::jsonb)) loop
   insert into public.political_post_media(game_id,post_id,uploader_id,media_kind,storage_path,file_name,mime_type,file_size)
   values(m.game_id,v_post,m.author_id,coalesce(f->>'media_kind','file'),f->>'storage_path',f->>'file_name',f->>'mime_type',nullif(f->>'file_size','')::bigint);
  end loop;
 end if;
 update public.presidential_campaign_materials
 set status=case when p_approve then 'approved' else 'rejected' end,review_note=nullif(trim(coalesce(p_note,'')),''),
  reviewed_by=v_uid,reviewed_at=now(),post_id=v_post
 where id=m.id;
 return v_post;
end;$$;
revoke all on function public.review_presidential_campaign_material(uuid,boolean,text) from public,anon;
grant execute on function public.review_presidential_campaign_material(uuid,boolean,text) to authenticated;

create or replace function public.open_presidential_poll_decision(p_game_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 insert into public.presidential_poll_decision(game_id,status,result,opened_at,closed_at,created_by)
 values(p_game_id,'open',null,now(),null,(select auth.uid()))
 on conflict(game_id) do update set status='open',result=null,opened_at=now(),closed_at=null,created_by=(select auth.uid());
 delete from public.presidential_poll_decision_votes where game_id=p_game_id;
end;$$;
revoke all on function public.open_presidential_poll_decision(uuid) from public,anon;
grant execute on function public.open_presidential_poll_decision(uuid) to authenticated;

create or replace function public.vote_presidential_poll_decision(p_game_id uuid,p_choice boolean)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_uid uuid:=(select auth.uid());
begin
 if not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 if not exists(select 1 from public.game_members where game_id=p_game_id and user_id=v_uid and kind='student') then raise exception 'Student vote required';end if;
 if not exists(select 1 from public.presidential_poll_decision where game_id=p_game_id and status='open') then raise exception 'Vote is closed';end if;
 insert into public.presidential_poll_decision_votes(game_id,user_id,choice) values(p_game_id,v_uid,p_choice)
 on conflict(game_id,user_id) do update set choice=excluded.choice,created_at=now();
end;$$;
revoke all on function public.vote_presidential_poll_decision(uuid,boolean) from public,anon;
grant execute on function public.vote_presidential_poll_decision(uuid,boolean) to authenticated;

create or replace function public.close_presidential_poll_decision(p_game_id uuid)
returns boolean language plpgsql security definer set search_path=public,private,pg_temp as $$
declare y integer;n integer;v_result boolean;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 select count(*) filter(where choice),count(*) filter(where not choice) into y,n from public.presidential_poll_decision_votes where game_id=p_game_id;
 v_result:=y>n;
 update public.presidential_poll_decision set status='closed',result=v_result,closed_at=now() where game_id=p_game_id;
 insert into public.presidential_election_settings(game_id,poll_enabled,updated_by)
 values(p_game_id,v_result,(select auth.uid()))
 on conflict(game_id) do update set poll_enabled=v_result,updated_at=now(),updated_by=(select auth.uid());
 return v_result;
end;$$;
revoke all on function public.close_presidential_poll_decision(uuid) from public,anon;
grant execute on function public.close_presidential_poll_decision(uuid) to authenticated;

create or replace function public.create_presidential_public_poll(p_game_id uuid,p_round_no integer,p_closes_at timestamptz)
returns text language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_slug text:=lower(substr(replace(gen_random_uuid()::text,'-',''),1,12));
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 if not coalesce((select poll_enabled from public.presidential_election_settings where game_id=p_game_id),false) then raise exception 'Poll component is disabled';end if;
 insert into public.presidential_public_polls(game_id,round_no,slug,status,opened_at,closes_at,created_by)
 values(p_game_id,p_round_no,v_slug,'open',now(),p_closes_at,(select auth.uid()))
 on conflict(game_id,round_no) do update set status='open',opened_at=now(),closes_at=excluded.closes_at,closed_at=null
 returning slug into v_slug;
 return v_slug;
end;$$;
revoke all on function public.create_presidential_public_poll(uuid,integer,timestamptz) from public,anon;
grant execute on function public.create_presidential_public_poll(uuid,integer,timestamptz) to authenticated;

create or replace function public.get_public_presidential_poll(p_slug text)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_public_polls%rowtype;
begin
 select * into p from public.presidential_public_polls where slug=p_slug;
 if p.id is null then return null;end if;
 return jsonb_build_object(
  'id',p.id,'slug',p.slug,'title',p.title,'status',case when p.status='open' and p.closes_at is not null and p.closes_at<=now() then 'closed' else p.status end,
  'round_no',p.round_no,'closes_at',p.closes_at,
  'candidates',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.display_name,'photo_path',c.photo_path) order by c.display_name),'[]'::jsonb)
    from public.presidential_candidates c where c.game_id=p.game_id and c.archived_at is null and c.registration_status='registered')
 );
end;$$;
grant execute on function public.get_public_presidential_poll(text) to anon,authenticated;

create or replace function public.cast_public_presidential_poll(p_slug text,p_candidate_id uuid,p_voter_token text)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_public_polls%rowtype;
begin
 select * into p from public.presidential_public_polls where slug=p_slug for update;
 if p.id is null or p.status<>'open' or (p.closes_at is not null and p.closes_at<=now()) then raise exception 'Poll is closed';end if;
 if length(trim(coalesce(p_voter_token,'')))<12 then raise exception 'Invalid voter token';end if;
 if not exists(select 1 from public.presidential_candidates c where c.id=p_candidate_id and c.game_id=p.game_id and c.archived_at is null and c.registration_status='registered') then raise exception 'Candidate unavailable';end if;
 insert into public.presidential_public_poll_votes(poll_id,candidate_id,voter_token)
 values(p.id,p_candidate_id,trim(p_voter_token))
 on conflict(poll_id,voter_token) do update set candidate_id=excluded.candidate_id,created_at=now();
end;$$;
grant execute on function public.cast_public_presidential_poll(text,uuid,text) to anon,authenticated;

create or replace function public.close_presidential_public_poll(p_game_id uuid,p_round_no integer)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p public.presidential_public_polls%rowtype;v_total integer;v_result jsonb;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 select * into p from public.presidential_public_polls where game_id=p_game_id and round_no=p_round_no for update;
 if p.id is null then raise exception 'Poll not found';end if;
 update public.presidential_public_polls set status='closed',closed_at=now() where id=p.id;
 select count(*) into v_total from public.presidential_public_poll_votes where poll_id=p.id;
 select coalesce(jsonb_agg(jsonb_build_object('candidate_id',c.id,'candidate',c.display_name,'votes',coalesce(v.cnt,0),
  'pct',case when v_total=0 then 0 else round(100.0*coalesce(v.cnt,0)/v_total,2) end) order by coalesce(v.cnt,0) desc,c.display_name),'[]'::jsonb)
 into v_result
 from public.presidential_candidates c
 left join lateral(select count(*) cnt from public.presidential_public_poll_votes pv where pv.poll_id=p.id and pv.candidate_id=c.id)v on true
 where c.game_id=p_game_id and c.archived_at is null and c.registration_status='registered';
 update public.presidential_scorecards sc set poll_pct=x.pct,updated_at=now(),updated_by=(select auth.uid())
 from (
  select c.id candidate_id,case when v_total=0 then 0 else round(100.0*count(pv.*)/v_total,2) end pct
  from public.presidential_candidates c left join public.presidential_public_poll_votes pv on pv.candidate_id=c.id and pv.poll_id=p.id
  where c.game_id=p_game_id and c.archived_at is null and c.registration_status='registered'
  group by c.id
 )x where sc.candidate_id=x.candidate_id and sc.round_no=p_round_no;
 return jsonb_build_object('total',v_total,'results',v_result);
end;$$;
revoke all on function public.close_presidential_public_poll(uuid,integer) from public,anon;
grant execute on function public.close_presidential_public_poll(uuid,integer) to authenticated;

create or replace function public.save_presidential_inauguration(
 p_game_id uuid,p_scheduled_at timestamptz,p_venue text,p_notes text,p_hymn_path text,p_ceremonial_music_path text
) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 insert into public.presidential_inauguration(game_id,scheduled_at,venue,notes,hymn_path,ceremonial_music_path,updated_by)
 values(p_game_id,p_scheduled_at,nullif(trim(coalesce(p_venue,'')),''),nullif(trim(coalesce(p_notes,'')),''),nullif(trim(coalesce(p_hymn_path,'')),''),nullif(trim(coalesce(p_ceremonial_music_path,'')),''),(select auth.uid()))
 on conflict(game_id) do update set scheduled_at=excluded.scheduled_at,venue=excluded.venue,notes=excluded.notes,hymn_path=excluded.hymn_path,
  ceremonial_music_path=excluded.ceremonial_music_path,updated_at=now(),updated_by=(select auth.uid());
end;$$;
revoke all on function public.save_presidential_inauguration(uuid,timestamptz,text,text,text,text) from public,anon;
grant execute on function public.save_presidential_inauguration(uuid,timestamptz,text,text,text,text) to authenticated;

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_campaign_materials') then alter publication supabase_realtime add table public.presidential_campaign_materials;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_poll_decision') then alter publication supabase_realtime add table public.presidential_poll_decision;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_poll_decision_votes') then alter publication supabase_realtime add table public.presidential_poll_decision_votes;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_public_polls') then alter publication supabase_realtime add table public.presidential_public_polls;end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='presidential_inauguration') then alter publication supabase_realtime add table public.presidential_inauguration;end if;
end $$;
