-- Fix the Stage 8 President approval: a president_decree uses the president_act workflow.
-- Restore no data and do not change authority, status transitions or document step 2.
-- Source: currently deployed public.review_government_structure (21 October 2026).
CREATE OR REPLACE FUNCTION public.review_government_structure(p_game_id uuid, p_action text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
 v_uid uuid:=(select auth.uid());
 v_role text;
 s public.government_structures%rowtype;
 v_doc uuid;
 v_body text;
begin
 v_role:=private.game_role(p_game_id,v_uid);
 if not private.is_game_teacher(p_game_id) and v_role not like '%президент%' then raise exception 'President / teacher access required'; end if;
 if p_action not in ('approve','revision') then raise exception 'Unsupported structure decision'; end if;
 select * into s from public.government_structures where game_id=p_game_id and status='submitted' for update;
 if s.game_id is null then raise exception 'Submitted structure not found'; end if;

 update public.government_structures
 set status=case when p_action='approve' then 'approved' else 'revision' end,
     note=nullif(trim(coalesce(p_note,'')),''),
     reviewed_by=v_uid,reviewed_at=now(),updated_at=now()
 where game_id=p_game_id;

 if p_action='approve' then
  update public.institution_units u
  set title=case u.unit_key
    when 'social' then s.social_title when 'economic' then s.economic_title when 'defence' then s.defence_title
    when 'foreign' then s.foreign_title when 'internal' then s.internal_title else u.title end
  where u.game_id=p_game_id and u.unit_kind='ministry';

  if s.formal_document_id is null then
   v_body:='УКАЗ ПРЕЗИДЕНТА РОССИЙСКОЙ ФЕДЕРАЦИИ'
    ||E'\n\nОб утверждении структуры Правительства Российской Федерации'
    ||E'\n\nУтвердить структуру Правительства Российской Федерации в составе пяти министерств:'
    ||E'\n1. '||s.social_title
    ||E'\n2. '||s.economic_title
    ||E'\n3. '||s.foreign_title
    ||E'\n4. '||s.defence_title
    ||E'\n5. '||s.internal_title||'.';
   v_doc:=private.stage8_create_formal_document(
    p_game_id,'Об утверждении структуры Правительства Российской Федерации',
    'president_decree','president','Президент Российской Федерации',
    v_body,'president_act',2,
    jsonb_build_object('purpose','government_structure','five_ministries',true)
   );
   update public.government_structures set formal_document_id=v_doc where game_id=p_game_id;
  end if;
 end if;
end;
$function$

