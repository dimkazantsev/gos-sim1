select set_config('test.user_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $$
declare gid uuid:='11111111-1111-4111-8111-111111111111';j jsonb;failure boolean;
begin
 j:=public.teacher_access_code_list(gid);
 if jsonb_array_length(j)<>3 then raise exception 'Expected exactly 3 invitations, received %',j;end if;
 if not exists(select 1 from jsonb_array_elements(j) t where t->>'scope'='guest') then raise exception 'Guest invitation missing';end if;
 if not exists(select 1 from jsonb_array_elements(j) t where t->>'scope'='group' and t->>'group_name'='8.414') then raise exception 'Group invitation missing';end if;
 if not exists(select 1 from jsonb_array_elements(j) t where t->>'scope'='participant') then raise exception 'Participant invitation missing';end if;
 if j::text like '%hashed%' then raise exception 'Secrets leaked';end if;
 if public.teacher_delete_access_code(gid,'00000000-0000-4000-8000-000000000003') then raise exception 'Deleted active invitation';end if;
 if public.teacher_revoke_access_code(gid,'00000000-0000-4000-8000-000000000004') then raise exception 'Revoked teacher code';end if;
 if not public.teacher_revoke_access_code(gid,'00000000-0000-4000-8000-000000000003') then raise exception 'Guest revoke failed';end if;
 if not public.teacher_delete_access_code(gid,'00000000-0000-4000-8000-000000000003') then raise exception 'Inactive guest deletion failed';end if;
 if (select count(*) from public.game_members where game_id=gid)<>2 then raise exception 'Membership changed';end if;
 if (select count(*) from public.invite_codes where game_id=gid and kind='teacher')<>1 then raise exception 'Teacher code changed';end if;
 -- Cross-game mutation forbidden even if invitation ID is known.
 if public.teacher_revoke_access_code(gid,'00000000-0000-4000-8000-000000000005') then raise exception 'Cross-game revoke succeeded';end if;
end $$;
select set_config('test.user_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
do $$
declare gid uuid:='11111111-1111-4111-8111-111111111111';failure boolean:=false;
begin
 begin perform public.teacher_access_code_list(gid);exception when others then failure:=true;end;
 if not failure then raise exception 'Participant read teacher list';end if;
 failure:=false;
 begin perform public.teacher_revoke_access_code(gid,'00000000-0000-4000-8000-000000000001');exception when others then failure:=true;end;
 if not failure then raise exception 'Participant revoked invitation';end if;
end $$;
select count(*) as preserved_other_game from public.invite_codes where game_id='22222222-2222-4222-8222-222222222222';
\echo 'PASS guest invites, teacher gates, revocation, deletion, isolation and data integrity'
