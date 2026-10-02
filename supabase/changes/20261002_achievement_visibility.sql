create table public.game_achievement_settings(
 game_id uuid not null references public.games(id) on delete cascade,
 achievement_id text not null references private.achievement_catalog(id),hidden boolean not null,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),primary key(game_id,achievement_id)
);
alter table public.game_achievement_settings enable row level security;
create policy achievement_settings_teacher on public.game_achievement_settings for select to authenticated using(private.is_game_teacher(game_id));
grant select on public.game_achievement_settings to authenticated;
revoke insert,update,delete on public.game_achievement_settings from public,anon,authenticated;

create or replace function public.get_teacher_achievements(p_game_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Управление наградами доступно преподавателю.';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'description',c.description,'hidden',coalesce(s.hidden,c.hidden),'conditions',c.conditions,'earned_count',(select count(*) from game_achievements a where a.game_id=p_game_id and a.achievement_id=c.id)) order by c.sort_order),'[]') from private.achievement_catalog c left join game_achievement_settings s on s.game_id=p_game_id and s.achievement_id=c.id);
end$$;
create or replace function public.set_achievement_visibility(p_game_id uuid,p_achievement_id text,p_hidden boolean) returns void
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if auth.uid() is null or not private.is_game_teacher(p_game_id) then raise exception 'Видимость награды меняет преподаватель.';end if;
 if p_hidden is null or not exists(select 1 from private.achievement_catalog where id=p_achievement_id) then raise exception 'Награда не найдена.';end if;
 insert into game_achievement_settings(game_id,achievement_id,hidden,updated_by) values(p_game_id,p_achievement_id,p_hidden,auth.uid()) on conflict(game_id,achievement_id) do update set hidden=excluded.hidden,updated_by=auth.uid(),updated_at=now();
end$$;
create or replace function public.get_game_achievements(p_game_id uuid,p_user_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare u uuid:=coalesce(p_user_id,auth.uid());f jsonb;hidden_count integer;
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) or not exists(select 1 from game_members where game_id=p_game_id and user_id=u) then raise exception 'Награды этого профиля недоступны.';end if;
 f:=private.achievement_facts(p_game_id,u);
 select count(*) into hidden_count from private.achievement_catalog c left join game_achievement_settings s on s.game_id=p_game_id and s.achievement_id=c.id where coalesce(s.hidden,c.hidden);
 return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'description',c.description,'hidden',coalesce(s.hidden,c.hidden),'hidden_total',hidden_count,'open_total',100-hidden_count,'earned_at',a.earned_at,'progress',case when coalesce(s.hidden,c.hidden) and a.earned_at is not null then 100 else least(100,(select coalesce(min(100*coalesce((f->>k.key)::numeric,0)/k.value::numeric),0) from jsonb_each_text(c.conditions) k)) end) order by c.sort_order),'[]') from private.achievement_catalog c left join game_achievement_settings s on s.game_id=p_game_id and s.achievement_id=c.id left join game_achievements a on a.achievement_id=c.id and a.game_id=p_game_id and a.user_id=u where not coalesce(s.hidden,c.hidden) or a.earned_at is not null);
end$$;
revoke all on function public.get_teacher_achievements(uuid),public.set_achievement_visibility(uuid,text,boolean),public.get_game_achievements(uuid,uuid) from public,anon;
grant execute on function public.get_teacher_achievements(uuid),public.set_achievement_visibility(uuid,text,boolean),public.get_game_achievements(uuid,uuid) to authenticated;
