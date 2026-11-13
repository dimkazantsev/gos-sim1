/* Isolated PGlite regression: no production data, no Storage API calls. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261114010000_chat_30day_retention.sql','utf8');
const edge=fs.readFileSync('supabase/functions/chat-media-cleanup/index.ts','utf8');
const panel=fs.readFileSync('components/game/ChatPanel.tsx','utf8');
const vercel=JSON.parse(fs.readFileSync('vercel.json','utf8'));
const fallback=fs.readFileSync('app/api/maintenance/chat-media/route.ts','utf8');
assert(!migration.includes('DELETE FROM storage.objects'),'Do not delete Storage files using SQL');
assert(migration.includes("cron.unschedule('gos_chat_media_cleanup_1m')"));
assert(migration.includes("'gos_chat_retention_30d_daily','0 3 * * *'"),'Daily, not per-minute polling');
assert(!vercel.crons.some(j=>j.path.includes('chat-media')),'No redundant Vercel cleanup');
assert(edge.includes('.storage.from("game-media").remove(paths)'),'Bulk Storage API deletion');
assert(edge.includes('MAX_ROUNDS = 8')&&edge.includes('STORAGE_BATCH = 250'));
assert(!edge.includes('.map(async (item)'),'No per-file Storage calls');
assert(edge.includes('chat_media_cleanup_token_valid'),'Require existing Vault-backed token');
assert(panel.includes('30*24*60*60*1000')&&!panel.includes('window.setInterval(()=>setRetentionClock(Date.now()),15000)'));
assert(fallback.includes("const RETENTION_DAYS=30")&&fallback.includes("['file','audio','video']"));
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const path=(game,channel,user,id)=>[game,channel,user,id+'.png'].join('/');
(async()=>{
const db=new PGlite();
try{
 await db.exec([
 'CREATE SCHEMA private','CREATE SCHEMA storage','CREATE ROLE anon','CREATE ROLE authenticated','CREATE ROLE service_role',
 'CREATE TABLE public.chat_messages(id uuid PRIMARY KEY,kind text,created_at timestamptz NOT NULL,storage_path text)',
 'CREATE TABLE storage.objects(bucket_id text NOT NULL,name text NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(bucket_id,name))',
 'CREATE TABLE private.gd_council_chat_document_delivery(game_id uuid NOT NULL,document_id uuid NOT NULL,message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,PRIMARY KEY(game_id,document_id))',
 'CREATE TABLE public.chat_pins(message_id uuid REFERENCES public.chat_messages(id) ON DELETE CASCADE)',
 'CREATE TABLE public.chat_mentions(message_id uuid REFERENCES public.chat_messages(id) ON DELETE CASCADE)',
 'ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY',
 'CREATE POLICY messages_read ON public.chat_messages FOR SELECT TO authenticated USING (true)',
 "CREATE POLICY chat_media_one_hour_visibility ON public.chat_messages AS RESTRICTIVE FOR SELECT TO authenticated USING (kind NOT IN ('audio','video') OR created_at > now()-interval '1 hour')"
 ].join(';\n')+';');
 const game=uid(1),channel=uid(2),user=uid(3),oldFile=path(game,channel,user,uid(4)),newFile=path(game,channel,user,uid(5));
 const orphan=path(game,channel,user,uid(6)),oldVoice=path(game,channel,user,uid(7));
 const invalid='../../other-asset',shared=path(game,channel,user,uid(8));
 const rows=[
 [uid(11),'text',null,31],[uid(12),'file',oldFile,31],[uid(13),'file',newFile,1],
 [uid(14),'system',null,31],[uid(15),'audio',oldVoice,31],
 [uid(16),'file',shared,31],[uid(17),'file',shared,1],[uid(18),'video',null,1]
 ];
 for(const [id,kind,storage_path,days] of rows)
  await db.query("INSERT INTO public.chat_messages(id,kind,storage_path,created_at) VALUES($1,$2,$3,now()-$4::int*interval '1 day')",[id,kind,storage_path,days]);
 for(const [name,days] of [[oldFile,31],[newFile,1],[orphan,31],[oldVoice,31],[invalid,31],[shared,31]])
  await db.query("INSERT INTO storage.objects(bucket_id,name,created_at) VALUES('game-media',$1,now()-$2::int*interval '1 day')",[name,days]);
 await db.query('INSERT INTO private.gd_council_chat_document_delivery(game_id,document_id,message_id) VALUES($1,$2,$3)',[game,uid(20),uid(14)]);
 await db.query('INSERT INTO public.chat_pins(message_id) VALUES($1)',[uid(11)]);
 await db.query('INSERT INTO public.chat_mentions(message_id) VALUES($1)',[uid(11)]);
 await db.exec(migration);
 let res=await db.query('SELECT * FROM public.chat_media_expired_candidates($1)',[100]);
 const candidatePaths=res.rows.map(r=>r.storage_path);
 assert.equal(candidatePaths.length,3,'Old file, old audio and orphan are candidates');
 assert(candidatePaths.includes(oldFile)&&candidatePaths.includes(oldVoice)&&candidatePaths.includes(orphan));
 assert(!candidatePaths.includes(shared),'Do not delete files still referenced by a fresh chat message');
 assert(!candidatePaths.includes(newFile)&&!candidatePaths.includes(invalid));
 const purge1=await db.query('SELECT public.chat_media_finalize_expired() n');
 assert.equal(Number(purge1.rows[0].n),2,'Only old text and system messages can be purged before file removal');
 assert.equal((await db.query('SELECT count(*) n FROM public.chat_pins')).rows[0].n,0,'Pin cascade');
 assert.equal((await db.query('SELECT count(*) n FROM public.chat_mentions')).rows[0].n,0,'Mention cascade');
 const receipt=(await db.query('SELECT * FROM private.gd_council_chat_document_delivery')).rows[0];
 assert.equal(receipt.message_id,null,'Dedup receipt is preserved, chat message link cleared');
 await db.query("DELETE FROM storage.objects WHERE bucket_id='game-media' AND name=ANY($1::text[])",[[oldFile,oldVoice,orphan]]);
 const purge2=await db.query('SELECT public.chat_media_finalize_expired() n');
 assert.equal(Number(purge2.rows[0].n),2,'Expired file and audio messages purged only after bytes gone');
 res=await db.query('SELECT id FROM public.chat_messages ORDER BY id');
 assert.deepEqual(res.rows.map(x=>x.id).sort(),[uid(13),uid(16),uid(17),uid(18)].sort());
 // The recent text, video and one current file remain; a shared-path old
 // message stays while the file still serves the current message.
 assert.equal((await db.query('SELECT count(*) n FROM public.chat_messages')).rows[0].n,4);
 assert((await db.query('SELECT count(*) n FROM storage.objects WHERE name=$1',[shared])).rows[0].n===1);
 const rls=(await db.query("SELECT qual FROM pg_policies WHERE policyname='chat_messages_30day_visibility'")).rows;
 assert.equal(rls.length,1);
 assert(rls[0].qual.includes("30 days"));
 console.log('PASS retention: 30 days, old messages, Storage first, path isolation, fresh ref safety, pinned/mention cascade, preserved document receipt, no extra cron');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
