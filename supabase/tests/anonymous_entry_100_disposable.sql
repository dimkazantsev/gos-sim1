-- Disposable local-only Auth -> real JWT -> game join -> RLS identity fixture.
-- Never run on production. Must start with an EMPTY local auth.users table.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM auth.users LIMIT 1) THEN
  RAISE EXCEPTION 'This acceptance fixture requires empty disposable Auth';
 END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE TYPE public.member_kind AS ENUM ('student','teacher','observer');
CREATE TABLE public.games (
 id uuid PRIMARY KEY,game_code text NOT NULL UNIQUE,title text NOT NULL
);
CREATE TABLE public.invite_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 game_id uuid NOT NULL REFERENCES public.games(id),
 kind public.member_kind NOT NULL,
 active boolean NOT NULL DEFAULT true,code_hash text NOT NULL
);
CREATE TABLE public.game_members (
 game_id uuid NOT NULL REFERENCES public.games(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 full_name text NOT NULL,group_name text,kind public.member_kind NOT NULL,
 PRIMARY KEY(game_id,user_id)
);
CREATE TABLE public.qa_auth_entry_guard(marker text PRIMARY KEY);
INSERT INTO public.qa_auth_entry_guard(marker) VALUES ('DISPOSABLE-LOCAL-100-AUTH-BURST');
REVOKE ALL ON public.qa_auth_entry_guard FROM public,anon,authenticated;
GRANT SELECT ON public.qa_auth_entry_guard TO service_role;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_member_read ON public.game_members FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY own_game_read ON public.games FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=games.id AND m.user_id=auth.uid()));
GRANT SELECT ON public.games,public.game_members TO authenticated;
REVOKE ALL ON public.invite_codes FROM public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.join_game_as_role(
 p_game_code text,p_invite_code text,p_full_name text,p_group_name text,p_expected_kind public.member_kind
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_uid uuid := (SELECT auth.uid());v_game uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_expected_kind NOT IN ('student','observer') OR p_expected_kind IS NULL
  THEN RAISE EXCEPTION 'Role forbidden' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_full_name,'')))<2 THEN RAISE EXCEPTION 'Name required';END IF;
 SELECT g.id INTO v_game FROM public.games g JOIN public.invite_codes i ON i.game_id=g.id
 WHERE g.game_code=upper(btrim(p_game_code)) AND i.kind=p_expected_kind AND i.active
  AND i.code_hash=extensions.crypt(p_invite_code,i.code_hash) LIMIT 1;
 IF v_game IS NULL THEN RAISE EXCEPTION 'Invite denied' USING ERRCODE='42501';END IF;
 IF p_expected_kind='student' AND nullif(btrim(coalesce(p_group_name,'')),'') IS NULL
  THEN RAISE EXCEPTION 'Group required';END IF;
 IF EXISTS(SELECT 1 FROM public.game_members m WHERE m.game_id=v_game AND m.user_id=v_uid
  AND m.kind<>p_expected_kind) THEN RAISE EXCEPTION 'Cannot switch roles' USING ERRCODE='42501'; END IF;
 INSERT INTO public.game_members(game_id,user_id,full_name,group_name,kind)
 VALUES(v_game,v_uid,btrim(p_full_name),nullif(btrim(p_group_name),''),p_expected_kind)
 ON CONFLICT (game_id,user_id) DO NOTHING;
 RETURN v_game;
END $$;
CREATE OR REPLACE FUNCTION public.get_my_game_identity(p_game uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE u uuid := (SELECT auth.uid());m public.game_members%ROWTYPE;g public.games%ROWTYPE;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.game_members WHERE game_id=p_game AND user_id=u;
 IF NOT FOUND THEN RETURN jsonb_build_object('game',null,'member',null);END IF;
 SELECT * INTO g FROM public.games WHERE id=p_game;
 RETURN jsonb_build_object('game',to_jsonb(g),'member',to_jsonb(m));
END $$;
REVOKE ALL ON FUNCTION public.join_game_as_role(text,text,text,text,public.member_kind) FROM public,anon;
REVOKE ALL ON FUNCTION public.get_my_game_identity(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.join_game_as_role(text,text,text,text,public.member_kind) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_game_identity(uuid) TO authenticated;
INSERT INTO public.games(id,game_code,title) VALUES
 ('11111111-1111-4111-8111-111111111111','CLASSROOM-100','Local test classroom'),
 ('22222222-2222-4222-8222-222222222222','OTHER-CLASS','Other isolated classroom');
INSERT INTO public.invite_codes(game_id,kind,code_hash)
 VALUES('11111111-1111-4111-8111-111111111111','student',extensions.crypt('qa-student-entrance',extensions.gen_salt('bf',6))),
       ('11111111-1111-4111-8111-111111111111','observer',extensions.crypt('qa-guest-entrance',extensions.gen_salt('bf',6)));
NOTIFY pgrst,'reload schema';
