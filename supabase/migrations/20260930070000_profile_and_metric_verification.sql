-- A profile is complete only when its own signature object actually exists.
create or replace function public.complete_my_game_profile(p_game uuid)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare m public.game_members%rowtype;p public.game_profiles%rowtype;u record;
begin
 select * into m from public.game_members where game_id=p_game and user_id=auth.uid();
 if m.user_id is null or m.kind='observer' then raise exception 'Участник или преподаватель обязателен';end if;
 select * into p from public.game_profiles where game_id=p_game and user_id=auth.uid();
 select email,email_confirmed_at,encrypted_password into u from auth.users where id=auth.uid();
 if p.intro_seen_at is null then raise exception 'Сначала посмотрите приветственный комикс';end if;
 if not trim(m.full_name) ~ '^[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+'
 then raise exception 'Укажите ФИО полностью';end if;
 if coalesce(p.gender,'unspecified')='unspecified' then raise exception 'Укажите пол';end if;
 if length(trim(coalesce(p.bio,'')))<15 then raise exception 'Добавьте описание не короче 15 символов';end if;
 if p.signature_path is null or p.signature_path not like p_game::text||'/profiles/'||auth.uid()::text||'/signature-%'
  or not exists(select 1 from storage.objects where bucket_id='game-assets' and name=p.signature_path)
 then raise exception 'Загрузите собственную игровую подпись';end if;
 if u.email is null or u.email_confirmed_at is null or nullif(u.encrypted_password,'') is null
 then raise exception 'Подтвердите почту и установите личный пароль';end if;
 update public.game_profiles set onboarding_completed_at=coalesce(onboarding_completed_at,now())
 where game_id=p_game and user_id=auth.uid();
end;
$$;

-- Metric change and optional public statement either both commit or both roll back.
create or replace function public.set_state_metric_and_post(p_metric_id uuid,p_value numeric,p_note text,
 p_publish boolean default false,p_title text default null)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare m public.state_metrics%rowtype;after_value numeric;post_id uuid;
begin
 select * into m from public.state_metrics where id=p_metric_id for update;
 if m.id is null or not private.is_game_teacher(m.game_id) then raise exception 'Требуются права преподавателя';end if;
 if p_value is null or p_value::text in ('NaN','Infinity','-Infinity') then raise exception 'Укажите конечное число';end if;
 if length(trim(coalesce(p_note,'')))=0 then raise exception 'Укажите обоснование изменения';end if;
 if (m.min_value is not null and p_value<m.min_value) or (m.max_value is not null and p_value>m.max_value)
 then raise exception 'Значение вне диапазона показателя';end if;
 perform public.set_state_metric(m.id,p_value,left(trim(p_note),4000));
 select value into after_value from public.state_metrics where id=m.id;
 if p_publish then
  insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,status,effects_applied)
  values(m.game_id,auth.uid(),'statement','teacher','Руководитель симуляции',
   coalesce(nullif(left(trim(p_title),180),''),'Изменение показателя: '||m.label),
   trim(p_note)||E'\n\nПоказатель «'||m.label||'»: '||m.value||' → '||after_value||' '||coalesce(m.unit,'')||
    '. Фактическое изменение: '||(after_value-m.value)||'.',
   array['Показатели','Республика',m.label],'published',true) returning id into post_id;
 end if;
 return jsonb_build_object('value',after_value,'delta',after_value-m.value,'post_id',post_id);
end;
$$;
revoke all on function public.set_state_metric_and_post(uuid,numeric,text,boolean,text) from public,anon;
grant execute on function public.set_state_metric_and_post(uuid,numeric,text,boolean,text) to authenticated;
