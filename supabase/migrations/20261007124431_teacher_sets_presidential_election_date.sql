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
begin
 if v_uid is null or not private.is_game_teacher(p_game_id)
 then raise exception 'Teacher access required'; end if;
 if p_election_date is null then raise exception 'Election date is required'; end if;

 v_body:='Совет Федерации Федерального Собрания Российской Федерации постановляет назначить выборы Президента Российской Федерации на '
   ||to_char(p_election_date,'DD.MM.YYYY')||'.';

 select id into v_doc
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
      'managed_by_teacher',true
    )
   );
 end if;

 v_steps:=private.formal_workflow('sf_resolution');

 update public.formal_documents
 set body_text=v_body,
     workflow_steps=v_steps,
     current_step=greatest(jsonb_array_length(v_steps)-1,0),
     status_code='published',
     status_label='Оформлено',
     current_owner_key='system',
     metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
       'purpose','presidential_election_appointment',
       'election_date',p_election_date::text,
       'managed_by_teacher',true
     ),
     updated_at=now()
 where id=v_doc;

 insert into public.formal_document_history(
   document_id,game_id,actor_id,action,to_status,to_owner,note
 )
 values(
   v_doc,p_game_id,v_uid,
   'Преподаватель назначил дату выборов Президента РФ',
   'published','system',
   'Дата выборов: '||to_char(p_election_date,'DD.MM.YYYY')
 );

 return v_doc;
end;
$$;

revoke all on function public.set_presidential_election_date(uuid,date) from public,anon;
grant execute on function public.set_presidential_election_date(uuid,date) to authenticated;
