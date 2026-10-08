-- A refresh must not update unchanged rows or trigger another refresh.
create or replace function public.ensure_stage9_units(p_game_id uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare s public.government_structures%rowtype;
begin
 if (select auth.uid()) is null or not private.is_game_member(p_game_id) then raise exception 'Game access required';end if;
 select * into s from public.government_structures where game_id=p_game_id and status='approved';
 insert into public.institution_units(game_id,unit_kind,unit_key,title,description,mandate_capacity)
 values
 (p_game_id,'committee','social','Комитет по социальной политике','Труд, демография, культура, образование, здравоохранение и смежные вопросы',90),
 (p_game_id,'committee','economic','Комитет по экономической политике','Финансы, налоги, транспорт, энергетика и смежные вопросы',90),
 (p_game_id,'committee','defence','Комитет по обороне и безопасности','Оборона и безопасность',90),
 (p_game_id,'committee','foreign','Комитет по внешней политике','Внешняя политика и международные отношения',90),
 (p_game_id,'committee','internal','Комитет по внутренней политике и государству','ОГВ, ОМС, национальности, гражданское общество, НКО и смежные вопросы',90),
 (p_game_id,'ministry','social',coalesce(s.social_title,'Министерство по социальной политике'),'Труд, демография, культура, образование, здравоохранение и смежные вопросы',null),
 (p_game_id,'ministry','economic',coalesce(s.economic_title,'Министерство по экономической политике'),'Финансы, налоги, транспорт, энергетика и смежные вопросы',null),
 (p_game_id,'ministry','defence',coalesce(s.defence_title,'Министерство по обороне и внутренней безопасности'),'Оборона и внутренняя безопасность',null),
 (p_game_id,'ministry','foreign',coalesce(s.foreign_title,'Министерство по внешней политике'),'Внешняя политика',null),
 (p_game_id,'ministry','internal',coalesce(s.internal_title,'Министерство по внутренней политике и государству'),'ОГВ, ОМС, национальности, ГО, НКО, МВД, МЧС в рамках учебной редукции',null)
 on conflict(game_id,unit_kind,unit_key) do update set title=excluded.title
 where public.institution_units.title is distinct from excluded.title;
 update public.institution_units set capacity_min=3,capacity_max=5 where game_id=p_game_id and unit_kind='ministry' and capacity_min is null;
 update public.institution_units u set head_user_id=n.candidate_user_id
 from public.government_nominations n
 where u.game_id=p_game_id and u.unit_kind='ministry' and n.game_id=p_game_id and n.status='appointed'
   and n.office_key='ministry_'||u.unit_key and n.candidate_user_id is not null
   and u.head_user_id is distinct from n.candidate_user_id;
end;$$;
revoke all on function public.ensure_stage9_units(uuid) from public,anon;
grant execute on function public.ensure_stage9_units(uuid) to authenticated;

-- Keep the existing publication and add only missing procedure tables.
do $publication$
declare relation_name text;
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach relation_name in array array['institution_session_registrations','game_voting_body_members','municipal_mayor_ballots'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=relation_name) then
    execute format('alter publication supabase_realtime add table public.%I',relation_name);
   end if;
  end loop;
 end if;
end;$publication$;
