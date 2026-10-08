-- No DDL; fictional rollback data; errors returned as JSON.
begin;
do $setup$
declare s text:='setup';g uuid:=gen_random_uuid();t uuid:=gen_random_uuid();a uuid:=gen_random_uuid();m uuid:=gen_random_uuid();p uuid:=gen_random_uuid();id uuid;x jsonb;
begin
perform set_config('qa.fixture_error','',true);perform set_config('qd.c','{}',true);
begin
foreach id in array array[t,a,m,p] loop insert into auth.users(id,aud,role) values(id,'authenticated','authenticated');end loop;
perform set_config('request.jwt.claim.sub',t::text,true);
insert into public.games(id,title,game_code,owner_id,status,current_round,turn_open) values(g,'QA test','QA'||substr(replace(g::text,'-',''),1,12),t,'running',11,true);
insert into public.game_members(game_id,user_id,full_name,kind,role_title) values(g,t,'QA T','teacher','Преподаватель'),(g,a,'QA A','student','Министр'),(g,m,'QA M','student','Министр'),(g,p,'QA PM','student','Председатель Правительства');
insert into public.game_stages(game_id,stage_no,title,mode,summary,status) select g,n,'QA '||n,'QA','QA',case when n in(10,11) then 'open' else 'locked' end from generate_series(1,16)n;
x:=jsonb_build_object('title','QA program','responsible_ministry','QA min','responsible_minister_id',m,'national_goal','QA goal','participants','QA members','start_date','2026-01-01','end_date','2028-12-31','expected_results','QA results',
'goals','[{"goal_text":"QA service","indicator_name":"QA availability","unit":"units","baseline_value":"10","target_value":"90","target_year":"2028"}]'::jsonb,
'components',(select jsonb_agg(jsonb_build_object('direction_no',n,'direction_title','QA dir','component_kind',case n when 1 then 'project' when 2 then 'target_program' else 'measure' end,'title','QA item','goal_text','QA goal','start_date','2026-01-01','end_date','2028-12-31')) from generate_series(1,3)n),
'expenses',(select jsonb_agg(jsonb_build_object('component_no',c,'budget_year',y,'amount',v.a,'indicator_name','QA row','justification','QA reason')) from(values(1,2026,'0.1'),(1,2026,'0.2'),(2,2027,'900719925474099.91'),(3,2027,'0.01'))v(c,y,a)));
perform set_config('qd.g',g::text,true);perform set_config('qd.u',jsonb_build_object('teacher',t,'creator',a,'minister',m,'pm',p)::text,true);perform set_config('qd.x',x::text,true);
perform set_config('qd.q',$snapshot$select jsonb_build_object('p',(select to_jsonb(p) from public.state_programs p where p.id=$1),'g',(select coalesce(jsonb_agg(g order by g.id),'[]') from public.state_program_goals g where g.program_id=$1),'c',(select coalesce(jsonb_agg(c order by c.id),'[]') from public.state_program_components c where c.program_id=$1),'e',(select coalesce(jsonb_agg(e order by e.id),'[]') from public.state_program_expenses e where e.program_id=$1),'y',(select coalesce(jsonb_agg(y order by y.budget_year),'[]') from public.state_program_budget_years y where y.program_id=$1),'b',(select coalesce(jsonb_agg(b order by b.budget_year),'[]') from public.state_program_budget_commitments b where b.program_id=$1),'posts',(select coalesce(jsonb_agg(q order by q.id),'[]') from public.political_posts q where q.source_key='state_program_signed:'||$1::text))$snapshot$,true);
perform set_config('qd.c',(current_setting('qd.c')::jsonb||'{"setup":"PASS"}'::jsonb)::text,true);
exception when others then perform set_config('qa.fixture_error',jsonb_build_object('block','setup','step',s,'SQLSTATE',SQLSTATE,'SQLERRM',SQLERRM)::text,true);end;
end;$setup$;
set local role authenticated;
do $A$
declare s text:='A';g uuid;u jsonb;x jsonb;i uuid;q jsonb;v record;b jsonb;z jsonb;ps jsonb:='[]';ok boolean;action text;
begin
if coalesce(current_setting('qa.fixture_error',true),'')<>'' then return;end if;begin
g:=current_setting('qd.g')::uuid;u:=current_setting('qd.u')::jsonb;x:=current_setting('qd.x')::jsonb;
perform set_config('request.jwt.claim.sub',u->>'creator',true);
s:='draft save';i:=public.save_state_program_draft(g,null,x,false);
if (public.get_state_program_readiness(i)->>'ready')::boolean is distinct from true then raise exception 'Draft not ready: %',public.get_state_program_readiness(i);end if;
s:='author confirm';perform public.save_state_program_draft(g,i,x,true);
perform set_config('request.jwt.claim.sub',u->>'minister',true);
s:='minister approve';perform public.advance_state_program(i,'minister_approve');
perform set_config('request.jwt.claim.sub',u->>'pm',true);
s:='PM sign';perform public.advance_state_program(i,'pm_ready');
if not exists(select 1 from public.state_programs where id=i and status='ready' and signed_by=(u->>'pm')::uuid and signed_at is not null) or (select count(*) from public.state_program_budget_commitments where program_id=i and status='planned')<>3 then raise exception 'Bad signature/commitments';end if;
execute current_setting('qd.q') into q using i;
perform set_config('qd.s',i::text,true);perform set_config('qd.ss',q::text,true);
perform set_config('qd.c',(current_setting('qd.c')::jsonb||'{"signature":"PASS"}'::jsonb)::text,true);
perform set_config('request.jwt.claim.sub',u->>'creator',true);
for v in select * from(values('ten kopecks',0.10::numeric),('one kopeck',0.01::numeric))v(label,shift) loop
s:='annual '||v.label||' save';i:=public.save_state_program_draft(g,null,jsonb_set(x,'{title}',to_jsonb('QA annual '||v.label)),false);
s:='annual '||v.label||' redistribute';perform public.set_state_program_budget_year(i,2027,900719925474099.92-v.shift);perform public.set_state_program_budget_year(i,2026,0.30+v.shift);
if (select sum(amount) from public.state_program_budget_years where program_id=i)<>900719925474100.22 then raise exception 'Annual total mismatch';end if;
s:='annual '||v.label||' readiness';if (public.get_state_program_readiness(i)->>'ready')::boolean is distinct from false then raise exception 'Annual readiness wrong: %',public.get_state_program_readiness(i);end if;
execute current_setting('qd.q') into b using i;
s:='annual '||v.label||' submit reject';action:='submit_minister';
ok:=false;begin perform public.advance_state_program(i,action);exception when sqlstate 'P0001' then ok:=true;end;
if not ok then raise exception 'Invalid action accepted: %',action;end if;
execute current_setting('qd.q') into z using i;
if z is distinct from b then raise exception 'Snapshot changed';end if;

ps:=ps||jsonb_build_array(jsonb_build_object('id',i,'label',v.label));end loop;
perform set_config('qd.a',ps::text,true);
perform set_config('qd.c',(current_setting('qd.c')::jsonb||'{"annual":"PASS"}'::jsonb)::text,true);
exception when others then perform set_config('qa.fixture_error',jsonb_build_object('step',s,'SQLSTATE',SQLSTATE,'SQLERRM',SQLERRM)::text,true);end;
end;$A$;
reset role;
do $B$
declare s text:='B';g uuid;u jsonb;x jsonb;i uuid;k text;j jsonb;v record;ps jsonb:='[]';q jsonb;
begin
if coalesce(current_setting('qa.fixture_error',true),'')<>'' then return;end if;begin
g:=current_setting('qd.g')::uuid;u:=current_setting('qd.u')::jsonb;x:=current_setting('qd.x')::jsonb;
perform set_config('request.jwt.claim.sub',u->>'teacher',true);
for j in select value from jsonb_array_elements(current_setting('qd.a')::jsonb) loop update public.state_programs set status='pm_review' where id=(j->>'id')::uuid;end loop;
foreach k in array array['NaN','year9999'] loop
s:='legacy '||k||' valid save';i:=public.save_state_program_draft(g,null,jsonb_set(x,'{title}',to_jsonb('QA legacy poisoned '||k)),false);
update public.state_programs set form_version=1 where id=i;
s:='legacy '||k||' persist goal';insert into public.state_program_goals(program_id,game_id,goal_text,indicator_name,unit,baseline_value,target_value,target_year) values(i,g,'QA bad goal','QA indicator','units',case when k='NaN' then 'NaN'::numeric else 0 end,10,case when k='year9999' then 9999 else 2028 end);
s:='legacy '||k||' readiness';if (public.get_state_program_readiness(i)->>'ready')::boolean is distinct from false then raise exception 'Legacy readiness wrong: %',public.get_state_program_readiness(i);end if;
update public.state_programs set status='pm_review' where id=i;ps:=ps||jsonb_build_array(jsonb_build_object('id',i,'label',k));end loop;
perform set_config('qd.b',ps::text,true);
perform set_config('qd.c',(current_setting('qd.c')::jsonb||'{"legacy":"PASS"}'::jsonb)::text,true);
perform set_config('request.jwt.claim.sub',u->>'teacher',true);
i:=current_setting('qd.s')::uuid;
for v in select * from(values('government_vote','planned'),('adopted','approved'),('rejected','rejected'),('ready','planned'))v(status,commitment) loop
s:='status '||v.status||' update';update public.state_programs set status=v.status where id=i;
if (select count(*) from public.state_program_budget_commitments where program_id=i and status=v.commitment)<>3 then raise exception 'Commitment sync: %',v.status;end if;
s:='status '||v.status||' Budget RPC';if public.get_signed_state_program_budget(g)->0->>'program_status' is distinct from v.status then raise exception 'Budget status mismatch';end if;
execute current_setting('qd.q') into q using i;
if q->'posts' is distinct from current_setting('qd.ss')::jsonb->'posts' then raise exception 'Publication changed';end if;end loop;
s:='snapshot restore';if q is distinct from current_setting('qd.ss')::jsonb then raise exception 'Signed snapshot changed';end if;
s:='no spending';if to_regclass('public.budget_simulator_ledger') is not null then if exists(select 1 from public.budget_simulator_ledger where game_id=g) then raise exception 'Unexpected spending';end if;end if;
s:='privileges';if has_table_privilege('authenticated','public.state_program_expenses','INSERT') or has_table_privilege('authenticated','public.state_program_budget_commitments','UPDATE') or has_function_privilege('anon','public.save_state_program_draft(uuid,uuid,jsonb,boolean)','EXECUTE') or has_function_privilege('authenticated','private.publish_signed_state_program(uuid,uuid)','EXECUTE') then raise exception 'Privilege leak';end if;
perform set_config('qd.c',(current_setting('qd.c')::jsonb||'{"sync":"PASS"}'::jsonb)::text,true);
exception when others then perform set_config('qa.fixture_error',jsonb_build_object('step',s,'SQLSTATE',SQLSTATE,'SQLERRM',SQLERRM)::text,true);end;
end;$B$;
set local role authenticated;
do $C$
declare s text:='C';u jsonb;i uuid;v jsonb;b jsonb;z jsonb;ok boolean;action text;
begin
if coalesce(current_setting('qa.fixture_error',true),'')<>'' then return;end if;begin
u:=current_setting('qd.u')::jsonb;perform set_config('request.jwt.claim.sub',u->>'pm',true);
for v in select value from jsonb_array_elements(current_setting('qd.a')::jsonb||current_setting('qd.b')::jsonb) loop
i:=(v->>'id')::uuid;s:='PM '||(v->>'label')||' readiness';
if (public.get_state_program_readiness(i)->>'ready')::boolean is distinct from false then raise exception 'Invalid PM row is ready';end if;
execute current_setting('qd.q') into b using i;
s:='PM '||(v->>'label')||' sign reject';action:='pm_ready';
ok:=false;begin perform public.advance_state_program(i,action);exception when sqlstate 'P0001' then ok:=true;end;
if not ok then raise exception 'Invalid action accepted: %',action;end if;
execute current_setting('qd.q') into z using i;
if z is distinct from b then raise exception 'Snapshot changed';end if;

end loop;
perform set_config('qd.c',(current_setting('qd.c')::jsonb||'{"PM":"PASS"}'::jsonb)::text,true);
exception when others then perform set_config('qa.fixture_error',jsonb_build_object('step',s,'SQLSTATE',SQLSTATE,'SQLERRM',SQLERRM)::text,true);end;
end;$C$;
reset role;
select nullif(current_setting('qa.fixture_error',true),'')::jsonb as fixture_error,current_setting('qd.c',true)::jsonb as completed_checks,
case when coalesce(current_setting('qa.fixture_error',true),'')='' then 'PASS' else 'ERROR' end as result,
'Fictional rollback data; direct statuses test sync only; no votes or budget adoption' as scope;
rollback;
