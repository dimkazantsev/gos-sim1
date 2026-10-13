import {NextResponse} from 'next/server';
import {runtimeConfig} from '@/lib/server/telegram';
export const runtime='nodejs';
export const dynamic='force-dynamic';

/** Idempotent 08:00 Barnaul daily dispatch through the existing outbox. */
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;
 if(!secret||request.headers.get('authorization')!=='Bearer '+secret)return new Response('Unauthorized',{status:401});
 let config:ReturnType<typeof runtimeConfig>;
 try{config=runtimeConfig()}catch{return NextResponse.json({error:'Unavailable'},{status:503})}
 const {data,error}=await config.db.rpc('telegram_queue_morning_digest');
 if(error){console.error('Telegram daily digest queue error',error.code);return NextResponse.json({error:'Queue failed'},{status:500})}
 return NextResponse.json({ok:true,queued:data||0});
}
