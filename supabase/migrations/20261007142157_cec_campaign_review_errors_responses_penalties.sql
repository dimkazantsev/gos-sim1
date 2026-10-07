alter table public.presidential_campaign_materials
  add column if not exists cec_errors text,
  add column if not exists cec_response text,
  add column if not exists penalty_points numeric(6,2) not null default 0,
  add column if not exists penalty_reason text;

do $$
begin
 if not exists (
  select 1 from pg_constraint
  where conrelid='public.presidential_campaign_materials'::regclass
    and conname='presidential_campaign_materials_penalty_points_check'
 ) then
  alter table public.presidential_campaign_materials
   add constraint presidential_campaign_materials_penalty_points_check
   check(penalty_points between 0 and 100);
 end if;
end $$;

create or replace function private.recompute_presidential_candidate_penalty(p_candidate_id uuid)
returns numeric
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 v_game uuid;
 v_total numeric;
begin
 select game_id into v_game
 from public.presidential_candidates
 where id=p_candidate_id;

 if v_game is null then raise exception 'Candidate not found'; end if;

 select coalesce(sum(penalty_points),0)
 into v_total
 from public.presidential_campaign_materials
 where candidate_id=p_candidate_id
   and status in ('approved','rejected');

 update public.presidential_candidates
 set rating_penalty=least(100,round(v_total,2)),
     updated_at=now()
 where id=p_candidate_id;

 perform private.recompute_presidential_jury_scores(v_game);
 return least(100,round(v_total,2));
end;
$$;

revoke all on function private.recompute_presidential_candidate_penalty(uuid) from public,anon,authenticated;

create or replace function public.review_presidential_campaign_material_cec(
 p_material_id uuid,
 p_approve boolean,
 p_note text default null,
 p_errors text default null,
 p_response text default null,
 p_penalty_points numeric default 0,
 p_penalty_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 m public.presidential_campaign_materials%rowtype;
 c public.presidential_candidates%rowtype;
 v_uid uuid:=(select auth.uid());
 v_post uuid;
 f jsonb;
begin
 select * into m
 from public.presidential_campaign_materials
 where id=p_material_id
 for update;

 if m.id is null then raise exception 'Material not found'; end if;
 if not private.is_game_teacher(m.game_id) then raise exception 'CEC access required'; end if;
 if m.status<>'pending' then raise exception 'Material already reviewed'; end if;
 if coalesce(p_penalty_points,0)<0 or coalesce(p_penalty_points,0)>100 then
  raise exception 'Penalty must be between 0 and 100';
 end if;
 if coalesce(p_penalty_points,0)>0 and length(trim(coalesce(p_penalty_reason,'')))<3 then
  raise exception 'Penalty reason is required';
 end if;

 select * into c
 from public.presidential_candidates
 where id=m.candidate_id;

 if p_approve then
  insert into public.political_posts(
   game_id,author_id,process_type,actor_key,actor_label,title,body,tags,
   external_url,internal_view,internal_ref_id,source_key,context
  )
  values(
   m.game_id,m.author_id,'information','candidate:'||c.id::text,c.display_name,m.title,
   m.body||E'\n\nВыходные данные: '||coalesce(m.imprint_text,'не применяются')||
   case when m.print_run>0 then E'\nТираж: '||m.print_run::text else '' end||
   case when m.publisher_name is not null then E'\nИзготовитель/распространитель: '||m.publisher_name else '' end,
   array['выборы_gpyasu','президент_gpyasu','агитация_gpyasu'],
   m.external_url,'stages',m.candidate_id::text,
   'presidential-campaign:'||m.id::text,
   jsonb_build_object(
    'automatic',true,'stage_no',7,'candidate_id',m.candidate_id,
    'campaign_material_id',m.id,'print_run',m.print_run,'imprint_text',m.imprint_text,
    'cec_reviewed',true,'cec_penalty_points',coalesce(p_penalty_points,0)
   )
  )
  returning id into v_post;

  for f in select * from jsonb_array_elements(coalesce(m.files,'[]'::jsonb)) loop
   insert into public.political_post_media(
    game_id,post_id,uploader_id,media_kind,storage_path,file_name,mime_type,file_size
   )
   values(
    m.game_id,v_post,m.author_id,coalesce(f->>'media_kind','file'),
    f->>'storage_path',f->>'file_name',f->>'mime_type',nullif(f->>'file_size','')::bigint
   );
  end loop;
 end if;

 update public.presidential_campaign_materials
 set status=case when p_approve then 'approved' else 'rejected' end,
     review_note=nullif(trim(coalesce(p_note,'')),''),
     cec_errors=nullif(trim(coalesce(p_errors,'')),''),
     cec_response=nullif(trim(coalesce(p_response,'')),''),
     penalty_points=round(coalesce(p_penalty_points,0),2),
     penalty_reason=nullif(trim(coalesce(p_penalty_reason,'')),''),
     reviewed_by=v_uid,
     reviewed_at=now(),
     post_id=v_post
 where id=m.id;

 perform private.recompute_presidential_candidate_penalty(m.candidate_id);

 return v_post;
end;
$$;

revoke all on function public.review_presidential_campaign_material_cec(uuid,boolean,text,text,text,numeric,text) from public,anon;
grant execute on function public.review_presidential_campaign_material_cec(uuid,boolean,text,text,text,numeric,text) to authenticated;
