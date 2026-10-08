-- Preserve the teacher's explicit authority classification for manual event options.
-- Legacy callers keep their existing behavior; new legal metadata is validated as a unit.
CREATE OR REPLACE FUNCTION public.create_assigned_event(p_game_id uuid, p_title text, p_situation text, p_category text, p_seriousness text, p_audience text, p_options jsonb, p_recipients uuid[], p_roles text[] DEFAULT '{}'::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c uuid;o jsonb;choices jsonb:='[]';effects jsonb:='[]';i integer:=0;trust numeric;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Требуются права преподавателя';end if;
 if length(trim(p_title))<6 or length(trim(p_situation))<20 then raise exception 'Добавьте название и описание';end if;
 if jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options) not between 2 and 6 then raise exception 'Добавьте от 2 до 6 вариантов';end if;
 for o in select value from jsonb_array_elements(p_options) loop
  i:=i+1;
  if length(trim(coalesce(o->>'label','')))<2 or length(trim(coalesce(o->>'description','')))<5 then raise exception 'Заполните вариант и его последствия';end if;
  trust:=(o->>'trust')::numeric;
  if trust is null or trust::text in ('NaN','Infinity','-Infinity') or abs(trust)>100 then raise exception 'Некорректное влияние на доверие';end if;

  if o?'authorized_roles' or o?'lawful' or o?'legal_basis' or o?'protects_role_interest' then
   if jsonb_typeof(o->'authorized_roles') is distinct from 'array'
      or jsonb_typeof(o->'lawful') is distinct from 'boolean'
      or length(trim(coalesce(o->>'legal_basis','')))<5
      or length(o->>'legal_basis')>2000 then
    raise exception 'Укажите законность, полномочные должности и правовое основание варианта';
   end if;
   if jsonb_array_length(o->'authorized_roles') not between 1 and 20
      or exists(select 1 from jsonb_array_elements(o->'authorized_roles') r where jsonb_typeof(r)<>'string' or length(trim(r#>>'{}')) not between 2 and 120)
      or (o?'protects_role_interest' and jsonb_typeof(o->'protects_role_interest') is distinct from 'boolean') then
    raise exception 'Проверьте полномочные должности и интересы роли';
   end if;
  end if;
  choices:=choices||jsonb_build_array(left(trim(o->>'label'),500));
  effects:=effects||jsonb_build_array(jsonb_build_object('key','option_'||i,'trust',trust,
    'description',left(trim(o->>'description'),2000),'public_interest',case when trust>0 then 'beneficial' when trust<0 then 'harmful' else 'neutral' end)
    || case when o?'lawful' then jsonb_build_object('authorized_roles',o->'authorized_roles','lawful',(o->>'lawful')::boolean,
       'legal_basis',trim(o->>'legal_basis'),'protects_role_interest',coalesce((o->>'protects_role_interest')::boolean,false)) else '{}'::jsonb end);
 end loop;
 if (select count(distinct lower(value)) from jsonb_array_elements_text(choices))<>i then raise exception 'Варианты должны различаться';end if;
 insert into public.event_cases(game_id,case_key,title,situation,category,seriousness,audience,allowed_roles,
  decision_options,effect_plan,comic_scene,status,created_by,source_note)
 values(p_game_id,'manual-'||gen_random_uuid(),left(trim(p_title),180),left(trim(p_situation),5000),
  left(trim(p_category),100),p_seriousness,p_audience,coalesce(p_roles,'{}'),choices,
  jsonb_build_object('options',effects),jsonb_build_object('title',trim(p_title),'category',trim(p_category)),
  'ready',auth.uid(),'Учебное событие преподавателя. Влияние размечено автором.') returning id into c;
 perform public.assign_event_case(c,p_recipients);
 return c;
end;
$function$
