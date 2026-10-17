// ГОС.ID — scheduled, server-only audio/video cleanup.
 // The secret is generated in Vault by the matching database migration.
 // Storage API removes object bytes; a DB RPC then removes expired messages.
import { createClient } from "npm:@supabase/supabase-js@2";

type Candidate = { storage_path: string; message_id: string | null };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error:"Способ запроса не поддерживается" }, 405);
  const token = request.headers.get("x-chat-cleanup-token");
  if (!token || token.length < 32) return json({ error:"Требуется вход в систему" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error:"Сервер не настроен" }, 503);

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authorization = await db.rpc("chat_media_cleanup_token_valid", { p_token: token });
  if (authorization.error || authorization.data !== true) return json({ error:"Требуется вход в систему" }, 401);

  const candidates = await db.rpc("chat_media_expired_candidates", { p_limit: 100 });
  if (candidates.error) return json({ error:"Не удалось получить список устаревших файлов" }, 500);
  const rows = (candidates.data ?? []) as Candidate[];
  let deleted = 0;
  let failed = 0;

  // Small bounded batches: no direct SQL deletes against storage.objects.
  for (let offset = 0; offset < rows.length; offset += 5) {
    const batch = rows.slice(offset, offset + 5);
    await Promise.all(batch.map(async (item) => {
      if (!item.storage_path) return;
      try {
        const result = await db.storage.from("game-media").remove([item.storage_path]);
        if (result.error) failed++;
        else deleted++;
      } catch {
        failed++;
      }
    }));
  }

  // Only records with no remaining Storage object may be removed.
  const finalized = await db.rpc("chat_media_finalize_expired");
  if (finalized.error) return json({ error:"Файлы удалены, но не удалось очистить сообщения", deleted, failed }, 500);

  return json({ deleted, failed, finalized: Number(finalized.data ?? 0) }, failed ? 207 : 200);
});
