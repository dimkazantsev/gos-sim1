-- A manually resolved financial case must never be invited again by the timer.
create or replace function private.dispatch_budget_risks(p_game uuid default null) returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare r record;n integer:=0;recipient uuid;begin
 for r in select q.*,c.title,c.situation from private.budget_deferred_risks q join event_cases c on c.id=q.case_id join budget_simulator_state s on s.game_id=q.game_id
 where q.dispatched_at is null and (p_game is null or q.game_id=p_game) and (q.due_at<=now() or q.due_month<=s.month) for update of q skip locked loop
  if exists(select 1 from event_case_outcomes where case_id=r.case_id) then update private.budget_deferred_risks set dispatched_at=now() where id=r.id;continue;end if;
  -- A classroom with no students keeps the pending case; it is delivered when students join.
  select user_id into recipient from game_members m where game_id=r.game_id and kind='student'
   order by private.can_create_formal_subject(r.game_id,m.user_id,'government') desc,m.joined_at limit 1;
  if recipient is null then continue;end if;
  update event_cases set status='ready' where id=r.case_id;
  insert into event_assignments(case_id,game_id,recipient_id,status) values(r.case_id,r.game_id,recipient,'pending') on conflict(case_id,recipient_id) do nothing;
  update private.budget_deferred_risks set dispatched_at=now() where id=r.id;
  insert into budget_simulator_ledger(game_id,kind,note,source_key) values(r.game_id,'risk','Наступило финансовое событие «'||r.title||'». Откройте «События», примите приглашение и обсудите решение.','risk:'||r.id) on conflict do nothing;
  insert into game_events(game_id,round_no,category,severity,title,body) values(r.game_id,13,'Бюджет','notice',r.title,r.situation);
  n:=n+1;
 end loop;return n;
end$$;

