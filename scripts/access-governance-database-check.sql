-- Run only after the disposable fixture and the access-governance migration.
select set_config('test.user_id','22222222-2222-4222-8222-222222222222',false);
do $$
declare v_game uuid:='11111111-1111-4111-8111-111111111111';
declare v_student uuid:='33333333-3333-4333-8333-333333333333';
declare v_teacher uuid:='22222222-2222-4222-8222-222222222222';
declare v_guest_id uuid; v_list jsonb; v_failed boolean;
begin
 if not private.is_game_member(v_game) then raise exception 'Teacher lost access';end if;
 perform public.create_observer_invite(v_game,'GUEST-SECRET-TEST');
 v_list:=public.teacher_access_code_list(v_game);
 if jsonb_array_length(v_list)<>1 or v_list->0->>'scope'<>'guest'
  or v_list::text like '%GUEST-SECRET-TEST%' then
  raise exception 'Guest catalogue leaks a code or has the wrong scope';
 end if;
 select id into v_guest_id from public.invite_codes where game_id=v_game and kind='observer';
 if not public.teacher_revoke_access_code(v_game,v_guest_id) then raise exception 'Guest revocation failed';end if;
 if not public.teacher_delete_access_code(v_game,v_guest_id) then raise exception 'Revoked code deletion failed';end if;
 if exists(select 1 from public.invite_codes where id=v_guest_id) then raise exception 'Revoked guest code was not deleted';end if;
 perform public.teacher_set_member_access(v_game,v_student,'active',array['chat','votes'],now()+interval '7 days','Repeated prohibited chat');
 if not exists(select 1 from private.game_member_access where user_id=v_student and restricted_actions @> array['chat','votes']) then
  raise exception 'Restriction not persisted';
 end if;
 -- Teachers cannot block teachers or administrators.
 v_failed:=false;
 begin
  perform public.teacher_set_member_access(v_game,v_teacher,'blocked','{}'::text[],null,'Bad action');
 exception when others then v_failed:=true; end;
 if not v_failed then raise exception 'Teacher-to-teacher moderation accepted';end if;
 -- An unrelated teacher must not read another game's roster.
 perform set_config('test.user_id','88888888-8888-4888-8888-888888888888',true);
 v_failed:=false;
 begin perform public.teacher_member_access_list(v_game);
 exception when others then v_failed:=true; end;
 if not v_failed then raise exception 'Cross-game moderation roster accessible';end if;
 perform set_config('test.user_id','22222222-2222-4222-8222-222222222222',true);
end $$;
-- Student has normal membership but cannot perform forbidden chat/vote writes.
select set_config('test.user_id','33333333-3333-4333-8333-333333333333',false);
do $$
declare v_game uuid:='11111111-1111-4111-8111-111111111111'; v_student uuid:=auth.uid();v_failed boolean;
begin
 if not private.is_game_member(v_game) then raise exception 'Restriction incorrectly blocks reading';end if;
 if private.can_game_member_action(v_game,'chat') or private.can_game_member_action(v_game,'votes') then
  raise exception 'Restricted actions allowed';
 end if;
 if not private.can_game_member_action(v_game,'posts') then raise exception 'Unrestricted action blocked';end if;
 v_failed:=false;
 begin insert into public.chat_messages(game_id,author_id,text) values(v_game,v_student,'forbidden');
 exception when others then v_failed:=true;end;
 if not v_failed then raise exception 'Chat write was not rejected by trigger';end if;
 v_failed:=false;
 begin insert into public.game_ballots(vote_id,voter_id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',v_student);
 exception when others then v_failed:=true;end;
 if not v_failed then raise exception 'Vote was not rejected by trigger';end if;
 insert into public.political_posts(game_id,author_id) values(v_game,v_student);
 v_failed:=false;
 begin perform public.teacher_member_access_list(v_game);
 exception when others then v_failed:=true;end;
 if not v_failed then raise exception 'Participant read teacher-only roster';end if;
end $$;
-- Teacher may ban, exclude and restore the participant without deleting work.
select set_config('test.user_id','22222222-2222-4222-8222-222222222222',false);
select public.teacher_set_member_access('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','blocked','{}'::text[],now()+interval '1 day','Temporary ban');
select set_config('test.user_id','33333333-3333-4333-8333-333333333333',false);
do $$begin if private.is_game_member('11111111-1111-4111-8111-111111111111')
 then raise exception 'Ban is ineffective';end if;end$$;
select set_config('test.user_id','22222222-2222-4222-8222-222222222222',false);
update private.game_member_access set expires_at=now()-interval '1 day'
 where user_id='33333333-3333-4333-8333-333333333333';
select set_config('test.user_id','33333333-3333-4333-8333-333333333333',false);
do $$begin if not private.is_game_member('11111111-1111-4111-8111-111111111111')
 then raise exception 'Expired ban did not release';end if;end$$;
select set_config('test.user_id','22222222-2222-4222-8222-222222222222',false);
select public.teacher_set_member_access('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','removed','{}'::text[],null,'Excluded from this game');
select set_config('test.user_id','33333333-3333-4333-8333-333333333333',false);
do $$
declare v_failed boolean:=false;
begin
 if private.is_game_member('11111111-1111-4111-8111-111111111111') then raise exception 'Exclusion ineffective';end if;
 begin
  perform public.join_game_with_code('GOS-TEST','STUDENT-SECRET-TEST','Student','8.414');
 exception when others then v_failed:=true;end;
 if not v_failed then raise exception 'Excluded member rejoined';end if;
end $$;
select set_config('test.user_id','22222222-2222-4222-8222-222222222222',false);
select public.teacher_set_member_access('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','active','{}'::text[],null,'');
select set_config('test.user_id','33333333-3333-4333-8333-333333333333',false);
do $$begin
 if not private.is_game_member('11111111-1111-4111-8111-111111111111') then raise exception 'Restore failed';end if;
 if (select count(*) from public.political_posts where author_id=auth.uid())<>1 then raise exception 'History was lost';end if;
end $$;
\echo 'PASS real PostgreSQL invitation, RLS gate, restrictions, ban expiry, exclusion and restoration'
