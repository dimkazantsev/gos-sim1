create or replace function public.set_presidential_election_date(
 p_game_id uuid,
 p_election_date date
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
 v_uid uuid:=(select auth.uid());
 v_doc uuid;
 v_steps jsonb;
 v_body text;
 v_signer_name text;
 v_registry text;
 v_history_id bigint;
 v_post uuid;
 v_source_key text;
begin
 if v_uid is null or not private.is_game_teacher(p_game_id)
 then raise exception 'Teacher access required'; end if;
 if p_election_date is null then raise exception 'Election date is required'; end if;

 select full_name into v_signer_name
 from public.game_members
 where game_id=p_game_id and user_id=v_uid;

 v_signer_name:=coalesce(nullif(trim(v_signer_name),''),'Преподаватель');

 v_body:='СОВЕТ ФЕДЕРАЦИИ ФЕДЕРАЛЬНОГО СОБРАНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ'
   ||E'\n\nПОСТАНОВЛЕНИЕ'
   ||E'\n\nО назначении выборов Президента Российской Федерации'
   ||E'\n\nСовет Федерации Федерального Собрания Российской Федерации постановляет:'
   ||E'\n1. Назначить выборы Президента Российской Федерации на '||to_char(p_election_date,'DD.MM.YYYY')||'.'
   ||E'\n2. Настоящее постановление вступает в силу со дня его принятия.'
   ||E'\n\nМосква';

 select id,registry_no into v_doc,v_registry
 from public.formal_documents
 where game_id=p_game_id
   and stage_no=7
   and doc_type='sf_resolution'
   and metadata->>'purpose'='presidential_election_appointment'
 order by created_at desc
 limit 1;

 if v_doc is null then
   v_doc:=public.create_formal_document(
    p_game_id,7,
    'О назначении выборов Президента Российской Федерации',
    'sf_resolution',
    'sf',
    'Совет Федерации Федерального Собрания Российской Федерации',
    v_body,
    null,null,null,
    'sf_resolution',
    jsonb_build_object(
      'purpose','presidential_election_appointment',
      'election_date',p_election_date::text,
      'managed_by_teacher',true,
      'issuer_name','Совет Федерации Федерального Собрания Российской Федерации',
      'place','Москва'
    )
   );
   select registry_no into v_registry from public.formal_documents where id=v_doc;
 end if;

 v_steps:=private.formal_workflow('sf_resolution');

 update public.formal_documents
 set title='О назначении выборов Президента Российской Федерации',
     body_text=v_body,
     workflow_steps=v_steps,
     current_step=greatest(jsonb_array_length(v_steps)-1,0),
     status_code='published',
     status_label='Принято и опубликовано',
     current_owner_key='system',
     metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
       'purpose','presidential_election_appointment',
       'election_date',p_election_date::text,
       'managed_by_teacher',true,
       'issuer_name','Совет Федерации Федерального Собрания Российской Федерации',
       'institution','Совет Федерации Федерального Собрания Российской Федерации',
       'place','Москва',
       'act_number',v_registry,
       'registered_on',current_date::text,
       'adopted_on',current_date::text,
       'signed_on',now()::text,
       'signed_name',v_signer_name,
       'signed_role','Председатель Совета Федерации',
       'document_kind','Постановление Совета Федерации',
       'publication_status','Опубликовано'
     ),
     updated_at=now()
 where id=v_doc;

 -- История одновременно фиксирует подписание. Триггер снимка подписи
 -- сохранит текущее изображение подписи преподавателя, если оно загружено в профиль.
 insert into public.formal_document_history(
   document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note
 )
 values(
   v_doc,p_game_id,v_uid,
   'Подписано постановление Совета Федерации',
   'signed','signed','system','system',
   'Назначены выборы Президента Российской Федерации на '||to_char(p_election_date,'DD.MM.YYYY')
 );

 -- Находим исходную автоматическую публикацию, созданную при появлении НПА,
 -- и превращаем её в нормальную новость Совета Федерации.
 select id into v_history_id
 from public.formal_document_history
 where document_id=v_doc
 order by id asc
 limit 1;

 v_source_key:='formal-history:'||v_history_id::text;

 select id into v_post
 from public.political_posts
 where game_id=p_game_id and source_key=v_source_key
 limit 1;

 if v_post is null then
   v_post:=gen_random_uuid();
   insert into public.political_posts(
     id,game_id,author_id,process_type,actor_key,actor_label,title,body,tags,
     internal_view,internal_ref_id,status,source_key,context
   )
   values(
     v_post,p_game_id,v_uid,'information','sf','Совет Федерации',
     'Назначены выборы Президента Российской Федерации',
     'Совет Федерации назначил выборы Президента Российской Федерации на '
       ||to_char(p_election_date,'DD.MM.YYYY')
       ||'. Постановление '||v_registry||' оформлено, подписано и опубликовано в реестре НПА.',
     array['этап_gpyasu','ходигры_gpyasu'],
     'documents',v_doc::text,'published',v_source_key,
     jsonb_build_object(
       'automatic',true,
       'stage_no',7,
       'document_id',v_doc,
       'election_date',p_election_date::text,
       'institution','Совет Федерации'
     )
   );
 else
   update public.political_posts
   set author_id=v_uid,
       process_type='information',
       actor_key='sf',
       actor_label='Совет Федерации',
       title='Назначены выборы Президента Российской Федерации',
       body='Совет Федерации назначил выборы Президента Российской Федерации на '
         ||to_char(p_election_date,'DD.MM.YYYY')
         ||'. Постановление '||v_registry||' оформлено, подписано и опубликовано в реестре НПА.',
       tags=array['этап_gpyasu','ходигры_gpyasu'],
       internal_view='documents',
       internal_ref_id=v_doc::text,
       status='published',
       deleted_at=null,
       deleted_by=null,
       context=coalesce(context,'{}'::jsonb)||jsonb_build_object(
         'automatic',true,
         'stage_no',7,
         'document_id',v_doc,
         'election_date',p_election_date::text,
         'institution','Совет Федерации'
       ),
       updated_at=now()
   where id=v_post;
 end if;

 insert into public.political_post_formal_links(
   game_id,post_id,formal_document_id,created_by
 )
 values(p_game_id,v_post,v_doc,v_uid)
 on conflict(post_id,formal_document_id) do nothing;

 return v_doc;
end;
$$;

revoke all on function public.set_presidential_election_date(uuid,date) from public,anon;
grant execute on function public.set_presidential_election_date(uuid,date) to authenticated;
