-- Immediate party, invitation and Minjust notices use the existing durable outbox.
-- Unlinked/unsubscribed users produce no unnecessary Telegram jobs.
create or replace function private.queue_party_notice()
returns trigger language plpgsql security definer
set search_path to 'public','private','pg_temp'
as $fn$
declare v_name text;v_recipient uuid;v_body text;v_category text;v_source uuid;v_game uuid;
begin
 if tg_table_name='party_invitations' then
  if tg_op<>'INSERT' or new.status<>'pending' then return new;end if;
  select name into v_name from public.game_parties where id=new.party_id and game_id=new.game_id;
  v_category:='party_invite';v_body:='Вас пригласили в партию «'||coalesce(v_name,'Партия')||'». Откройте раздел «Партии и фракции», чтобы ответить.';
  v_source:=new.id;v_game:=new.game_id;v_recipient:=new.invited_user_id;
 elsif tg_table_name='game_parties' then
  if new.registration_status<>'submitted' or (tg_op='UPDATE' and old.registration_status='submitted') then return new;end if;
  v_category:='party_registration';v_body:='Партия «'||new.name||'» направила документы на регистрацию. Требуется рассмотрение Минюстом.';
  v_source:=new.id;v_game:=new.game_id;
 elsif tg_table_name='party_documents' then
  if tg_op='INSERT' then
   if new.status<>'submitted' then return new;end if;
   v_category:='party_document';v_body:='В Минюст поступил партийный документ: «'||left(new.title,180)||'».';
  elsif tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('accepted','revision') then
   v_category:='party_review';v_body:='Минюст рассмотрел документ «'||left(new.title,180)||'»: '||
    (case when new.status='accepted' then 'принят' else 'направлен на доработку' end)||'.';
  else return new; end if;
  v_source:=new.id;v_game:=new.game_id;
 end if;
 if v_category in ('party_registration','party_document') then
  for v_recipient in select m.user_id from public.game_members m
   join public.telegram_links t on t.game_id=m.game_id and t.user_id=m.user_id and t.notifications_enabled
   where m.game_id=v_game and m.kind='teacher' and m.roster_archived_at is null loop
   insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
   values(v_game,v_recipient,v_category,v_source,v_body);
  end loop;
 elsif v_category='party_review' then
  insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
  select v_game,new.uploaded_by,v_category,v_source,v_body
  where exists(select 1 from public.telegram_links t where t.game_id=v_game and t.user_id=new.uploaded_by and t.notifications_enabled);
 elsif v_category='party_invite' then
  insert into public.telegram_outbox(game_id,user_id,category,source_id,body)
  select v_game,v_recipient,v_category,v_source,v_body
  where exists(select 1 from public.telegram_links t where t.game_id=v_game and t.user_id=v_recipient and t.notifications_enabled);
 end if;
 return new;
end $fn$;
drop trigger if exists game_party_notice_invitation on public.party_invitations;
create trigger game_party_notice_invitation after insert on public.party_invitations for each row execute function private.queue_party_notice();
drop trigger if exists game_party_notice_registration on public.game_parties;
create trigger game_party_notice_registration after insert or update of registration_status on public.game_parties for each row execute function private.queue_party_notice();
drop trigger if exists game_party_notice_document on public.party_documents;
create trigger game_party_notice_document after insert or update of status on public.party_documents for each row execute function private.queue_party_notice();
