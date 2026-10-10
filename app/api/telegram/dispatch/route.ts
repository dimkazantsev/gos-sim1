import {NextResponse} from 'next/server';
import {runtimeConfig,telegramSend} from '@/lib/server/telegram';
export const runtime='nodejs';
export async function GET(request:Request){
 let config:ReturnType<typeof runtimeConfig>;try{config=runtimeConfig()}catch{return NextResponse.json({error:'Not configured'},{status:503})}
 const cron=process.env.CRON_SECRET;
 if(!cron||request.headers.get('authorization')!=='Bearer '+cron)return new Response('Unauthorized',{status:401});
 const {data:jobs,error}=await config.db.from('telegram_outbox').select('id,game_id,user_id,body,attempts').is('sent_at',null).lt('attempts',5).lte('next_attempt_at',new Date().toISOString()).order('id').limit(40);
 if(error)return NextResponse.json({error:'Queue query failed'},{status:500});
 let sent=0;
 for(const job of jobs||[]){
  const {data:claimed}=await config.db.from('telegram_outbox').update({attempts:job.attempts+1,next_attempt_at:new Date(Date.now()+120000).toISOString()}).eq('id',job.id).eq('attempts',job.attempts).is('sent_at',null).select('id').maybeSingle();
  if(!claimed)continue;
  const {data:link}=await config.db.from('telegram_links').select('chat_id,notifications_enabled').eq('game_id',job.game_id).eq('user_id',job.user_id).maybeSingle();
  const {data:member}=await config.db.from('game_members').select('user_id').eq('game_id',job.game_id).eq('user_id',job.user_id).is('roster_archived_at',null).maybeSingle();
  if(!link?.notifications_enabled||!member){await config.db.from('telegram_outbox').update({sent_at:new Date().toISOString(),last_error:'Subscription inactive'}).eq('id',job.id);continue}
  try{await telegramSend(config.token,link.chat_id,job.body);await config.db.from('telegram_outbox').update({sent_at:new Date().toISOString(),last_error:null}).eq('id',job.id);sent++}
  catch(e){await config.db.from('telegram_outbox').update({last_error:e instanceof Error?e.message.slice(0,250):'Unknown error',next_attempt_at:new Date(Date.now()+Math.pow(2,Math.min(job.attempts,4))*60000).toISOString()}).eq('id',job.id)}
 }
 return NextResponse.json({ok:true,processed:(jobs||[]).length,sent});
}
