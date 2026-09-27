-- Stage 11: adopted state programs are automatically formalized by Government resolutions.
create or replace function private.state_program_vote_trigger()
returns trigger
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare p public.state_programs%rowtype;v_doc uuid;
begin
 if new.status='closed' and old.status is distinct from new.status and new.procedure_key='state_program' then
  select * into p from public.state_programs where government_vote_id=new.id for update;
  if p.id is null then return new; end if;
  update public.state_programs
  set status=case when new.result_code='passed' then 'adopted' else 'rejected' end,updated_at=now()
  where id=p.id;

  if new.result_code='passed'
     and not exists(
       select 1 from public.formal_documents
       where game_id=p.game_id and stage_no=11 and doc_type='government_resolution'
         and metadata->>'state_program_id'=p.id::text
     )
  then
    v_doc:=public.create_formal_document(
      p.game_id,11,'Об утверждении государственной программы «'||p.title||'»',
      'government_resolution','government','Правительство Российской Федерации',
      'Правительство Российской Федерации постановляет: утвердить государственную программу «'||p.title||
      '». Ответственный исполнитель: '||p.responsible_ministry||
      '. Срок реализации: '||coalesce(p.start_date::text,'не указан')||' — '||coalesce(p.end_date::text,'не указан')||
      '. Общий объём бюджетных ассигнований: '||p.total_budget::text||'.',
      null,null,null,'government_act',
      jsonb_build_object('state_program_id',p.id,'government_vote_id',new.id,'auto_generated',true)
    );
    update public.formal_documents
    set current_step=3,status_code='published',status_label='Подписан и опубликован',current_owner_key='system',updated_at=now()
    where id=v_doc;
    insert into public.formal_document_history(document_id,game_id,actor_id,action,from_status,to_status,from_owner,to_owner,note)
    values(v_doc,p.game_id,new.created_by,'Оформлено по итогам заседания Правительства','draft','published','author','system',
      'Постановление сформировано системой после положительного решения Правительства по государственной программе.');
  end if;
 end if;
 return new;
end;$$;
revoke execute on function private.state_program_vote_trigger() from public,anon,authenticated;