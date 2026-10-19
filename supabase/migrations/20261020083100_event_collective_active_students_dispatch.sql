-- ГОС.ID: аудитория all означает всех действующих участников, не только должностных лиц.
-- Адресные и региональные ситуации продолжают проверять необходимые полномочия.
-- Запрет назначения архивным студентам действует для всех вариантов.
DO $patch$
DECLARE v_def text;
v_role_anchor text:=E'and (c.region_code is not null or\n          exists(select 1 from unnest(c.allowed_roles) ar';
v_member_anchor text:='where gm.game_id=p_game and gm.kind=''student''';
BEGIN
 v_def:=pg_get_functiondef('private.run_game_autopilot(uuid)'::regprocedure);
 IF position('c.destination=''federal_collective'' or' IN v_def)>0
   AND position('gm.roster_archived_at is null' IN v_def)>0 THEN RETURN; END IF;
 IF position(v_role_anchor IN v_def)=0 OR position(v_member_anchor IN v_def)=0
  OR position('duma_not_elected' IN v_def)=0
  OR position('if c.destination=''federal_collective'' and n<2' IN v_def)=0
  OR position('ea.status=''pending''' IN v_def)=0
 THEN RAISE EXCEPTION 'Условия коллективной выдачи изменены, требуется сверка'; END IF;
 v_def:=replace(v_def,v_role_anchor,
   E'and (c.region_code is not null or\n          c.destination=''federal_collective'' or\n          exists(select 1 from unnest(c.allowed_roles) ar');
 v_def:=replace(v_def,v_member_anchor,
   v_member_anchor||E'\n      and gm.roster_archived_at is null');
 IF position('c.destination=''federal_collective'' or' IN v_def)=0
  OR position('gm.roster_archived_at is null' IN v_def)=0
 THEN RAISE EXCEPTION 'Не удалось применить коллективную маршрутизацию'; END IF;
 EXECUTE v_def;
END;
$patch$;
