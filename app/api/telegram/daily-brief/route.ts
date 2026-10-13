import {NextResponse} from 'next/server';
import {runtimeConfig} from '@/lib/server/telegram';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/** Daily deterministic, per-game digests. Pushes to the same idempotent outbox. */
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;
 if(!secret||request.headers.get('authorization')!=='Bearer '+secret)return new Response('Unauthorized',{status:401});
 let config:ReturnType<typeof runtimeConfig>;
 try{config=runtimeConfig()}catch{return NextResponse.json({error:'Not configured'},{status:503})}
 const {data:links,error}=await config.db.from('telegram_links')
  .select('game_id,user_id,notifications_enabled').eq('notifications_enabled',true).limit(300);
 if(error)return NextResponse.json({error:'Cannot load recipients'},{status:500});
 let queued=0,skipped=0,failed=0;
 for(const l of links||[]){
  const {data:member}=await config.db.from('game_members').select('role_title')
   .eq('game_id',l.game_id).eq('user_id',l.user_id).is('roster_archived_at',null).maybeSingle();
  if(!member){skipped++;continue}
  const {data:pref}=await config.db.from('telegram_bot_preferences')
   .select('daily_digest,notify_tasks,timezone').eq('game_id',l.game_id).eq('user_id',l.user_id).maybeSingle();
  const tz=pref?.timezone||'Asia/Barnaul';
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [{data:game},{data:stage},{data:tasks},{data:deliveries},{data:votes}]=await Promise.all([
   config.db.from('games').select('title,current_round').eq('id',l.game_id).maybeSingle(),
   config.db.from('game_stages').select('title').eq('game_id',l.game_id).eq('status','open').order('stage_no',{ascending:false}).limit(1).maybeSingle(),
   config.db.from('game_assigned_tasks').select('id,title,due_at').eq('game_id',l.game_id).eq('recipient_id',l.user_id).eq('status','open').order('due_at').limit(20),
   config.db.from('formal_document_deliveries').select('id').eq('game_id',l.game_id).eq('recipient_id',l.user_id).limit(30),
   config.db.from('game_votes').select('id').eq('game_id',l.game_id).eq('status','open').limit(30)
  ]);
  const nextTask=(tasks||[]).slice(0,2).map(t=>'• '+t.title.slice(0,100)+' — '+new Date(t.due_at).toLocaleDateString('ru-RU',{timeZone:tz})).join('\n');
  const body='🌅 ГОС.ID · Государственный доклад\n\n🏛 '+(game?.title||'Республика')+
   '\n📍 Этап: '+(stage?.title||'не открыт')+
   '\n📌 Поручений: '+(tasks?.length||0)+
   '\n📥 Документов: '+(deliveries?.length||0)+
   '\n🗳 Открытых голосований: '+(votes?.length||0)+
   (nextTask?'\n\nБлижайшие поручения:\n'+nextTask:'')+
   '\n\nОткройте «Личный аппарат» в меню бота для подробностей.';
  if(pref?.notify_tasks!==false){
   for(const t of (tasks||[]).filter(item=>new Date(item.due_at).getTime()<=Date.now()+24*60*60*1000).slice(0,4)){
    const {error:reminderError}=await config.db.from('telegram_outbox').insert({
     game_id:l.game_id,user_id:l.user_id,category:'task_reminder_'+day,
     source_id:t.id,
     body:'⏰ ГОС.ID · Срок поручения\n\n«'+t.title.slice(0,150)+'»\nИсполнить до: '+
      new Date(t.due_at).toLocaleString('ru-RU',{timeZone:tz,dateStyle:'medium',timeStyle:'short'})+
      '\n\nОткройте «Поручения» в меню бота.'
    });
    if(reminderError?.code==='23505')skipped++;else if(reminderError)failed++;else queued++;
   }
  }
  if(pref?.daily_digest===false){skipped++;continue}
  // category is date-specific; source_id is the game UUID. Unique index on
  // (game_id,user_id,category,source_id) prevents duplicate notifications.
  const {error:insertError}=await config.db.from('telegram_outbox').insert({
   game_id:l.game_id,user_id:l.user_id,category:'digest_'+day,
   source_id:l.game_id,body
  });
  if(insertError?.code==='23505'){skipped++;continue}
  if(insertError){failed++;continue}
  queued++;
 }
 return NextResponse.json({ok:failed===0,queued,skipped,failed},{status:failed?500:200});
}
