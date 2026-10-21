-- Apply only after the new client is live on Vercel AND GitHub Pages.
-- Column-level privilege: the original table's RLS still filters rows;
-- non-privileged clients cannot select effect_plan even by direct REST query.
revoke select on public.event_cases from anon,authenticated;
revoke select(effect_plan) on public.event_cases from anon,authenticated;
grant select (id,game_id,case_key,title,situation,category,seriousness,audience,
 allowed_roles,decision_options,source_url,source_note,verified,status,created_by,
 created_at,comic_scene) on public.event_cases to authenticated,anon;
