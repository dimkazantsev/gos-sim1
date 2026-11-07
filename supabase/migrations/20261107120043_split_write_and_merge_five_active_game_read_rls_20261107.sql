-- GOС.ID 2026-11-07: preserve all effective RLS predicates while removing overlapping SELECT policy evaluation.
-- Authorization remains the logical OR of the old SELECT and ALL policies;
-- INSERT, UPDATE and DELETE retain EXACT previous ALL USING / WITH CHECK expressions.
-- Zero data change; preserving RESTRICTIVE policies, grants, ownership and existing private channel security.
-- Abort the migration atomically if any existing policy has changed, even whitespace/casing.
DO $preflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='channel_members' AND policyname='channel_members_teacher_all' AND cmd='ALL' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(EXISTS ( SELECT 1
   FROM chat_channels c
  WHERE ((c.id = channel_members.channel_id) AND private.is_game_teacher(c.game_id))))' AND with_check IS NOT DISTINCT FROM '(EXISTS ( SELECT 1
   FROM chat_channels c
  WHERE ((c.id = channel_members.channel_id) AND private.is_game_teacher(c.game_id))))') THEN RAISE EXCEPTION 'RLS changed: channel_members.channel_members_teacher_all'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='channel_members' AND policyname='channel_members_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.can_access_channel(channel_id)' AND with_check IS NOT DISTINCT FROM NULL) THEN RAISE EXCEPTION 'RLS changed: channel_members.channel_members_read'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_channels' AND policyname='channels_teacher_all' AND cmd='ALL' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_teacher(game_id)' AND with_check IS NOT DISTINCT FROM 'private.is_game_teacher(game_id)') THEN RAISE EXCEPTION 'RLS changed: chat_channels.channels_teacher_all'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='chat_channels' AND policyname='channels_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.can_access_channel(id)' AND with_check IS NOT DISTINCT FROM NULL) THEN RAISE EXCEPTION 'RLS changed: chat_channels.channels_read'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='missions' AND policyname='missions_teacher_all' AND cmd='ALL' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_teacher(game_id)' AND with_check IS NOT DISTINCT FROM 'private.is_game_teacher(game_id)') THEN RAISE EXCEPTION 'RLS changed: missions.missions_teacher_all'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='missions' AND policyname='missions_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_member(game_id)' AND with_check IS NOT DISTINCT FROM NULL) THEN RAISE EXCEPTION 'RLS changed: missions.missions_read'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='political_post_formal_links' AND policyname='post_formal_links_write' AND cmd='ALL' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='(private.is_game_teacher(game_id) OR (created_by = ( SELECT auth.uid() AS uid)))' AND with_check IS NOT DISTINCT FROM '(private.is_game_member(game_id) AND (created_by = ( SELECT auth.uid() AS uid)))') THEN RAISE EXCEPTION 'RLS changed: political_post_formal_links.post_formal_links_write'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='political_post_formal_links' AND policyname='post_formal_links_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_member(game_id)' AND with_check IS NOT DISTINCT FROM NULL) THEN RAISE EXCEPTION 'RLS changed: political_post_formal_links.post_formal_links_read'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rounds' AND policyname='rounds_teacher_all' AND cmd='ALL' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_teacher(game_id)' AND with_check IS NOT DISTINCT FROM 'private.is_game_teacher(game_id)') THEN RAISE EXCEPTION 'RLS changed: rounds.rounds_teacher_all'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rounds' AND policyname='rounds_read' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles='{authenticated}' AND qual='private.is_game_member(game_id)' AND with_check IS NOT DISTINCT FROM NULL) THEN RAISE EXCEPTION 'RLS changed: rounds.rounds_read'; END IF;
END $preflight$;

-- channel_members: old read authorization was (channel_members_read) OR (channel_members_teacher_all).
CREATE POLICY "gos_perf_rls_channel_members_insert" ON public."channel_members" FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM chat_channels c
  WHERE ((c.id = channel_members.channel_id) AND private.is_game_teacher(c.game_id)))));
CREATE POLICY "gos_perf_rls_channel_members_update" ON public."channel_members" FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM chat_channels c
  WHERE ((c.id = channel_members.channel_id) AND private.is_game_teacher(c.game_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM chat_channels c
  WHERE ((c.id = channel_members.channel_id) AND private.is_game_teacher(c.game_id)))));
CREATE POLICY "gos_perf_rls_channel_members_delete" ON public."channel_members" FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM chat_channels c
  WHERE ((c.id = channel_members.channel_id) AND private.is_game_teacher(c.game_id)))));
ALTER POLICY "channel_members_read" ON public."channel_members" USING ((private.can_access_channel(channel_id)) OR ((EXISTS ( SELECT 1
   FROM chat_channels c
  WHERE ((c.id = channel_members.channel_id) AND private.is_game_teacher(c.game_id))))));
DROP POLICY "channel_members_teacher_all" ON public."channel_members";

-- chat_channels: old read authorization was (channels_read) OR (channels_teacher_all).
CREATE POLICY "gos_perf_rls_chat_channels_insert" ON public."chat_channels" FOR INSERT TO authenticated WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "gos_perf_rls_chat_channels_update" ON public."chat_channels" FOR UPDATE TO authenticated USING (private.is_game_teacher(game_id)) WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "gos_perf_rls_chat_channels_delete" ON public."chat_channels" FOR DELETE TO authenticated USING (private.is_game_teacher(game_id));
ALTER POLICY "channels_read" ON public."chat_channels" USING ((private.can_access_channel(id)) OR (private.is_game_teacher(game_id)));
DROP POLICY "channels_teacher_all" ON public."chat_channels";

-- missions: old read authorization was (missions_read) OR (missions_teacher_all).
CREATE POLICY "gos_perf_rls_missions_insert" ON public."missions" FOR INSERT TO authenticated WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "gos_perf_rls_missions_update" ON public."missions" FOR UPDATE TO authenticated USING (private.is_game_teacher(game_id)) WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "gos_perf_rls_missions_delete" ON public."missions" FOR DELETE TO authenticated USING (private.is_game_teacher(game_id));
ALTER POLICY "missions_read" ON public."missions" USING ((private.is_game_member(game_id)) OR (private.is_game_teacher(game_id)));
DROP POLICY "missions_teacher_all" ON public."missions";

-- political_post_formal_links: old read authorization was (post_formal_links_read) OR (post_formal_links_write).
CREATE POLICY "gos_perf_rls_political_post_formal_links_insert" ON public."political_post_formal_links" FOR INSERT TO authenticated WITH CHECK ((private.is_game_member(game_id) AND (created_by = ( SELECT auth.uid() AS uid))));
CREATE POLICY "gos_perf_rls_political_post_formal_links_update" ON public."political_post_formal_links" FOR UPDATE TO authenticated USING ((private.is_game_teacher(game_id) OR (created_by = ( SELECT auth.uid() AS uid)))) WITH CHECK ((private.is_game_member(game_id) AND (created_by = ( SELECT auth.uid() AS uid))));
CREATE POLICY "gos_perf_rls_political_post_formal_links_delete" ON public."political_post_formal_links" FOR DELETE TO authenticated USING ((private.is_game_teacher(game_id) OR (created_by = ( SELECT auth.uid() AS uid))));
ALTER POLICY "post_formal_links_read" ON public."political_post_formal_links" USING ((private.is_game_member(game_id)) OR ((private.is_game_teacher(game_id) OR (created_by = ( SELECT auth.uid() AS uid)))));
DROP POLICY "post_formal_links_write" ON public."political_post_formal_links";

-- rounds: old read authorization was (rounds_read) OR (rounds_teacher_all).
CREATE POLICY "gos_perf_rls_rounds_insert" ON public."rounds" FOR INSERT TO authenticated WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "gos_perf_rls_rounds_update" ON public."rounds" FOR UPDATE TO authenticated USING (private.is_game_teacher(game_id)) WITH CHECK (private.is_game_teacher(game_id));
CREATE POLICY "gos_perf_rls_rounds_delete" ON public."rounds" FOR DELETE TO authenticated USING (private.is_game_teacher(game_id));
ALTER POLICY "rounds_read" ON public."rounds" USING ((private.is_game_member(game_id)) OR (private.is_game_teacher(game_id)));
DROP POLICY "rounds_teacher_all" ON public."rounds";