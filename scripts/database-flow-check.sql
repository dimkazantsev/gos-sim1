-- Run with an authorized database administrator. Every fixture is rolled back.
begin;
do $$
declare
 g uuid:='11111111-1111-4111-8111-111111111111';
 admin uuid:='9fdf732c-1a84-4435-979d-e0272c2b81db';
 first_user uuid:='3e656c79-61bd-4db2-ae89-9adfaa1e85e9';
 second_user uuid:='89de1d45-8973-4f38-980d-26042af9e53e';
 guest uuid:='a4795eef-fbf3-4584-bc0b-f7bfee68b783';
 c uuid;a uuid;b uuid;m uuid;o public.event_case_outcomes%rowtype;result jsonb;
 opts jsonb:='[{"label":"Помочь С Проверкой","trust":2,"description":"Открытая помощь и проверяемый контроль."},{"label":"Отложить Для Оценки","trust":0,"description":"Решение отложено до получения сведений."},{"label":"Скрыть Проблему","trust":-2,"description":"Риск скрыт от жителей и не устранён."}]';
 choice_a text;choice_b text;test_name text;start_value numeric;expected numeric;
 before_cases integer;after_cases integer;metric_result jsonb;
begin
 if exists(select 1 from public.games where id=g or game_code='QA8F') then raise exception 'QA Fixture Already Exists';end if;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated')::text,true);
 insert into public.games(id,title,game_code,owner_id,status) values(g,'Временная Проверка','QA8F',admin,'paused');
 insert into public.game_members(game_id,user_id,full_name,kind,role_title) values
  (g,admin,'Тестовый Главный Преподаватель','teacher','Руководитель симуляции'),
  (g,first_user,'Казанцев Дмитрий Анатольевич','student','Депутат Государственной Думы'),
  (g,second_user,'Второй Участник Тестовый','student','Президент Российской Федерации'),
  (g,guest,'Нейтральный Гость Тестовый','observer','Гость');
 update public.game_members set kind='observer',role_title='Президент Российской Федерации' where game_id=g and user_id=admin;
 if (select kind from public.game_members where game_id=g and user_id=admin)<>'teacher' then raise exception 'Admin Downgraded';end if;
 if (select role_title from public.game_members where game_id=g and user_id=admin)<>'Президент Российской Федерации' then raise exception 'Voluntary Role Lost';end if;
 if not private.vote_member_matches(g,admin,'all') then raise exception 'Opted-In Teacher Excluded';end if;
 update public.game_members set role_title='Руководитель симуляции' where game_id=g and user_id=admin;
 if private.vote_member_matches(g,admin,'all') then raise exception 'Neutral Teacher Counted In Electorate';end if;
 update public.game_members set role_title='Депутат Государственной Думы' where game_id=g and user_id=admin;
 if not private.vote_member_matches(g,admin,'gd') then raise exception 'Teacher Office Unavailable';end if;
 update public.game_members set role_title='Руководитель симуляции' where game_id=g and user_id=admin;
 perform set_config('request.jwt.claim.sub',first_user::text,true);
 if private.is_game_teacher(g) then raise exception 'Name Escalation';end if;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 insert into public.state_metrics(game_id,metric_key,label,value,unit,min_value,max_value,is_public)
 values(g,'public_trust','Доверие',99,'%',0,100,true)
 on conflict(game_id,metric_key) do update set value=99 returning id into m;
 if public.seed_game_event_bank(g)<>0 then raise exception 'Seed Not Idempotent';end if;
 if private.seed_event_bank_extended(g)<>0 then raise exception 'Legacy Seed Recreates Templates';end if;
 if (select count(*) from public.event_cases where game_id=g)<>50 then raise exception 'Wrong Bank Size';end if;
 metric_result:=public.set_state_metric_and_post(m,98,'Проверяемая ручная корректировка',true,'Проверка Публикации');
 if (metric_result->>'delta')::numeric<>-1 or metric_result->>'post_id' is null then raise exception 'Atomic Metric Post Failed';end if;
 if not exists(select 1 from public.political_posts where id=(metric_result->>'post_id')::uuid and effects_applied) then raise exception 'Missing Atomic Post';end if;
 delete from public.political_posts where game_id=g;
 for test_name,start_value,choice_a,choice_b,expected in values
  ('Positive At Upper Boundary',99,'option_1','option_1',1::numeric),
  ('Negative At Lower Boundary',1.5,'option_3','option_3',-1.5),
  ('Neutral Choice',46,'option_2','option_2',0),
  ('Tie',46,'option_1','option_3',0),
  ('Canonical Legacy Choice',46,'accept','option_1',2),
  ('Forced Finalization',46,'option_1','pending',2)
 loop
  perform set_config('request.jwt.claim.sub',admin::text,true);
  update public.state_metrics set value=start_value where id=m;
  c:=public.create_assigned_event(g,'Проверка '||test_name,'Достаточное описание учебного задания для проверки всех связей.',
   'Государственное управление','serious','all',opts,array[first_user,second_user]);
  update public.event_cases set comic_scene=jsonb_build_object('title',test_name,'category','Государственное управление',
   'scene_id','scene-01','media_label','Общественная Служба Новостей Республики','news_lead','Проверка сюжета.') where id=c;
  select id into a from public.event_assignments where case_id=c and recipient_id=first_user;
  select id into b from public.event_assignments where case_id=c and recipient_id=second_user;
  perform set_config('request.jwt.claim.sub',first_user::text,true);
  perform public.submit_event_decision(a,choice_a,'Первый голос');
  if exists(select 1 from public.event_case_outcomes where case_id=c) then raise exception 'Premature Outcome: %',test_name;end if;
  if (select value from public.state_metrics where id=m)<>start_value then raise exception 'Premature Rating: %',test_name;end if;
  if choice_b='pending' then
   perform set_config('request.jwt.claim.sub',admin::text,true);perform public.finalize_event_case(c);
  else
   perform set_config('request.jwt.claim.sub',second_user::text,true);perform public.submit_event_decision(b,choice_b,'Второй голос');
  end if;
  select * into o from public.event_case_outcomes where case_id=c;
  if o.case_id is null or o.trust_delta<>expected then raise exception 'Wrong Delta: %, %, Expected %',test_name,o.trust_delta,expected;end if;
  if (select value from public.state_metrics where id=m)<>start_value+expected then raise exception 'Metric Mismatch: %',test_name;end if;
  if not exists(select 1 from public.event_trust_ledger where game_id=g and action_key='choice-'||c and delta=expected) then raise exception 'Ledger Mismatch';end if;
  if not exists(select 1 from public.state_metric_history where game_id=g and delta=expected and source_id=(select id::text from public.event_trust_ledger where game_id=g and action_key='choice-'||c)) then raise exception 'History Mismatch';end if;
  if (select comic_scene->>'scene_id' from public.political_posts where id=o.media_post_id)<>'scene-01' then raise exception 'Scene Changed In Media';end if;
  if (select count(*) from public.political_posts where game_id=g and internal_ref_id=c::text)<>1 then raise exception 'Duplicate Media';end if;
  if jsonb_array_length(o.option_tallies)<>3 then raise exception 'Missing Option Tallies';end if;
  if test_name='Tie' and o.winner<>'tie' then raise exception 'Tie Mishandled';end if;
  if test_name='Canonical Legacy Choice' and o.winner<>'option_1' then raise exception 'Synonyms Split Votes';end if;
  if test_name='Positive At Upper Boundary' and (o.requested_trust_delta<>2 or o.resolution_kind<>'beneficial') then raise exception 'Lost Requested Effect';end if;
  if exists(select 1 from public.event_assignments where case_id=c and status='pending') then raise exception 'Closed Vote Still Pending';end if;
  perform set_config('request.jwt.claim.sub',admin::text,true);
  result:=public.finalize_event_case(c);
  if result->>'reason'<>'already_finalized' then raise exception 'Nonidempotent Finalization';end if;
  if (select count(*) from public.political_posts where game_id=g and internal_ref_id=c::text)<>1 then raise exception 'Repeated Post';end if;
  begin
   perform public.assign_event_case(c,array[first_user,second_user]);raise exception 'Unexpected Reassignment';
  exception when others then if SQLERRM='Unexpected Reassignment' then raise;end if;end;
  perform set_config('request.jwt.claim.sub',second_user::text,true);
  begin perform public.submit_event_decision(b,'option_1');raise exception 'Unexpected Second Vote';
  exception when others then if SQLERRM='Unexpected Second Vote' then raise;end if;end;
 end loop;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 select count(*) into before_cases from public.event_cases where game_id=g;
 begin perform public.create_assigned_event(g,'Недопустимое Событие','Достаточное описание для проверки транзакции.','Тест','serious','single',opts,array[guest]);
  raise exception 'Unexpected Guest Assignment';
 exception when others then if SQLERRM='Unexpected Guest Assignment' then raise;end if;end;
 select count(*) into after_cases from public.event_cases where game_id=g;
 if before_cases<>after_cases then raise exception 'Orphan Case After Failed Assignment';end if;
 c:=public.create_assigned_event(g,'Шесть Вариантов','Проверяется поддержка максимального количества вариантов.',
  'Тест','light','single',opts||'[{"label":"Четвёртый","trust":1,"description":"Альтернативная полезная мера."},{"label":"Пятый","trust":0,"description":"Нейтральное дополнительное изучение."},{"label":"Шестой","trust":-1,"description":"Негативное неоправданное действие."}]'::jsonb,array[first_user]);
 if (select jsonb_array_length(decision_options) from public.event_cases where id=c)<>6 then raise exception 'Six Options Failed';end if;
 begin perform public.assign_event_case(c,array[second_user]);raise exception 'Unexpected Second Individual Assignee';
 exception when others then if SQLERRM='Unexpected Second Individual Assignee' then raise;end if;end;
 insert into public.game_votes(id,game_id,title,created_by) values('22222222-2222-4222-8222-222222222222',g,'Проверка Обычного Голосования',admin);
 insert into public.chat_channels(id,game_id,name,kind,created_by) values('33333333-3333-4333-8333-333333333333',g,'Открытый Тестовый Канал','public',admin);
 insert into public.game_profiles(game_id,user_id,bio) values(g,first_user,'Описание Для Проверки Прав Профиля.');
 perform set_config('request.jwt.claim.sub',guest::text,true);
 begin perform public.set_state_metric_and_post(m,0,'Попытка Гостя',true);raise exception 'Unexpected Guest Metric';
 exception when others then if SQLERRM='Unexpected Guest Metric' then raise;end if;end;
 begin perform public.assign_event_case(c,array[first_user]);raise exception 'Unexpected Guest Assignment RPC';
 exception when others then if SQLERRM='Unexpected Guest Assignment RPC' then raise;end if;end;
 begin perform public.finalize_event_case(c);raise exception 'Unexpected Guest Finalization';
 exception when others then if SQLERRM='Unexpected Guest Finalization' then raise;end if;end;
 begin perform public.export_game_data(g);raise exception 'Unexpected Guest Export';
 exception when others then if SQLERRM='Unexpected Guest Export' then raise;end if;end;
end;
$$;

-- Direct authenticated RLS writes, including a guest's own media folder.
set local role authenticated;
select set_config('request.jwt.claim.sub','a4795eef-fbf3-4584-bc0b-f7bfee68b783',true);
select set_config('request.jwt.claims','{"sub":"a4795eef-fbf3-4584-bc0b-f7bfee68b783","role":"authenticated"}',true);
do $$
declare n integer;
begin
 if private.is_game_teacher('11111111-1111-4111-8111-111111111111') then raise exception 'Guest Is Teacher';end if;
 select count(*) into n from public.event_cases where game_id='11111111-1111-4111-8111-111111111111' and case_key like 'bank-%';
 if n<>0 then raise exception 'Guest Can Read Private Bank';end if;
 select count(*) into n from public.event_case_outcomes where game_id='11111111-1111-4111-8111-111111111111';
 if n<>6 then raise exception 'Guest Cannot Read Public Outcomes';end if;
 select count(*) into n from public.event_assignments where game_id='11111111-1111-4111-8111-111111111111';
 if n<>13 then raise exception 'Guest Cannot Read Public Assignments: %',n;end if;
 begin insert into public.game_profiles(game_id,user_id,bio) values('11111111-1111-4111-8111-111111111111',auth.uid(),'Попытка Гостя');
  raise exception 'Unexpected Guest Profile Write';
 exception when others then if SQLERRM='Unexpected Guest Profile Write' then raise;end if;end;
 begin insert into storage.objects(bucket_id,name) values('game-assets','11111111-1111-4111-8111-111111111111/formal/qa-only.txt');
  raise exception 'Unexpected Guest Formal Upload';
 exception when others then if SQLERRM='Unexpected Guest Formal Upload' then raise;end if;end;
 begin insert into storage.objects(bucket_id,name) values('game-media','11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/a4795eef-fbf3-4584-bc0b-f7bfee68b783/qa-only.txt');
  raise exception 'Unexpected Guest Media Upload';
 exception when others then if SQLERRM='Unexpected Guest Media Upload' then raise;end if;end;
 begin insert into public.game_ballots(vote_id,voter_id,choice) values('22222222-2222-4222-8222-222222222222',auth.uid(),'yes');
  raise exception 'Unexpected Guest Ordinary Ballot';
 exception when others then if SQLERRM='Unexpected Guest Ordinary Ballot' then raise;end if;end;
 begin perform public.cast_procedural_vote('22222222-2222-4222-8222-222222222222','yes');
  raise exception 'Unexpected Guest Procedural Vote';
 exception when others then if SQLERRM='Unexpected Guest Procedural Vote' then raise;end if;end;
 begin insert into public.profile_document_links(game_id,user_id,title,provider,url) values('11111111-1111-4111-8111-111111111111',auth.uid(),'Документ','google','https://docs.google.com/document/d/qa');
  raise exception 'Unexpected Guest Document Link';
 exception when others then if SQLERRM='Unexpected Guest Document Link' then raise;end if;end;
end;
$$;
select set_config('request.jwt.claim.sub','9fdf732c-1a84-4435-979d-e0272c2b81db',true);
insert into storage.objects(bucket_id,name) values('game-assets','11111111-1111-4111-8111-111111111111/formal/qa-teacher-only.txt');
select set_config('request.jwt.claim.sub','3e656c79-61bd-4db2-ae89-9adfaa1e85e9',true);
select public.cast_procedural_vote('22222222-2222-4222-8222-222222222222','yes');
insert into public.profile_document_links(game_id,user_id,title,provider,url) values
 ('11111111-1111-4111-8111-111111111111',auth.uid(),'Проверка Google','google','https://docs.google.com/document/d/qa'),
 ('11111111-1111-4111-8111-111111111111',auth.uid(),'Проверка Яндекс','yandex','https://docs.yandex.ru/docs/view?url=qa');
do $$
begin
 if (select count(*) from public.profile_document_links where game_id='11111111-1111-4111-8111-111111111111')<>2 then raise exception 'Document Links Not Persisted';end if;
 begin update public.game_profiles set intro_seen_at=now(),onboarding_completed_at=now() where game_id='11111111-1111-4111-8111-111111111111' and user_id=auth.uid();
  raise exception 'Unexpected Profile Completion Bypass';
 exception when others then if SQLERRM='Unexpected Profile Completion Bypass' then raise;end if;end;
 begin insert into public.profile_document_links(game_id,user_id,title,provider,url) values('11111111-1111-4111-8111-111111111111',auth.uid(),'Неверный Адрес','google','https://docs.google.com.evil.example/document/d/qa');
  raise exception 'Unexpected Fake Document Host';
 exception when others then if SQLERRM='Unexpected Fake Document Host' then raise;end if;end;
end;
$$;
reset role;
rollback;
select 'PASS: Canonical Votes, Positive/Negative/Neutral/Tie, Boundaries, Single Media, Shared Scene, Forced Close, Admin Roles, Guest RPC/RLS/Uploads/Ballots, Profile Completion Guard, Document Links, Six Options, Atomic Assignment, Idempotent Seed. All Fixtures Rolled Back.' result;
