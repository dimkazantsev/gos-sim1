-- Public, immutable stage-result snapshots. No changes to game mechanics or assessment.
-- New chapters are captured in the same transaction as stage completion.
create or replace function private.stage_comic_office_key(p_title text) returns text language sql immutable set search_path=pg_catalog as $$
 select case
  when btrim(p_title) ~* '^президент(\s|$)' then 'president'
  when btrim(p_title) ~* '^председатель\s+правительства(\s|$)' then 'prime_minister'
  when btrim(p_title) ~* '^председатель\s+(государственной\s+думы|гд)(\s|$)' then 'duma_chair'
  when btrim(p_title) ~* '^председатель.*(банка|банк).*(россии|рф)' then 'central_bank_chair'
  else lower(btrim(p_title)) end
$$;
revoke all on function private.stage_comic_office_key(text) from public,anon,authenticated;
create or replace function private.stage_result_comic_snapshot(p_game uuid,p_stage integer,p_source text default 'completed')
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare stage_numbers integer[];snap jsonb;counters jsonb;parties jsonb;offices jsonb;
begin
 stage_numbers:=case p_stage when 3 then array[2,3] when 5 then array[4,5] when 16 then array(select generate_series(1,16)) else array[p_stage] end;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'status',p.registration_status,'leader',m.full_name,
  'mandates',p.mandates,'regions',p.regions,'ghost_loss',p.ghost_loss_current) order by p.name),'[]'::jsonb)
 into parties from game_parties p left join game_members m on m.game_id=p.game_id and m.user_id=p.leader_user_id where p.game_id=p_game;
 -- Same legacy-title fallback as gameRoster.ts: an ended/pending assignment must not become active again.
 with holders as (
  select m.user_id,m.full_name,o.role_title from game_office_assignments o join game_members m on m.game_id=o.game_id and m.user_id=o.user_id
   where o.game_id=p_game and o.status='active' and m.roster_archived_at is null and m.kind<>'observer'
  union
  select m.user_id,m.full_name,btrim(role) from game_members m cross join lateral unnest(string_to_array(m.role_title,' · '))role
   where m.game_id=p_game and m.roster_archived_at is null and m.kind<>'observer' and btrim(role)<>''
    and lower(btrim(role)) not in ('преподаватель','администратор','участник','руководитель симуляции','наблюдатель')
    and not exists(select 1 from game_office_assignments o where o.game_id=m.game_id and o.user_id=m.user_id and private.stage_comic_office_key(o.role_title)=private.stage_comic_office_key(role))
 ) select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',full_name,'role',role_title) order by role_title,full_name),'[]'::jsonb) into offices from holders;
 counters:=jsonb_build_object(
  'parties',jsonb_array_length(parties),'registered_parties',(select count(*) from game_parties where game_id=p_game and registration_status='registered'),
  'party_members',(select count(*) from game_members m where m.game_id=p_game and m.roster_archived_at is null and exists(select 1 from game_parties p where p.game_id=m.game_id and p.name=m.team)),
  'mandates',(select coalesce(sum(mandates),0) from game_parties where game_id=p_game),'regions',(select coalesce(sum(regions),0) from game_parties where game_id=p_game),
  'ghost_loss',(select coalesce(sum(ghost_loss_current),0) from game_parties where game_id=p_game),'offices',jsonb_array_length(offices),
  'documents',(select count(*) from formal_documents where game_id=p_game and stage_no=any(stage_numbers)),
  'finished_documents',(select count(*) from formal_documents where game_id=p_game and stage_no=any(stage_numbers) and status_code in ('published','adopted','signed')),
  'votes',(select count(*) from game_votes where game_id=p_game and stage_no=any(stage_numbers)),
  'passed_votes',(select count(*) from game_votes where game_id=p_game and stage_no=any(stage_numbers) and result_code='passed')
 );
 snap:=jsonb_build_object('version',2,'source',p_source,'captured_at',now(),'stages',to_jsonb(stage_numbers),'counters',counters);
 if p_stage=16 then
  -- Only aggregates, never messages, ballot identities, candidate dossiers or answer keys.
  counters:=counters||jsonb_build_object(
   'participants',(select count(*) from game_members where game_id=p_game),
   'students',(select count(*) from game_members where game_id=p_game and roster_archived_at is null and kind='student'),
   'teachers',(select count(*) from game_members where game_id=p_game and roster_archived_at is null and kind='teacher'),
   'observers',(select count(*) from game_members where game_id=p_game and roster_archived_at is null and kind='observer'),
   'archived_members',(select count(*) from game_members where game_id=p_game and roster_archived_at is not null),
   'completed_stages',(select count(*) from game_stages where game_id=p_game and status='completed'),
   'published_documents',(select count(*) from formal_documents where game_id=p_game and status_code='published'),
   'document_revisions',(select count(*) from formal_document_revisions where game_id=p_game),
   'closed_votes',(select count(*) from game_votes where game_id=p_game and status='closed'),
   'rejected_votes',(select count(*) from game_votes where game_id=p_game and result_code='rejected'),
   'no_quorum_votes',(select count(*) from game_votes where game_id=p_game and result_code='no_quorum'),
   'ballots',(select count(*) from game_ballots b join game_votes v on v.id=b.vote_id where v.game_id=p_game),
   'sessions',(select count(*) from duma_sessions where game_id=p_game),
   'completed_sessions',(select count(*) from duma_sessions where game_id=p_game and status='closed'),
   'event_assignments',(select count(*) from event_assignments where game_id=p_game),
   'event_decisions',(select count(*) from event_decisions where game_id=p_game),
   'event_outcomes',(select count(*) from event_case_outcomes where game_id=p_game),
   'posts',(select count(*) from political_posts where game_id=p_game and deleted_at is null),
   'comments',(select count(*) from civic_comments where game_id=p_game),
   'reactions',(select count(*) from civic_reactions where game_id=p_game),
   'messages',(select count(*) from chat_messages where game_id=p_game),
   'files',(select count(*) from chat_messages where game_id=p_game and kind='file'),
   'audio',(select count(*) from chat_messages where game_id=p_game and kind='audio'),
   'video',(select count(*) from chat_messages where game_id=p_game and kind='video'),
   'blitz_assigned',(select count(*) from blitz_assignments where game_id=p_game),
   'blitz_answered',(select count(*) from blitz_assignments where game_id=p_game and answered_at is not null),
   'debriefs',(select count(*) from stage_debriefs where game_id=p_game),
   'assessments',(select count(*) from stage_assessments where game_id=p_game and status='final'),
   'awards',(select count(*) from game_achievements where game_id=p_game),
   'tasks',(select count(*) from game_assigned_tasks where game_id=p_game),
   'completed_tasks',(select count(*) from game_assigned_tasks where game_id=p_game and status in ('completed','confirmed'))
  );
 end if;
 if p_stage in (7,16) then
  counters:=counters||jsonb_build_object('candidates',(select count(*) from presidential_candidates where game_id=p_game and archived_at is null),
   'registered_candidates',(select count(*) from presidential_candidates where game_id=p_game and archived_at is null and registration_status='registered'));
  if p_stage=7 then
   snap:=snap||jsonb_build_object('president',(select jsonb_build_object('name',c.display_name,'party',p.name,'system',e.system_type,'score',e.result->'score')
    from presidential_election_settings e join presidential_candidates c on c.game_id=e.game_id and c.id::text=e.result->>'winner_id'
    left join game_parties p on p.game_id=c.game_id and p.id=c.party_id where e.game_id=p_game and e.status='finished'));
  end if;
 end if;
 if p_stage in (11,16) then
  counters:=counters||jsonb_build_object('programs',(select count(*) from state_programs where game_id=p_game),
   'adopted_programs',(select count(*) from state_programs where game_id=p_game and status='adopted'),
   'signed_programs',(select count(*) from state_programs where game_id=p_game and signed_at is not null));
 end if;
 if p_stage in (13,16) then
  counters:=counters||jsonb_build_object('budget_scenarios',(select count(*) from budget_scenarios where game_id=p_game),
   'transfers',(select count(*) from budget_transfer_requests where game_id=p_game),
   'approved_transfers',(select count(*) from budget_transfer_requests where game_id=p_game and status='granted'));
 end if;
 if p_stage in (14,16) then
  counters:=counters||jsonb_build_object('municipal_projects',(select count(*) from municipal_projects where game_id=p_game),
   'municipal_districts',(select count(*) from municipal_districts where game_id=p_game));
 end if;
 if p_stage in (15,16) then
  counters:=counters||jsonb_build_object('crises',(select count(*) from game_crises where game_id=p_game and (p_stage=16 or stage_no=15)),
   'resolved_crises',(select count(*) from game_crises where game_id=p_game and (p_stage=16 or stage_no=15) and status='resolved'),
   'crisis_responses',(select count(*) from crisis_responses r join game_crises c on c.id=r.crisis_id and c.game_id=r.game_id where r.game_id=p_game and (p_stage=16 or c.stage_no=15)));
 end if;
 snap:=jsonb_set(snap,'{counters}',counters);
 if p_stage=16 then return snap;end if;
 snap:=snap||jsonb_build_object('parties',parties,'offices',offices,
  'documents_detail',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status_code) order by created_at),'[]'::jsonb) from formal_documents where game_id=p_game and stage_no=any(stage_numbers)),
  'votes_detail',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status,'result',result_code) order by opened_at),'[]'::jsonb) from game_votes where game_id=p_game and stage_no=any(stage_numbers)));
 if p_stage=3 then
  snap:=snap||jsonb_build_object('election_rules',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name','Избирательная система','system',system_type,'method',allocation_method,'status',status) order by created_at),'[]'::jsonb) from parliamentary_election_rules where game_id=p_game and status<>'superseded'),
   'regional_rules',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name','Региональные выборы','method',method,'status',status) order by created_at),'[]'::jsonb) from regional_election_rules where game_id=p_game and status<>'superseded'));
 end if;
 if p_stage=8 then
  snap:=snap||jsonb_build_object('ministries',(select coalesce(jsonb_agg(jsonb_build_object('name',t.title,'status',g.status)),'[]'::jsonb) from government_structures g
   cross join lateral (values(g.social_title),(g.economic_title),(g.defence_title),(g.foreign_title),(g.internal_title))t(title) where g.game_id=p_game and nullif(btrim(t.title),'') is not null));
 end if;
 if p_stage=11 then
  snap:=snap||jsonb_build_object('programs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status,'amount',total_budget) order by title),'[]'::jsonb) from state_programs where game_id=p_game));
 end if;
 if p_stage=13 then
  snap:=snap||jsonb_build_object('budgets',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'title',b.title,'year',b.budget_year,'status',b.status,'revenue',b.revenue,'expenditure',b.expenditure,'balance',b.balance) order by b.budget_year,b.created_at),'[]'::jsonb) from budget_scenarios b where b.game_id=p_game));
 end if;
 if p_stage=14 then
  snap:=snap||jsonb_build_object('municipal_projects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',problem_title,'status',status,'amount',estimated_cost) order by created_at),'[]'::jsonb) from municipal_projects where game_id=p_game));
 end if;
 if p_stage=15 then
  snap:=snap||jsonb_build_object('crises',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',description,'status',status) order by created_at),'[]'::jsonb) from game_crises where game_id=p_game and stage_no=15),
   'metrics_detail',(select coalesce(jsonb_agg(jsonb_build_object('name',label,'value',value,'unit',unit) order by sort_order),'[]'::jsonb) from state_metrics where game_id=p_game and is_public));
 end if;
 return snap;
end$$;
revoke all on function private.stage_result_comic_snapshot(uuid,integer,text) from public,anon,authenticated;

create or replace function private.capture_completed_stage_comic() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare endpoint integer;first_stage integer;snap jsonb;news_snap jsonb;chapter_title text;
begin
 if new.status<>'completed' or old.status='completed' then return new;end if;
 endpoint:=case new.stage_no when 2 then 3 when 4 then 5 else new.stage_no end;
 if endpoint in (1,3,5,7,8,11,12,13,14,15,16) then
  -- Serialize closures in one game so concurrently completing grouped stages cannot both miss their peer.
  perform 1 from games where id=new.game_id for update;
  first_stage:=case endpoint when 3 then 2 when 5 then 4 else endpoint end;
  if (select count(*) from game_stages where game_id=new.game_id and stage_no between first_stage and endpoint and status='completed')=endpoint-first_stage+1 then
   snap:=private.stage_result_comic_snapshot(new.game_id,endpoint);
   chapter_title:=case when endpoint=16 then 'Эпилог · Итоги игры' when endpoint in (3,5) then 'Итоги этапов '||first_stage||' и '||endpoint else 'Итоги этапа '||endpoint end;
   insert into republic_comic_chapters(game_id,stage_no,kind,title,body,snapshot)
    values(new.game_id,endpoint,'completed',chapter_title,'Сохранённые результаты игры.',snap) on conflict(game_id,stage_no,kind) do nothing;
  end if;
 end if;
 -- Preserve the existing stage-news integration, including stages without a comic.
 news_snap:=jsonb_build_object('documents',(select count(*) from formal_documents where game_id=new.game_id and stage_no=new.stage_no),
  'finished_documents',(select count(*) from formal_documents where game_id=new.game_id and stage_no=new.stage_no and status_code in ('published','adopted','signed')),
  'votes',(select count(*) from game_votes where game_id=new.game_id and stage_no=new.stage_no),
  'passed_votes',(select count(*) from game_votes where game_id=new.game_id and stage_no=new.stage_no and result_code='passed'),
  'metrics',(select jsonb_object_agg(metric_key,value) from state_metrics where game_id=new.game_id and is_public),
  'document_ids',(select coalesce(jsonb_agg(id),'[]'::jsonb) from formal_documents where game_id=new.game_id and stage_no=new.stage_no),
  'vote_ids',(select coalesce(jsonb_agg(id),'[]'::jsonb) from game_votes where game_id=new.game_id and stage_no=new.stage_no));
 update political_posts set actor_key='media',actor_label='Республиканский обозреватель',
  body=political_posts.body||E'\n\n'||private.stage_comic_summary(news_snap),tags=array['этап_gpyasu','итоги_gpyasu','сми_gpyasu'],context=context||jsonb_build_object('stage_snapshot',news_snap)
  where game_id=new.game_id and source_key like 'stage:'||new.id::text||':completed:%';
 return new;
end$$;
revoke all on function private.capture_completed_stage_comic() from public,anon,authenticated;

-- An already completed stage 15 must also have a separate result chapter.
-- Reconstructed chapters are explicitly labelled; do not invent historical state or overwrite saved chapters.
do $$declare s record;first_stage integer;begin
 for s in select game_id,stage_no from game_stages where status='completed' and stage_no in (1,3,5,7,8,11,12,13,14,15,16) loop
  first_stage:=case s.stage_no when 3 then 2 when 5 then 4 else s.stage_no end;
  if (select count(*) from game_stages where game_id=s.game_id and stage_no between first_stage and s.stage_no and status='completed')=s.stage_no-first_stage+1 then
   insert into republic_comic_chapters(game_id,stage_no,kind,title,body,snapshot) values(s.game_id,s.stage_no,'completed',
    case when s.stage_no=16 then 'Эпилог · Итоги игры' else 'Итоги этапа '||s.stage_no end,
    'Сводка по сохранённым данным завершённого этапа.',private.stage_result_comic_snapshot(s.game_id,s.stage_no,'reconstructed')) on conflict(game_id,stage_no,kind) do nothing;
  end if;
 end loop;
end$$;
