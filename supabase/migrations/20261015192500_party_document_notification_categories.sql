-- Preserve all existing Telegram outbox categories; add the party notification
-- categories already emitted by private.queue_party_notice().
-- Without this fix, the AFTER INSERT trigger rolls back party_documents inserts.
ALTER TABLE public.telegram_outbox
  DROP CONSTRAINT IF EXISTS telegram_outbox_category_check;
ALTER TABLE public.telegram_outbox
  ADD CONSTRAINT telegram_outbox_category_check
  CHECK (category = ANY (ARRAY[
    'chat','stage','vote','event','document','task','task_done',
    'mention_chat','mention_actions','mention_documents','document_delivery',
    'daily_brief','appeal','appeal_reply',
    'party_invite','party_registration','party_document','party_review'
  ]));
