-- ГОС.ID: PR #256 uses committee_mandate_allocations as the single authoritative
-- distribution ledger. The earlier experimental allocator used
-- institution_assignments.mandates_allocated and is not part of the published UI.
-- Keep the existing data and code for recovery/forensics, but forbid clients
-- to mutate the stale ledger. The canonical set_committee_mandates remains granted.
REVOKE ALL ON FUNCTION public.allocate_committee_mandates(uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated;

DO $safety$
BEGIN
  IF to_regprocedure('public.set_committee_mandates(uuid,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Canonical committee mandate RPC missing; refusing safety migration';
  END IF;
END;
$safety$;

-- The experimental schema also replaced the all-kind UNIQUE constraint with a
-- ministry-only partial unique index. Keep existing one-ministry semantics for
-- the otherwise unaffected staffing RPC; committees remain excluded above.
CREATE OR REPLACE FUNCTION public.assign_institution_member(p_unit_id uuid, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare u public.institution_units%rowtype;v_uid uuid:=(select auth.uid());v_party uuid;v_target_party uuid;v_role text;v_id uuid;
begin
 select * into u from public.institution_units where id=p_unit_id for update;
 if u.id is null then raise exception 'Institution unit not found'; end if;
 if u.unit_kind='committee' then raise exception 'Для комитетов используйте распределение депутатских мандатов';end if;
 if v_uid is null or not private.is_game_member(u.game_id) or private.is_game_observer(u.game_id) then raise exception 'Game participant access required';end if;
 if not exists(select 1 from public.game_members where game_id=u.game_id and user_id=p_user_id and kind='student' and roster_archived_at is null) then raise exception 'Student not found in this game'; end if;

 if u.unit_kind='committee' then
   if u.head_user_id is null then raise exception 'Сначала изберите председателя комитета';end if;
   if not exists(select 1 from public.party_member_mandates where game_id=u.game_id and user_id=p_user_id and base_mandates>0) then raise exception 'Участник не получил депутатских мандатов';end if;
   v_party:=private.member_party_id(u.game_id,v_uid);
   v_target_party:=private.member_party_id(u.game_id,p_user_id);
   if not private.is_game_teacher(u.game_id) then
     if v_uid is distinct from u.head_user_id and (v_party is null or not exists(select 1 from public.game_parties where id=v_party and leader_user_id=v_uid)) then raise exception 'Полномочия председателя комитета или руководителя фракции отсутствуют';end if;
     if v_uid is distinct from u.head_user_id and v_target_party is distinct from v_party then raise exception 'Руководитель фракции назначает только участников своей фракции';end if;
   end if;
   if v_target_party is null then raise exception 'Committee member must belong to a parliamentary faction'; end if;
 else
   v_role:=private.game_role(u.game_id,v_uid);
   if not private.is_game_teacher(u.game_id)
      and v_uid is distinct from u.head_user_id
      and v_role not like '%председател%правительств%'
   then raise exception 'Minister / Prime Minister / teacher access required'; end if;
   v_target_party:=null;
 end if;

 insert into public.institution_assignments(game_id,unit_id,unit_kind,user_id,party_id,created_by)
 values(u.game_id,u.id,u.unit_kind,p_user_id,v_target_party,v_uid)
 on conflict(game_id,user_id) where unit_kind='ministry' do update
 set unit_id=excluded.unit_id,party_id=excluded.party_id,created_by=v_uid,created_at=now()
 returning id into v_id;
 return v_id;
end;$function$;
