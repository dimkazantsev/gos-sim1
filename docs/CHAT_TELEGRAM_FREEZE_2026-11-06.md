# ГОС.ID · временная пауза чата и Telegram (06.11.2026)

## Причина
Пиковая нагрузка 06.11.2026: 1 217 обращений к Supabase за 3 минуты, из них 208 с серверным User-Agent node; неоднократные тайм-ауты PostgreSQL (57014). Эти значения относятся к конкретному измеренному интервалу и не доказывают нагрузку от 100 участников.

## Режим паузы
- `lib/featureFreeze.ts`: `CHAT_PAUSED` и `TELEGRAM_PAUSED` равны `true`.
- Игра сохраняет авторизацию, основной игровой Realtime, права и роли, голосования, документы и этапы.
- Кнопки чата остаются видимыми, но недоступными, без запуска `ChatPanel`. Загрузка истории, уведомлений, отметок прочтения и подписки на таблицы чата в игре отключены. Экскурсия пропускает шаг чата.
- Telegram webhook подтверждает обновления без обращения в БД; dispatcher возвращает `paused` без выборки и обработки очереди. Клиент не инициирует отправку.
- **В рабочей БД вручную отключены 9 ТОЛЬКО Telegram-триггеров.** Это не миграция: повторная установка среды должна учитывать состояние.

## Обратное включение (только после тестов)
1. Вернуть `CHAT_PAUSED=false` и `TELEGRAM_PAUSED=false` в коде, проверить работу клиента, API и лимиты.
2. Проверить очередь `public.telegram_outbox` перед разблокировкой — не отправлять устаревшие сообщения одним потоком.
3. Восстановить конкретные триггеры:
```sql
ALTER TABLE public.chat_mentions ENABLE TRIGGER gos_chat_mention_notify;
ALTER TABLE public.chat_messages ENABLE TRIGGER telegram_chat_enqueue;
ALTER TABLE public.event_assignments ENABLE TRIGGER telegram_assignment_enqueue;
ALTER TABLE public.formal_documents ENABLE TRIGGER telegram_document_enqueue;
ALTER TABLE public.game_assigned_tasks ENABLE TRIGGER gos_task_notify;
ALTER TABLE public.game_events ENABLE TRIGGER telegram_event_enqueue;
ALTER TABLE public.game_stages ENABLE TRIGGER telegram_stage_enqueue;
ALTER TABLE public.game_votes ENABLE TRIGGER telegram_vote_enqueue;
ALTER TABLE public.telegram_outbox ENABLE TRIGGER gos_id_telegram_outbox_wake;
```
4. Проверить уровень запросов/ошибок до и после, протестировать один канал, один голос и вход нескольких игроков.

Не удалять переписку, Telegram-привязки и игровые документы. Обратная совместимость клиентов со старой сборкой не гарантирована: при проверках обновлять страницу.

## Облегчение фоновых операций 11 ноября 2026 года
- Пока `TELEGRAM_PAUSED = true` и нет ожидающих отправки уведомлений, планировщик `gos_id_telegram_dispatch` переводится в неактивное состояние с помощью `cron.alter_job(jobid,active=>false)`. Само задание, его график и очередь не удаляются.
- Для восстановления Telegram сначала проверить очередь и 9 ранее отключённых триггеров, затем восстановить планировщик через `SELECT cron.alter_job(jobid,active=>true) FROM cron.job WHERE jobname='gos_id_telegram_dispatch';`.
- Политические публикации теперь передают через существующий приватный игровой канал только `{table: 'political_posts'}`. Контент загружается в разделе «Политический процесс» с прежними RLS-правами.
