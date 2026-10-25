-- Reinterpret only the initial legacy "all 225" GD registration made
-- while the party calculator had not been linked to deputy capacities.
-- A personal later correction retains its explicit attendance unchanged.
CREATE TABLE IF NOT EXISTS private.legacy_gd_attendance_corrections(
 game_id uuid NOT NULL,
 stage_no integer NOT NULL,
 user_id uuid NOT NULL,
 former_present integer NOT NULL,
 original_presence_updated_at timestamptz,
 corrected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(game_id,stage_no,user_id)
);
REVOKE ALL ON private.legacy_gd_attendance_corrections FROM PUBLIC,anon,authenticated;

INSERT INTO private.legacy_gd_attendance_corrections(
 game_id,stage_no,user_id,former_present,original_presence_updated_at
)
SELECT r.game_id,r.stage_no,r.user_id,r.present_mandates,r.presence_updated_at
FROM public.institution_session_registrations r
WHERE r.institution_key='gd'
 AND r.present_mandates IS NOT NULL
 AND r.presence_updated_at=r.registered_at
 AND r.present_mandates<>private.gd_member_capacity(r.game_id,r.user_id)
 AND r.present_mandates=(
  SELECT (450/count(*))::integer
  FROM public.game_members m
  WHERE m.game_id=r.game_id AND m.kind='student' AND m.roster_archived_at IS NULL
 )
 AND EXISTS(
  SELECT 1 FROM public.electoral_calculator_results e
  WHERE e.game_id=r.game_id AND e.published
 )
ON CONFLICT(game_id,stage_no,user_id) DO NOTHING;

UPDATE public.institution_session_registrations r
SET present_mandates=NULL,presence_updated_at=NULL
FROM private.legacy_gd_attendance_corrections c
WHERE r.game_id=c.game_id AND r.stage_no=c.stage_no AND r.user_id=c.user_id
 AND r.institution_key='gd'
 AND r.present_mandates=c.former_present
 AND r.presence_updated_at=c.original_presence_updated_at;
