-- Optimize stage transitions and guarantee audit-quality activity logging.

create or replace function public.set_game_stage(
  p_game_id uuid,
  p_stage_no integer,
  p_minutes integer default 12
)
returns void
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_now timestamptz := now();
begin
  if p_stage_no < 1 or p_stage_no > 16 then
    raise exception 'Stage must be between 1 and 16';
  end if;
  if p_minutes < 1 or p_minutes > 240 then
    raise exception 'Turn duration must be between 1 and 240 minutes';
  end if;
  if not private.is_game_teacher(p_game_id) then
    raise exception 'Teacher access required';
  end if;

  update public.game_stages
  set status = case
      when stage_no < p_stage_no then 'completed'
      when stage_no = p_stage_no then 'open'
      else 'locked'
    end,
    opened_at = case
      when stage_no = p_stage_no then coalesce(opened_at, v_now)
      else opened_at
    end,
    completed_at = case
      when stage_no < p_stage_no then coalesce(completed_at, v_now)
      else null
    end
  where game_id = p_game_id;

  update public.games
  set current_round = p_stage_no,
      status = 'running',
      turn_open = true,
      turn_ends_at = v_now + make_interval(mins => p_minutes)
  where id = p_game_id;
end;
$$;

revoke all on function public.set_game_stage(uuid,integer,integer) from public, anon;
grant execute on function public.set_game_stage(uuid,integer,integer) to authenticated;

create or replace function private.log_game_interaction()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_game_id uuid;
  v_actor uuid;
  v_type text;
  v_label text;
  v_view text;
  v_payload jsonb := '{}'::jsonb;
begin
  if tg_table_name = 'player_actions' then
    v_game_id := new.game_id;
    v_actor := new.author_id;
    v_type := 'decision_submit';
    v_label := 'Отправил управленческое решение';
    v_view := 'actions';
    v_payload := jsonb_build_object('title',new.title,'type',new.action_type,'budget',new.budget);
  elsif tg_table_name = 'game_ballots' then
    select game_id into v_game_id from public.game_votes where id = new.vote_id;
    v_actor := new.voter_id;
    v_type := 'vote';
    v_label := case new.choice
      when 'yes' then 'Проголосовал ЗА'
      when 'no' then 'Проголосовал ПРОТИВ'
      else 'Воздержался'
    end;
    v_view := 'votes';
    v_payload := jsonb_build_object('vote_id',new.vote_id,'choice',new.choice,'weight',new.weight);
  elsif tg_table_name = 'chat_messages' then
    v_game_id := new.game_id;
    v_actor := new.author_id;
    v_type := 'chat';
    v_label := case new.kind
      when 'audio' then 'Отправил аудиосообщение'
      when 'video' then 'Отправил видеосообщение'
      when 'file' then 'Отправил файл'
      else 'Отправил сообщение'
    end;
    v_view := 'chat';
    v_payload := jsonb_build_object('channel_id',new.channel_id,'kind',new.kind);
  else
    return new;
  end if;

  if v_actor is not null and v_game_id is not null then
    insert into public.game_activity(game_id,actor_id,event_type,label,view_key,payload)
    values(v_game_id,v_actor,v_type,v_label,v_view,v_payload);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_activity_player_actions on public.player_actions;
create trigger trg_activity_player_actions after insert on public.player_actions
for each row execute function private.log_game_interaction();

drop trigger if exists trg_activity_game_ballots on public.game_ballots;
create trigger trg_activity_game_ballots after insert or update of choice,weight on public.game_ballots
for each row execute function private.log_game_interaction();

drop trigger if exists trg_activity_chat_messages on public.chat_messages;
create trigger trg_activity_chat_messages after insert on public.chat_messages
for each row execute function private.log_game_interaction();
