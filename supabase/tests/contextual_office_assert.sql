-- Does not contact production, all records and function calls are fictional.
begin;
insert into public.game_members(game_id,user_id,kind,role_title) values
('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','teacher','Преподаватель'),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','student','Депутат Государственной Думы'),
('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','student','Президент Российской Федерации');
insert into public.game_office_assignments(id,game_id,user_id,role_title,status) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','Депутат Государственной Думы','active'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','Министр финансов','active'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','Президент Российской Федерации','active'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','Министр культуры','ended');
select set_config('app.test_uid','33333333-3333-4333-8333-333333333333',true);
do $check$
declare blocked boolean;
begin
 insert into public.formal_documents(game_id,author_id,subject_key,metadata) values
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','gd_deputy',
 '{"acting_office_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","acting_user_id":"33333333-3333-4333-8333-333333333333","acting_office_title":"Депутат Государственной Думы"}'::jsonb);
 -- Holding both offices must not allow signing a deputy paper as the minister.
 blocked:=false;
 begin
  insert into public.formal_documents(game_id,author_id,subject_key,metadata) values
  ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','gd_deputy',
  '{"acting_office_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","acting_user_id":"33333333-3333-4333-8333-333333333333","acting_office_title":"Министр финансов"}'::jsonb);
 exception when insufficient_privilege then blocked:=true;
 end;
 if not blocked then raise exception 'Wrong office signed a parliamentary act';end if;
 blocked:=false;
 begin
  insert into public.formal_documents(game_id,author_id,subject_key,metadata) values
  ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','president',
  '{"acting_office_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3","acting_user_id":"44444444-4444-4444-8444-444444444444","acting_office_title":"Президент Российской Федерации"}'::jsonb);
 exception when insufficient_privilege then blocked:=true;
 end;
 if not blocked then raise exception 'Another student office accepted';end if;
 blocked:=false;
 begin
  insert into public.formal_documents(game_id,author_id,subject_key,metadata) values
  ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','ministry',
  '{"acting_office_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4","acting_user_id":"33333333-3333-4333-8333-333333333333","acting_office_title":"Министр культуры"}'::jsonb);
 exception when insufficient_privilege then blocked:=true;
 end;
 if not blocked then raise exception 'Revoked office accepted';end if;
 blocked:=false;
 begin
  perform public.select_game_office('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid);
 exception when insufficient_privilege then blocked:=true;
 end;
 if not blocked then raise exception 'Student switched global role';end if;
 if (select count(*) from public.game_office_assignments where user_id='33333333-3333-4333-8333-333333333333' and status='active')<>2
 then raise exception 'Portfolio was modified';end if;
end $check$;
select set_config('app.test_uid','22222222-2222-4222-8222-222222222222',true);
select public.select_game_office('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
do $check$
begin
 if (select role_title from public.game_members where user_id='33333333-3333-4333-8333-333333333333')<>'Министр финансов'
 then raise exception 'Teacher cannot adjust legacy representative';end if;
 insert into public.formal_documents(game_id,author_id,subject_key,metadata) values
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','president',
 '{"acting_office_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3","acting_user_id":"44444444-4444-4444-8444-444444444444","acting_office_title":"Президент Российской Федерации"}'::jsonb);
 insert into public.formal_documents(game_id,author_id,subject_key,metadata) values
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','ksrf','{}');
 if (select count(*) from public.formal_documents)<>3 then raise exception 'Unexpected signature test rows';end if;
 raise notice 'PASS: active offices, mismatched subject, foreign, revoked, student role freeze and teacher audit';
end $check$;
rollback;
