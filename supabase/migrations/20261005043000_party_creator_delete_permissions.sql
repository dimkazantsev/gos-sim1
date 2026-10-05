-- Party deletion permissions:
-- teacher at any time; recorded creator until registration is approved.

alter table public.game_parties
  add column if not exists created_by uuid;

create index if not exists game_parties_created_by_idx
  on public.game_parties(created_by);

revoke delete on table public.game_parties from authenticated;
drop policy if exists "guests_cannot_delete" on public.game_parties;

create or replace function private.can_delete_recent_party_asset(
  p_bucket text,
  p_path text,
  p_uid uuid
)
returns boolean
language sql
stable
security definer
set search_path = 'public','private','pg_temp'
as $$
  select exists(
    select 1
    from public.audit_log a
    where a.actor_id = p_uid
      and a.action = 'party_deleted'
      and a.created_at > now() - interval '15 minutes'
      and coalesce(a.payload->'assets','[]'::jsonb) @>
        jsonb_build_array(jsonb_build_object('bucket',p_bucket,'path',p_path))
  );
$$;

revoke all on function private.can_delete_recent_party_asset(text,text,uuid) from public;
grant execute on function private.can_delete_recent_party_asset(text,text,uuid) to authenticated;

drop policy if exists "game_assets_recent_party_delete" on storage.objects;
create policy "game_assets_recent_party_delete"
on storage.objects
for delete
to authenticated
using (
  private.can_delete_recent_party_asset(bucket_id,name,(select auth.uid()))
);

create or replace function public.delete_party_with_assets(p_party_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public','private','pg_temp'
as $function$
declare
  p public.game_parties%rowtype;
  v_uid uuid := (select auth.uid());
  v_teacher boolean;
  v_creator boolean;
  assets jsonb;
  posts uuid[];
  v_vote record;
  result jsonb;
begin
  select * into p
  from public.game_parties
  where id=p_party_id
  for update;

  if p.id is null or v_uid is null or not private.is_game_member(p.game_id) then
    raise exception 'Партия недоступна';
  end if;

  v_teacher := private.is_game_teacher(p.game_id);
  v_creator := p.created_by = v_uid;

  if not v_teacher and not (v_creator and p.registration_status <> 'registered') then
    raise exception 'Удалить партию может её создатель до регистрации или преподаватель';
  end if;

  if v_teacher then
    for v_vote in
      select id
      from public.game_votes
      where game_id=p.game_id
        and status='open'
        and voting_mode='mandate'
        and institution_key='gd'
      order by opened_at
    loop
      perform public.delete_procedural_vote(v_vote.id);
    end loop;
  elsif private.has_open_duma_mandate_vote(p.game_id) then
    raise exception 'Во время открытого голосования Государственной Думы удалить партию может только преподаватель';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('bucket','game-assets','path',path)),
    '[]'::jsonb
  ) into assets
  from (
    select storage_path path from public.party_documents where party_id=p.id
    union
    select logo_path from public.game_parties where id=p.id and logo_path is not null
    union
    select pm.storage_path
    from public.political_post_media pm
    join public.political_posts pp on pp.id=pm.post_id
    where pp.game_id=p.game_id and pp.actor_key='party' and pp.actor_label=p.name
  ) paths;

  select coalesce(array_agg(id),'{}'::uuid[]) into posts
  from public.political_posts
  where game_id=p.game_id and actor_key='party' and actor_label=p.name;

  update public.game_members
     set team=null,party_joined_at=null
   where game_id=p.game_id and team=p.name;

  update public.chat_channels
     set name='Архив фракции · '||p.name
   where game_id=p.game_id and name='Фракция · '||p.name;

  delete from public.political_posts where id=any(posts);
  delete from public.game_parties where id=p.id;

  insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
  values(
    p.game_id,
    v_uid,
    'party_deleted',
    'game_parties',
    jsonb_build_object(
      'party_name',p.name,
      'party_id',p.id,
      'deleted_posts',cardinality(posts),
      'assets',assets,
      'deleted_by_teacher',v_teacher
    )
  );

  result:=jsonb_build_object(
    'party_name',p.name,
    'deleted_posts',cardinality(posts),
    'assets',assets
  );
  return result;
end;
$function$;

revoke all on function public.delete_party_with_assets(uuid) from public;
revoke all on function public.delete_party_with_assets(uuid) from anon;
grant execute on function public.delete_party_with_assets(uuid) to authenticated;
