import {createClient} from '@supabase/supabase-js';
import {NextResponse} from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const RETENTION_HOURS=24;
const BATCH=80;
/** Idempotent, admin-only retention: remove Storage object BEFORE its DB row. */
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;
 if(!secret||request.headers.get('authorization')!=='Bearer '+secret)return new Response('Unauthorized',{status:401});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return NextResponse.json({error:'Storage cleanup not configured'},{status:503});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const cutoff=new Date(Date.now()-RETENTION_HOURS*60*60*1000).toISOString();
 const {data, error}=await db.from('chat_messages').select('id,game_id,channel_id,author_id,storage_path,kind,created_at')
  .in('kind',['audio','video']).lt('created_at',cutoff).not('storage_path','is',null)
  .order('created_at',{ascending:true}).limit(BATCH);
 if(error){console.error('Expired media scan failed',error.code);return NextResponse.json({error:'Scan failed'},{status:500})}
 if(!data?.length)return NextResponse.json({ok:true,expired:0,removed:0,retention_hours:RETENTION_HOURS});
 // Reject unexpected paths; never remove arbitrary items via a privileged bucket API.
 const rows=data.filter(row=>{
  const p=(row.storage_path||'').split('/');
  return p.length===4&&p[0]===row.game_id&&p[1]===row.channel_id&&p[2]===row.author_id
   &&!!p[3]&&!p[3].includes('..');
 });
 if(rows.length!==data.length){
  console.error('Unexpected stored chat-media path format');
  return NextResponse.json({error:'Unsafe media path'},{status:500});
 }
 const paths=[...new Set(rows.map(r=>r.storage_path as string))];
 const removed=await db.storage.from('game-media').remove(paths);
 if(removed.error){
  console.error('Chat media Storage removal failed',removed.error.message);
  return NextResponse.json({error:'Storage removal failed',expired:rows.length},{status:502});
 }
 const ids=rows.map(row=>row.id);
 const deleted=await db.from('chat_messages').delete().in('id',ids)
  .in('kind',['audio','video']).lt('created_at',cutoff).select('id');
 if(deleted.error){
  console.error('Expired chat media DB cleanup failed',deleted.error.code);
  return NextResponse.json({error:'DB cleanup failed; retry is safe',expired:rows.length},{status:500});
 }
 return NextResponse.json({ok:true,retention_hours:RETENTION_HOURS,expired:data.length,removed:deleted.data?.length||0,more_possible:data.length>=BATCH});
}
