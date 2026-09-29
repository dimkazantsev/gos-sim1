-- Private game credentials are never stored as recoverable plaintext passwords.
-- Users may upgrade Supabase anonymous Auth to verified email + password.
alter table public.game_profiles add column if not exists signature_path text;

create table if not exists public.formal_document_signatures(
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.formal_documents(id) on delete cascade,
 game_id uuid not null references public.games(id) on delete cascade,
 history_id bigint not null unique references public.formal_document_history(id) on delete cascade,
 signer_id uuid not null,
 signature_path text not null,
 signed_at timestamptz not null default now()
);
create index if not exists formal_document_signatures_doc on public.formal_document_signatures(document_id);
alter table public.formal_document_signatures enable row level security;
drop policy if exists formal_signatures_read on public.formal_document_signatures;
create policy formal_signatures_read on public.formal_document_signatures for select to authenticated
 using(private.is_game_member(game_id));
revoke all on public.formal_document_signatures from public,anon;
grant select on public.formal_document_signatures to authenticated;

create or replace function private.capture_formal_document_signature()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare sig text;
begin
 if new.actor_id is null then return new;end if;
 -- Signatures are stamped only after an explicit authenticated signing transition.
 if coalesce(new.action,'') !~* 'подпис|signature'
    and coalesce(new.note,'') !~* 'подпис|signature'
    and coalesce(new.to_status,'') not in ('signed')
 then return new;end if;
 select p.signature_path into sig from public.game_profiles p
  where p.game_id=new.game_id and p.user_id=new.actor_id;
 if sig is null then return new;end if;
 insert into public.formal_document_signatures(document_id,game_id,history_id,signer_id,signature_path,signed_at)
 values(new.document_id,new.game_id,new.id,new.actor_id,sig,new.created_at)
 on conflict(history_id) do nothing;
 return new;
end;
$$;
drop trigger if exists capture_formal_signature on public.formal_document_history;
create trigger capture_formal_signature after insert on public.formal_document_history
 for each row execute function private.capture_formal_document_signature();

-- Only the account owner and the teacher can read the account's verified login email.
create table if not exists public.member_login_emails(
 game_id uuid not null,
 user_id uuid not null,
 email text not null check(length(email) between 5 and 254),
 verified_at timestamptz not null default now(),
 primary key(game_id,user_id),
 foreign key(game_id,user_id) references public.game_members(game_id,user_id) on delete cascade
);
alter table public.member_login_emails enable row level security;
drop policy if exists login_email_read on public.member_login_emails;
create policy login_email_read on public.member_login_emails for select to authenticated
 using(user_id=(select auth.uid()) or private.is_game_teacher(game_id));
drop policy if exists login_email_self_insert on public.member_login_emails;
create policy login_email_self_insert on public.member_login_emails for insert to authenticated
 with check(user_id=(select auth.uid()) and private.is_game_member(game_id)
 and lower(email)=(select lower(auth.jwt()->>'email'))
 and coalesce((select (auth.jwt()->>'is_anonymous')::boolean),false)=false);
drop policy if exists login_email_self_update on public.member_login_emails;
create policy login_email_self_update on public.member_login_emails for update to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid())
 and lower(email)=(select lower(auth.jwt()->>'email'))
 and coalesce((select (auth.jwt()->>'is_anonymous')::boolean),false)=false);
revoke all on public.member_login_emails from public,anon;
grant select,insert,update on public.member_login_emails to authenticated;

create or replace function public.resume_member_game(p_game_code text)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_id uuid;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,true)
 then raise exception 'Sign in with your verified email and password';end if;
 select g.id into v_id from public.games g join public.game_members m on m.game_id=g.id
  where g.game_code=upper(trim(p_game_code)) and m.user_id=auth.uid() limit 1;
 if v_id is null then raise exception 'Your account is not a member of this game';end if;
 return v_id;
end;
$$;
revoke all on function public.resume_member_game(text) from public,anon;
grant execute on function public.resume_member_game(text) to authenticated;
