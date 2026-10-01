-- Server-evaluated achievements. Conditions are never submitted by the client.
create table private.achievement_catalog(id text primary key,title text not null,description text not null,hidden boolean not null,conditions jsonb not null,sort_order integer not null);
create table public.game_achievements(game_id uuid not null references games(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,achievement_id text not null references private.achievement_catalog(id),earned_at timestamptz not null default clock_timestamp(),notified_at timestamptz,primary key(game_id,user_id,achievement_id));
alter table public.game_achievements enable row level security;
create policy earned_achievement_member_read on public.game_achievements for select to authenticated using(private.is_game_member(game_id));
revoke all on private.achievement_catalog,public.game_achievements from public,anon,authenticated;
grant select on public.game_achievements to authenticated;
create table private.achievement_presence(game_id uuid not null references games(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,seconds numeric not null default 0,last_tick timestamptz not null,days text[] not null default '{}',primary key(game_id,user_id));
revoke all on private.achievement_presence from public,anon,authenticated;
create or replace function private.achievement_presence_tick() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare tick timestamptz:=clock_timestamp();begin
 -- Ignore client timestamps and bound consecutive heartbeats. An idle gap is not play time.
 new.last_seen_at:=tick;
 if exists(select 1 from game_members where game_id=new.game_id and user_id=new.user_id and kind='student') then
 insert into private.achievement_presence(game_id,user_id,last_tick,days) values(new.game_id,new.user_id,tick,array[to_char(tick at time zone 'UTC','YYYY-MM-DD')])
 on conflict(game_id,user_id) do update set seconds=achievement_presence.seconds+case when tick-achievement_presence.last_tick<=interval '90 seconds' then greatest(0,extract(epoch from tick-achievement_presence.last_tick)) else 0 end,last_tick=tick,days=array(select distinct x from unnest(achievement_presence.days||excluded.days) x);
 end if;return new;
end$$;
create trigger achievement_presence_tick before insert or update on public.game_presence for each row execute function private.achievement_presence_tick();

create or replace function private.achievement_facts(p_game uuid,p_user uuid) returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare f jsonb:='{}';r record;v numeric;n numeric;
begin
 select jsonb_build_object('documents',count(*),'published_documents',count(*) filter(where status_code='published'),'document_types',count(distinct doc_type),'document_subjects',count(distinct subject_key),'document_stages',count(distinct stage_no),'document_files',count(*) filter(where source_file_path is not null),'long_documents',count(*) filter(where length(body_text)>=1200),'edited_documents',count(*) filter(where coalesce((metadata->>'revision')::integer,1)>1)) into f from formal_documents where game_id=p_game and author_id=p_user;
 for r in select doc_type k,count(*) n from formal_documents where game_id=p_game and author_id=p_user group by doc_type loop f:=f||jsonb_build_object('d_'||r.k,r.n);end loop;
 for r in select metadata->>'template_key' k,count(*) n from formal_documents where game_id=p_game and author_id=p_user and metadata ? 'template_key' group by metadata->>'template_key' loop f:=f||jsonb_build_object('t_'||r.k,r.n);end loop;
 f:=f||jsonb_build_object('signatures',(select count(*) from formal_document_signatures where game_id=p_game and signer_id=p_user));
 select jsonb_build_object('ballots',count(*),'votes_yes',count(*) filter(where coalesce(b.yes_weight,case when b.choice='yes' then b.weight else 0 end)>0),'votes_no',count(*) filter(where coalesce(b.no_weight,case when b.choice='no' then b.weight else 0 end)>0),'votes_abstain',count(*) filter(where coalesce(b.abstain_weight,case when b.choice='abstain' then b.weight else 0 end)>0),'largest_ballot',coalesce(max(b.weight),0),'split_ballots',count(*) filter(where (case when b.yes_weight>0 then 1 else 0 end)+(case when b.no_weight>0 then 1 else 0 end)+(case when b.abstain_weight>0 then 1 else 0 end)>1),'quorate_ballots',count(*) filter(where v.status='closed' and v.result_quorum_met),'voting_institutions',count(distinct v.institution_key)) into r from game_ballots b join game_votes v on v.id=b.vote_id where v.game_id=p_game and b.voter_id=p_user;
 f:=f||r.jsonb_build_object;
 select jsonb_build_object('lawful_cases',count(*) filter(where e.authority_ok and e.lawful),'unlawful_cases',count(*) filter(where not e.authority_ok or not e.lawful),'collective_lawful_cases',count(*) filter(where e.authority_ok and e.lawful and cardinality(e.coalition_ids)>1),'strategic_cases',count(*) filter(where e.strategy_point),'regional_lawful_cases',count(*) filter(where e.authority_ok and e.lawful and c.comic_scene ? 'region_code'),'lawful_regions',count(distinct c.comic_scene->>'region_code') filter(where e.authority_ok and e.lawful),'lawful_after_error',count(*) filter(where e.authority_ok and e.lawful and e.created_at>(select min(created_at) from event_authority_evidence where game_id=p_game and actor_id=p_user and (not authority_ok or not lawful)))) into r from event_authority_evidence e join event_cases c on c.id=e.case_id where e.game_id=p_game and e.actor_id=p_user;
 f:=f||r.jsonb_build_object;
 for r in select right(c.case_key,3) k,count(*) n from event_authority_evidence e join event_cases c on c.id=e.case_id where e.game_id=p_game and e.actor_id=p_user and e.lawful and e.authority_ok and c.case_key like 'bank-legal-2026-%' group by c.case_key loop f:=f||jsonb_build_object('case_'||r.k,r.n);end loop;
 f:=f||jsonb_build_object('accepted_case_invites',(select count(*) from event_collaboration_invites where game_id=p_game and recipient_id=p_user and status='accepted'),'case_messages',(select count(*) from event_discussion_messages where game_id=p_game and author_id=p_user and length(trim(body))>=30),'tax_proposals',(select count(*) from fiscal_rate_proposals where game_id=p_game and author_id=p_user),'applied_tax_proposals',(select count(*) from fiscal_rate_proposals where game_id=p_game and author_id=p_user and status='applied'));
 select jsonb_build_object('posts',count(*),'external_links',count(*) filter(where nullif(external_url,'') is not null),'internal_links',count(*) filter(where nullif(internal_view,'') is not null),'personal_posts',count(*) filter(where actor_key='participant'),'office_posts',count(*) filter(where actor_key not in ('participant','party','teacher','media')),'tag_regions',count(*) filter(where 'регионы_gpyasu'=any(tags))) into r from political_posts where game_id=p_game and author_id=p_user and source_key is null and not coalesce((context->>'automatic')::boolean,false) and deleted_at is null;
 f:=f||r.jsonb_build_object;
 f:=f||jsonb_build_object('post_tags',(select count(distinct tag) from political_posts p cross join lateral unnest(p.tags) tag where p.game_id=p_game and p.author_id=p_user and p.source_key is null and p.deleted_at is null),'post_documents',(select count(*) from political_post_formal_links l join political_posts p on p.id=l.post_id join formal_documents d on d.id=l.formal_document_id where l.game_id=p_game and p.author_id=p_user and d.author_id=p_user and p.source_key is null and p.deleted_at is null));
 for r in select m.media_kind k,count(*) n from political_post_media m join political_posts p on p.id=m.post_id where m.game_id=p_game and p.author_id=p_user and p.source_key is null and p.deleted_at is null group by m.media_kind loop f:=f||jsonb_build_object('post_'||case r.k when 'image' then 'images' when 'file' then 'files' else r.k end,r.n);end loop;
 f:=f||jsonb_build_object('media_proposals',(select count(*) from media_news_proposals where game_id=p_game and author_id=p_user),'approved_media',(select count(*) from media_news_proposals where game_id=p_game and author_id=p_user and status='approved'),'document_comments',(select count(*) from civic_comments where game_id=p_game and author_id=p_user and target_kind='document'),'post_comments',(select count(*) from civic_comments where game_id=p_game and author_id=p_user and target_kind='post'),'legal_comments',(select count(*) from civic_comments where game_id=p_game and author_id=p_user and length(body)>=80 and body ~* '(конституц|кодекс|федеральн.{0,12}закон|[А-Я]{1,3} РФ)'),'document_views',(select count(*) from civic_views where game_id=p_game and user_id=p_user and target_kind='document'),'reactions_given',(select count(*) from civic_reactions where game_id=p_game and user_id=p_user),'received_likes',(select count(*) from civic_reactions c join political_posts p on p.id=c.target_id and c.target_kind='post' where c.game_id=p_game and p.author_id=p_user and c.user_id<>p_user and c.value=1 and p.deleted_at is null),'post_comment_authors',(select count(distinct c.author_id) from civic_comments c join political_posts p on p.id=c.target_id and c.target_kind='post' where c.game_id=p_game and p.author_id=p_user and c.author_id<>p_user and p.deleted_at is null),'party_files',(select count(*) from party_documents where game_id=p_game and uploaded_by=p_user),'party_file_types',(select count(distinct doc_kind) from party_documents where game_id=p_game and uploaded_by=p_user),'active_offices',(select count(*) from game_office_assignments where game_id=p_game and user_id=p_user and status='active'),'presence_seconds',coalesce((select seconds from private.achievement_presence where game_id=p_game and user_id=p_user),0),'presence_days',coalesce((select cardinality(days) from private.achievement_presence where game_id=p_game and user_id=p_user),0),'assessed_completed_stages',(select count(*) from stage_assessments a join game_stages s on s.game_id=a.game_id and s.stage_no=a.stage_no where a.game_id=p_game and a.user_id=p_user and s.status='completed' and a.auto_score>0),'law_and_debrief',(select count(*) from stage_assessments a join game_stages s on s.game_id=a.game_id and s.stage_no=a.stage_no where a.game_id=p_game and a.user_id=p_user and s.status='completed' and a.status='final' and a.criterion_law and a.criterion_debrief));
 -- Ties share a leader medal; only students compete with students in the current game.
 select coalesce(max(t.n),0) into n from (select count(*) n from political_posts p join game_members m on m.game_id=p.game_id and m.user_id=p.author_id and m.kind='student' where p.game_id=p_game and p.source_key is null and p.deleted_at is null and not coalesce((p.context->>'automatic')::boolean,false) group by p.author_id) t;
 f:=f||jsonb_build_object('posts_leader',case when (f->>'posts')::numeric>=n and n>0 then 1 else 0 end);
 select coalesce(max(t.n),0) into n from (select count(*) n from formal_documents d join game_members m on m.game_id=d.game_id and m.user_id=d.author_id and m.kind='student' where d.game_id=p_game and d.status_code='published' group by d.author_id) t;
 f:=f||jsonb_build_object('documents_leader',case when (f->>'published_documents')::numeric>=n and n>0 then 1 else 0 end);
 select coalesce(max(seconds),0) into n from private.achievement_presence where game_id=p_game;
 f:=f||jsonb_build_object('presence_leader',case when (f->>'presence_seconds')::numeric>=n and n>0 then 1 else 0 end);
 return f;
end$$;

create or replace function public.evaluate_game_achievements(p_game_id uuid) returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare f jsonb;c record;ok boolean;k record;added integer:=0;
begin
 if not exists(select 1 from game_members where game_id=p_game_id and user_id=auth.uid() and kind='student') then return 0;end if;
 f:=private.achievement_facts(p_game_id,auth.uid());
 for c in select * from private.achievement_catalog where not exists(select 1 from game_achievements a where a.game_id=p_game_id and a.user_id=auth.uid() and a.achievement_id=achievement_catalog.id) loop
  ok:=true;for k in select * from jsonb_each_text(c.conditions) loop if coalesce((f->>k.key)::numeric,0)<k.value::numeric then ok:=false;exit;end if;end loop;
  if ok then insert into game_achievements(game_id,user_id,achievement_id) values(p_game_id,auth.uid(),c.id) on conflict do nothing;if found then added:=added+1;end if;end if;
 end loop;return added;
end$$;
create or replace function public.get_game_achievements(p_game_id uuid,p_user_id uuid default null) returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare u uuid:=coalesce(p_user_id,auth.uid());f jsonb;
begin
 if not private.is_game_member(p_game_id) or not exists(select 1 from game_members where game_id=p_game_id and user_id=u) then raise exception 'Награды этого профиля недоступны.';end if;
 f:=private.achievement_facts(p_game_id,u);
 return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'description',c.description,'hidden',c.hidden,'earned_at',a.earned_at,'progress',case when c.hidden and a.earned_at is not null then 100 else least(100,(select coalesce(min(100*coalesce((f->>k.key)::numeric,0)/k.value::numeric),0) from jsonb_each_text(c.conditions) k)) end) order by c.sort_order),'[]') from private.achievement_catalog c left join game_achievements a on a.achievement_id=c.id and a.game_id=p_game_id and a.user_id=u where not c.hidden or a.earned_at is not null);
end$$;
create or replace function public.claim_achievement_notification(p_game_id uuid) returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare a game_achievements%rowtype;c private.achievement_catalog%rowtype;begin
 if not exists(select 1 from game_members where game_id=p_game_id and user_id=auth.uid() and kind='student') then return null;end if;
 select * into a from game_achievements where game_id=p_game_id and user_id=auth.uid() and notified_at is null order by earned_at,achievement_id limit 1 for update skip locked;
 if not found then return null;end if;
 update game_achievements set notified_at=clock_timestamp() where game_id=a.game_id and user_id=a.user_id and achievement_id=a.achievement_id;
 select * into c from private.achievement_catalog where id=a.achievement_id;return jsonb_build_object('id',c.id,'title',c.title,'description',c.description,'hidden',c.hidden);
end$$;
revoke all on function private.achievement_presence_tick(),private.achievement_facts(uuid,uuid) from public,anon,authenticated;
revoke all on function public.evaluate_game_achievements(uuid),public.get_game_achievements(uuid,uuid),public.claim_achievement_notification(uuid) from public,anon;
grant execute on function public.evaluate_game_achievements(uuid),public.get_game_achievements(uuid,uuid),public.claim_achievement_notification(uuid) to authenticated;
