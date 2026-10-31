-- ГОС.ID · Безопасная диагностика PostgreSQL / Realtime.
-- Только SELECT. Не завершает соединения, не меняет публикации/слоты и не сбрасывает статистику.
-- Запускать адресно при инциденте и один раз после восстановления; не запускать по таймеру.
-- pg_stat_activity и pg_replication_slots — моментальные срезы;
-- pg_stat_statements и pg_stat_database — накопленные данные, не показатели за минуту.
-- Не выводить SQL-тексты пользователя, JWT и параметры запросов.

SELECT now() AS observed_at,
       pg_postmaster_start_time() AS server_started_at,
       pg_size_pretty(pg_database_size(current_database())) AS database_size;

SELECT coalesce(state, 'n/a') AS state,
       coalesce(wait_event_type, 'none') AS wait_type,
       coalesce(wait_event, 'none') AS wait_event,
       count(*) AS sessions
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY 1,2,3 ORDER BY sessions DESC;

SELECT a.pid AS waiting_pid,
       a.wait_event_type, a.wait_event,
       cardinality(pg_blocking_pids(a.pid)) AS blocker_count,
       round(extract(epoch FROM now()-a.query_start)::numeric,1) AS waiting_seconds
FROM pg_stat_activity a
WHERE a.datname=current_database()
  AND cardinality(pg_blocking_pids(a.pid))>0
ORDER BY waiting_seconds DESC LIMIT 20;

SELECT count(*) FILTER (WHERE state='idle in transaction') AS idle_in_transaction,
       count(*) FILTER (WHERE xact_start IS NOT NULL
                           AND now()-xact_start > interval '10 seconds') AS long_transactions,
       count(*) FILTER (WHERE wait_event_type='Lock') AS lock_waits
FROM pg_stat_activity WHERE datname=current_database();

SELECT slot_name, slot_type, plugin, active, wal_status,
       pg_size_pretty(greatest(pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn),0)::bigint) AS wal_retained,
       pg_size_pretty(greatest(pg_wal_lsn_diff(pg_current_wal_lsn(),confirmed_flush_lsn),0)::bigint) AS flush_lag
FROM pg_replication_slots
WHERE restart_lsn IS NOT NULL ORDER BY slot_name;

SELECT pubname, count(*) AS published_tables
FROM pg_publication_tables GROUP BY pubname ORDER BY pubname;

SELECT stats_reset, xact_commit, xact_rollback, deadlocks, temp_files,
       pg_size_pretty(temp_bytes) AS temp_bytes_cumulative
FROM pg_stat_database WHERE datname=current_database();

-- Normalized query text is intentionally NOT returned: identifiers only.
-- A high total time / call count does not prove the statement caused a specific incident.
SELECT queryid, calls,
       round(total_exec_time::numeric/1000,1) AS cumulative_seconds,
       round(mean_exec_time::numeric,1) AS average_ms,
       round(max_exec_time::numeric,1) AS worst_ms,
       temp_blks_written
FROM pg_stat_statements
WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
ORDER BY total_exec_time DESC LIMIT 15;
