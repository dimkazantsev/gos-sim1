-- Scope state-program corrections to the meeting which actually considers them.
alter table public.state_program_review_proposals
  add column if not exists session_id uuid references public.government_sessions(id) on delete set null;
create index if not exists state_program_review_session_idx
  on public.state_program_review_proposals(session_id,program_id,created_at desc);

create or replace function public.submit_government_agenda_program_proposal(
 p_session_id uuid,p_program_id uuid,p_section_key text,p_original_text text,
 p_proposed_text text,p_justification text
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.government_sessions%rowtype; v_uid uuid:=(select auth.uid());v_id uuid;
begin
 select * into s from public.government_sessions where id=p_session_id;
 if s.id is null or v_uid is null or not private.is_game_member(s.game_id) then
  raise exception 'Заседание недоступно';end if;
 if s.status not in ('draft','open') then raise exception 'Рассмотрение данного заседания завершено';end if;
 if not exists(select 1 from public.game_members m where m.game_id=s.game_id and m.user_id=v_uid
  and m.kind in ('student','teacher') and m.roster_archived_at is null) then
  raise exception 'Поправки могут вносить только участники игры';end if;
 if not exists(select 1 from public.government_program_agenda a where a.session_id=s.id
   and a.game_id=s.game_id and a.program_id=p_program_id and a.status<>'withdrawn') then
  raise exception 'Государственная программа не включена в повестку выбранного заседания';end if;
 if p_section_key not in ('passport','goals','structure','expenses','other') then
  raise exception 'Выберите раздел программы';end if;
 if length(btrim(coalesce(p_proposed_text,''))) not between 5 and 6000 then
  raise exception 'Предлагаемая редакция должна содержать от 5 до 6000 символов';end if;
 insert into public.state_program_review_proposals
 (game_id,program_id,session_id,section_key,original_text,proposed_text,justification,created_by)
 values(s.game_id,p_program_id,s.id,p_section_key,left(coalesce(p_original_text,''),4000),
  btrim(p_proposed_text),left(coalesce(p_justification,''),4000),v_uid) returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.submit_government_agenda_program_proposal(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.submit_government_agenda_program_proposal(uuid,uuid,text,text,text,text) to authenticated;
