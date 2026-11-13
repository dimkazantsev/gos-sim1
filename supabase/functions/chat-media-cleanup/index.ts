// ГОС.ID: daily server-only cleanup for chat, including Storage bytes.
// Single authenticated Edge call; never delete storage.objects using SQL.
import { createClient } from "npm:@supabase/supabase-js@2";

type Candidate = { storage_path: string; message_id: string | null };
const MAX_ROUNDS = 8;
const STORAGE_BATCH = 250;
const DB_BATCH = 500;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({error:"Способ запроса не поддерживается"},405);
  const token = request.headers.get("x-chat-cleanup-token");
  if (!token || token.length < 32) return json({error:"Требуется авторизация"},401);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({error:"Сервер не настроен"},503);
  const db = createClient(url, serviceKey, {auth:{persistSession:false,autoRefreshToken:false}});
  const auth = await db.rpc("chat_media_cleanup_token_valid",{p_token:token});
  if (auth.error || auth.data !== true) return json({error:"Требуется авторизация"},401);

  let removedFiles=0, removedMessages=0, failed=0, morePossible=false;
  // One Storage API bulk call per batch, instead of one request per file.
  for(let i=0;i<MAX_ROUNDS;i++){
    const candidates=await db.rpc("chat_media_expired_candidates",{p_limit:STORAGE_BATCH});
    if(candidates.error) return json({error:"Ошибка выборки файлов",removedFiles,removedMessages},500);
    const rows=(candidates.data??[]) as Candidate[];
    const paths=[...new Set(rows.map(x=>x.storage_path).filter(Boolean))];
    if(!paths.length)break;
    try{
      const result=await db.storage.from("game-media").remove(paths);
      if(result.error){failed++;break;} // No retry storm on HTTP 402/403/5xx.
      removedFiles+=paths.length;
    }catch{failed++;break;}
    if(i===MAX_ROUNDS-1)morePossible=true;
  }
  // Bounded, oldest-first deletion after Storage bytes are absent.
  for(let i=0;i<MAX_ROUNDS;i++){
    const done=await db.rpc("chat_media_finalize_expired");
    if(done.error)return json({error:"Ошибка удаления сообщений",removedFiles,removedMessages,failed},500);
    const n=Number(done.data??0);
    removedMessages+=n;
    if(n<DB_BATCH)break;
    if(i===MAX_ROUNDS-1)morePossible=true;
  }
  return json({ok:failed===0,removedFiles,removedMessages,failed,morePossible,retentionDays:30},failed?207:200);
});
