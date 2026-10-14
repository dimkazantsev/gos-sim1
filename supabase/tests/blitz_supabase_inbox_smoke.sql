-- Transaction-local synthetic integration; never touches production.
begin;
do $test$
declare
 gid uuid:='11111111-1111-4111-8111-111111111111';
 uid uuid;
 aid uuid:='40000000-0000-4000-8000-000000000001';
 before_count jsonb;
 after_count jsonb;
 opened jsonb;
 result jsonb;
 pending jsonb;
 answered jsonb;
begin
 select m.user_id into uid from public.game_members m where m.game_id=gid and m.kind='student'
  and not exists(select 1 from public.blitz_assignments a where a.game_id=gid and a.user_id=m.user_id and a.answered_at is null)
 limit 1;
 if uid is null then raise exception 'No synthetic student'; end if;
 insert into public.blitz_assignments(id,game_id,user_id,question_id,stage_no,available_at)
 values(aid,gid,uid,1,1,clock_timestamp()-interval '1 minute');
 perform set_config('request.jwt.claim.sub',uid::text,true);
 before_count:=public.blitz_inbox_counts(gid);
 if (before_count->>'pending')::int<1 then raise exception 'Pending inbox did not count open assignment'; end if;
 pending:=public.blitz_archive_filtered(gid,uid,'pending',0,30);
 if not exists(select 1 from jsonb_array_elements(pending) r where r->>'id'=aid::text and r->'correct_index'='null'::jsonb)
 then raise exception 'Pending archive disclosed answer or lost row'; end if;
 opened:=public.blitz_open_selected(aid);
 if opened->>'id' is distinct from aid::text or opened ? 'correct_index' then
  raise exception 'Selected open did not return safe exact assignment'; end if;
 result:=public.blitz_answer(aid,0);
 if result->>'id' is distinct from aid::text then raise exception 'Answer not recorded'; end if;
 if public.blitz_open_selected(aid) is not null then raise exception 'Answered assignment reopened'; end if;
 if public.blitz_open_recent(gid,clock_timestamp()-interval '1 minute') is not null then
  raise exception 'Completed assignment returned to spontaneous Blitz'; end if;
 answered:=public.blitz_archive_filtered(gid,uid,'answered',0,30);
 if not exists(select 1 from jsonb_array_elements(answered) r where r->>'id'=aid::text and r->>'correct_index'='0')
 then raise exception 'Resolved answer missing from completed inbox'; end if;
 pending:=public.blitz_archive_filtered(gid,uid,'pending',0,30);
 if exists(select 1 from jsonb_array_elements(pending) r where r->>'id'=aid::text)
 then raise exception 'Answered assignment repeated in pending inbox'; end if;
 after_count:=public.blitz_inbox_counts(gid);
 if (after_count->>'answered')::int<1 then raise exception 'Completed count not synchronized'; end if;
 raise notice 'PASS selected open, one response, archive separation and counts';
end $test$;
rollback;
