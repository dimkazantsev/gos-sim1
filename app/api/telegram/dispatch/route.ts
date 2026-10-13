import {NextResponse} from 'next/server';
import {runtimeConfig,telegramSend} from '@/lib/server/telegram';
import {telegramSectionButtons,telegramDocumentButtons,telegramTaskButtons,telegramChatButtons} from '@/lib/server/telegramPresentation';
export const runtime='nodejs';
export async function GET(request:Request){
 let config:ReturnType<typeof runtimeConfig>;try{config=runtimeConfig()}catch{return NextResponse.json({error:'Not configured'},{status:503})}
 const cron=process.env.CRON_SECRET;
 if(!cron||request.headers.get('authorization')!=='Bearer '+cron)return new Response('Unauthorized',{status:401});
 const {data:jobs,error}=await config.db.from('telegram_outbox').select('id,game_id,user_id,body,attempts,category,channel_id,source_id').is('sent_at',null).lt('attempts',5).lte('next_attempt_at',new Date().toISOString()).order('id').limit(40);
 if(error)return NextResponse.json({error:'Queue query failed'},{status:500});
 let sent=0;
 for(const job of jobs||[]){
  const {data:claimed}=await config.db.from('telegram_outbox').update({attempts:job.attempts+1,next_attempt_at:new Date(Date.now()+120000).toISOString()}).eq('id',job.id).eq('attempts',job.attempts).is('sent_at',null).select('id').maybeSingle();
  if(!claimed)continue;
  const {data:link}=await config.db.from('telegram_links').select('chat_id,notifications_enabled').eq('game_id',job.game_id).eq('user_id',job.user_id).maybeSingle();
  const {data:member}=await config.db.from('game_members').select('user_id').eq('game_id',job.game_id).eq('user_id',job.user_id).is('roster_archived_at',null).maybeSingle();
  if(!link?.notifications_enabled||!member){await config.db.from('telegram_outbox').update({sent_at:new Date().toISOString(),last_error:'Subscription inactive'}).eq('id',job.id);continue}
  if(job.category==='chat'||job.category==='mention_chat'){const {data:channel}=await config.db.from('chat_channels').select('kind').eq('id',job.channel_id).eq('game_id',job.game_id).maybeSingle();const {data:receiver}=await config.db.from('game_members').select('kind').eq('game_id',job.game_id).eq('user_id',job.user_id).maybeSingle();const {data:channelMember}=await config.db.from('channel_members').select('user_id').eq('channel_id',job.channel_id).eq('user_id',job.user_id).maybeSingle();if(!channel||(channel.kind!=='public'&&receiver?.kind!=='teacher'&&!channelMember)){await config.db.from('telegram_outbox').update({sent_at:new Date().toISOString(),last_error:'Channel access revoked'}).eq('id',job.id);continue}}
  const {data:preferences,error:prefsError}=await config.db.from('telegram_notification_preferences')
   .select('daily_brief,task_reminders,mentions,documents,votes,events,quiet_hours')
   .eq('game_id',job.game_id).eq('user_id',job.user_id).maybeSingle();
  if(prefsError){console.error('Telegram preferences query failed',prefsError.code);continue}
  const categoryKey:Record<string,string>={
   daily_brief:'daily_brief',task:'task_reminders',task_done:'task_reminders',
   mention_chat:'mentions',mention_actions:'mentions',mention_documents:'mentions',
   document:'documents',document_delivery:'documents',vote:'votes',stage:'events',event:'events'
  };
  const setting=categoryKey[job.category];
  if(setting&&preferences&&(preferences as Record<string,boolean>)[setting]===false){
   await config.db.from('telegram_outbox').update({sent_at:new Date().toISOString(),last_error:'Notification category disabled'}).eq('id',job.id);
   continue;
  }
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Barnaul',hour:'2-digit',hourCycle:'h23'}).format(new Date());
  if(preferences?.quiet_hours&&(Number(time)>=22||Number(time)<8)){
   // Keep pending until a later dispatcher run, never mark the alert delivered.
   await config.db.from('telegram_outbox').update({next_attempt_at:new Date(Date.now()+3600000).toISOString()}).eq('id',job.id);
   continue;
  }
  let buttons:Parameters<typeof telegramSend>[3]|undefined;
  if(job.category==='daily_brief')buttons={inline_keyboard:[[{text:'🏛 Личный аппарат',callback_data:'gos:office'}],[{text:'⚙️ Настройки',callback_data:'gos:settings'}]]};
  else if(job.category==='document_delivery'){
   const {data:delivery}=await config.db.from('formal_document_deliveries').select('document_id').eq('id',job.source_id).eq('recipient_id',job.user_id).eq('game_id',job.game_id).maybeSingle();
   if(!delivery){await config.db.from('telegram_outbox').update({sent_at:new Date().toISOString(),last_error:'Delivery revoked'}).eq('id',job.id);continue}
   buttons=telegramDocumentButtons([{id:delivery.document_id,title:'Открыть документ'}]);
  }else if(job.category==='document'){
   buttons=telegramDocumentButtons([{id:job.source_id,title:'Открыть документ'}]);
  }else if(job.category==='task'||job.category==='task_done')buttons=telegramTaskButtons();
  else if(job.category==='mention_actions')buttons=telegramSectionButtons('actions','Открыть обсуждение');
  else if(job.category==='mention_documents')buttons=telegramSectionButtons('documents','Открыть документы');
  else if(job.category==='chat'||job.category==='mention_chat')buttons=telegramChatButtons(job.channel_id||undefined);
  else if(job.category==='stage')buttons=telegramSectionButtons('stages','Открыть этап');
  else if(job.category==='vote')buttons=telegramSectionButtons('votes','Открыть голосование');
  try{await telegramSend(config.token,link.chat_id,job.body,buttons);await config.db.from('telegram_outbox').update({sent_at:new Date().toISOString(),last_error:null}).eq('id',job.id);sent++}
  catch(e){await config.db.from('telegram_outbox').update({last_error:e instanceof Error?e.message.slice(0,250):'Unknown error',next_attempt_at:new Date(Date.now()+Math.pow(2,Math.min(job.attempts,4))*60000).toISOString()}).eq('id',job.id)}
 }
 return NextResponse.json({ok:true,processed:(jobs||[]).length,sent});
}
