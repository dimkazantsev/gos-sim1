-- Party regions piggyback on the existing RLS-scoped party projection.
-- No new client request, subscription, periodic worker, or persistent penalty rows.
create or replace function public.get_party_representation_projection(p_game_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
begin
 if auth.uid() is null or not private.is_game_member(p_game_id) then
  raise exception 'Нет доступа к игре.' using errcode='42501';
 end if;
 return jsonb_build_object(
  'invitations',coalesce((
   select jsonb_agg(to_jsonb(i) order by i.created_at desc)
   from public.party_invitations i where i.game_id=p_game_id
  ),'[]'::jsonb),
  'mandates',coalesce((
   select jsonb_agg(to_jsonb(m) order by m.party_id,m.user_id)
   from public.party_member_mandates m where m.game_id=p_game_id
  ),'[]'::jsonb),
  'agreements',coalesce((
   select jsonb_agg(to_jsonb(a) order by a.created_at desc)
   from public.party_agreements a where a.game_id=p_game_id
  ),'[]'::jsonb),
  'regions',coalesce((
   select jsonb_agg(
    jsonb_build_object('code',c.region_code,'name',coalesce(f.name,c.region_code),'party_id',c.party_id)
    order by c.region_code
   )
   from public.game_region_party_control c
   left join public.fiscal_region_reference f on f.code=c.region_code
   where c.game_id=p_game_id
  ),'[]'::jsonb)
 );
end;
$function$;
