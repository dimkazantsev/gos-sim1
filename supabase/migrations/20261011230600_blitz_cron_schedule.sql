-- 09:00 Moscow = 06:00 UTC; pg_cron installed in this Supabase project.
select cron.schedule('blitz_daily_0900_moscow','0 6 * * *','select public.blitz_issue_daily_all()');
