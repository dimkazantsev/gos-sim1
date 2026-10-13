import {NextResponse} from 'next/server';
import {telegramVisibleChatChannels} from '@/lib/server/telegramVisibleChatChannels';
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
  // Outbox entries can outlive the underlying record. Never deliver material
  // which was deleted, archived, revoked, or hidden from the current game UI.
  const dismiss=async(reason:string)=>{
   await config.db.from('telegram_outbox').update({sent_at:new Date().toISOString(),last_error:reason}).eq('id',job.id);
  };
  if(job.category==='chat'||job.category==='mention_chat'){
   const allowed=await telegramVisibleChatChannels(config.db,job.game_id,job.user_id);
   if(!job.channel_id||!allowed.some(c=>c.id===job.channel_id)){
    await dismiss('Chat channel hidden or access revoked');continue;
   }
   let messageId=job.source_id;
   if(job.category==='mention_chat'){
    const {data:mention,error:mentionError}=await config.db.from('chat_mentions')
     .select('message_id').eq('id',job.source_id).eq('game_id',job.game_id)
     .eq('channel_id',job.channel_id).maybeSingle();
    if(mentionError){console.error('Telegram mention lookup failed',mentionError.code);continue}
    messageId=mention?.message_id||null;
   }
   if(!messageId){await dismiss('Chat source deleted');continue}
   const {data:message,error:messageError}=await config.db.from('chat_messages')
    .select('id').eq('id',messageId).eq('game_id',job.game_id)
    .eq('channel_id',job.channel_id).maybeSingle();
   if(messageError){console.error('Telegram message lookup failed',messageError.code);continue}
   if(!message){await dismiss('Chat message deleted');continue}
  }
  if(job.category==='mention_actions'||job.category==='mention_documents'){
   let visible=false;
   const {data:post,error:postError}=await config.db.from('political_posts')
    .select('id').eq('id',job.source_id).eq('game_id',job.game_id)
    .is('deleted_at',null).maybeSingle();
   if(postError){console.error('Telegram post lookup failed',postError.code);continue}
   visible=!!post&&job.category==='mention_actions';
   if(!visible){
    const {data:comment,error:commentError}=await config.db.from('civic_comments')
     .select('target_kind,target_id').eq('id',job.source_id).eq('game_id',job.game_id).maybeSingle();
    if(commentError){console.error('Telegram comment lookup failed',commentError.code);continue}
    if(comment&&((job.category==='mention_actions'&&comment.target_kind==='post')||
       (job.category==='mention_documents'&&comment.target_kind==='document'))){
     const table=comment.target_kind==='post'?'political_posts':'formal_documents';
     let query=config.db.from(table).select('id').eq('id',comment.target_id).eq('game_id',job.game_id);
     if(comment.target_kind==='post')query=query.is('deleted_at',null);
     const {data:target,error:targetError}=await query.maybeSingle();
     if(targetError){console.error('Telegram comment target lookup failed',targetError.code);continue}
     visible=!!target;
    }
   }
   if(!visible){await dismiss('Mention source no longer visible');continue}
  }
  if(job.category==='document'||job.category==='vote'||job.category==='task'||job.category==='task_done'){
   const table=job.category==='document'?'formal_documents':job.category==='vote'?'game_votes':'game_assigned_tasks';
   const {data:entity,error:entityError}=await config.db.from(table)
    .select('id,status').eq('id',job.source_id).eq('game_id',job.game_id).maybeSingle();
   if(entityError){console.error('Telegram source lookup failed',entityError.code);continue}
   if(!entity||
     (job.category==='vote'&&entity.status!=='open')||
     (job.category==='task'&&entity.status==='confirmed')||
     (job.category==='task_done'&&entity.status!=='completed')){
    await dismiss('Source removed or no longer active');continue;
   }
  }
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
   // Quiet-hour deferral is not a failed delivery; preserve retry budget.
   await config.db.from('telegram_outbox').update({
    attempts:job.attempts,next_attempt_at:new Date(Date.now()+3600000).toISOString()
   }).eq('id',job.id).eq('attempts',job.attempts+1).is('sent_at',null);
   continue;
  }
  let buttons:Parameters<typeof telegramSend>[3]|undefined;
  if(job.category==='appeal'||job.category==='appeal_reply')buttons={inline_keyboard:[[{text:'📨 Приёмная',callback_data:'gos:appeals'}],[{text:'🏛 Меню',callback_data:'gos:menu'}]]};
  else if(job.category==='daily_brief')buttons={inline_keyboard:[[{text:'🏛 Личный аппарат',callback_data:'gos:office'}],[{text:'⚙️ Настройки',callback_data:'gos:settings'}]]};
  else if(job.category==='document_delivery'){
   const {data:delivery}=await config.db.from('formal_document_deliveries').select('document_id').eq('id',job.source_id).eq('recipient_id',job.user_id).eq('game_id',job.game_id).maybeSingle();
   if(!delivery){await dismiss('Delivery revoked');continue}
   const {data:document,error:docError}=await config.db.from('formal_documents')
    .select('id').eq('id',delivery.document_id).eq('game_id',job.game_id).maybeSingle();
   if(docError){console.error('Telegram delivery document lookup failed',docError.code);continue}
   if(!document){await dismiss('Delivery document deleted');continue}
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
