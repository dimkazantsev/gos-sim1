import {NextResponse} from 'next/server';
import {telegramCabinetCard} from '@/lib/server/telegramCabinet';
import {handleTelegramAppeal} from '@/lib/server/telegramAppealWorkflow';
import {telegramVisibleChatChannels} from '@/lib/server/telegramVisibleChatChannels';
import {telegramRepublicName,telegramSentence} from '@/lib/server/telegramRepublicText';
import {runtimeConfig,telegramSend,telegramAcknowledge} from '@/lib/server/telegram';
import {telegramCallbackCommand,telegramHelpText,telegramMenuText,telegramWelcomeText,TELEGRAM_MENU_BUTTONS,TELEGRAM_WELCOME_BUTTONS,telegramSectionButtons,telegramDocumentButtons} from '@/lib/server/telegramPresentation';
export const runtime='nodejs';
type PrivateMessage={chat:{id:number;type:string};from?:{id:number};message_id:number;text?:string};
type TelegramUpdate={message?:PrivateMessage;callback_query?:{id:string;from:{id:number};data?:string;message?:PrivateMessage}};
export async function POST(request:Request){
 let config:ReturnType<typeof runtimeConfig>;
 try{config=runtimeConfig()}catch{return NextResponse.json({error:'Сервис не настроен'},{status:503})}
 if(request.headers.get('x-telegram-bot-api-secret-token')!==config.secret)return new Response('Unauthorized',{status:401});
 let update:TelegramUpdate;try{update=await request.json() as TelegramUpdate}catch{return new Response('Bad payload',{status:400})}
 const callback=update.callback_query;
 const message=update.message||callback?.message;
 if(!message||message.chat.type!=='private')return NextResponse.json({ok:true});
 const telegramId=callback?.from.id||message.from?.id,chatId=message.chat.id;
 if(!telegramId)return NextResponse.json({ok:true});
 // Only a strict list of callbacks may invoke commands. All data access below
 // continues through the existing active-member and channel permission checks.
 const callbackCommand=callback?telegramCallbackCommand(callback.data||''):undefined;
 if(callback){
  try{await telegramAcknowledge(config.token,callback.id)}catch(e){console.error('Telegram callback acknowledgement failed',e instanceof Error?e.message:'unknown')}
  if(!callbackCommand)return NextResponse.json({ok:true});
 }
 const text=callbackCommand||message.text?.trim()||'';
 if(!text)return NextResponse.json({ok:true});
 async function reply(value:string,buttons?:Parameters<typeof telegramSend>[3]){
  await telegramSend(config.token,chatId,value,buttons);
 }
 try{
  if(text.startsWith('/start ')){
   const token=text.slice(7).trim();
   if(!/^[a-f0-9]{48}$/.test(token)){
    await reply('⚠️ Код привязки устарел или неверен. Получите новый в профиле ГОС.ID.\n\n'+telegramWelcomeText(),TELEGRAM_WELCOME_BUTTONS);
    return NextResponse.json({ok:true});
   }
   const {data,error}=await config.db.rpc('telegram_connect',{p_token:token,p_telegram_user_id:telegramId,p_chat_id:chatId});
   await reply(error?'⚠️ Привязка не подтверждена. Создайте новый код в профиле и попробуйте ещё раз.':
    telegramWelcomeText(true)+'\n\n✅ Игра успешно привязана.',TELEGRAM_WELCOME_BUTTONS);
   return NextResponse.json({ok:true});
  }
  if(text==='/start'){
   await reply(telegramWelcomeText(),TELEGRAM_WELCOME_BUTTONS);
   return NextResponse.json({ok:true});
  }
  if(text==='/menu'||text==='🏛 Меню'){
   const {data,error}=await config.db.from('telegram_links').select('game_id').eq('telegram_user_id',telegramId).limit(1);
   if(error)throw error;
   await reply(telegramMenuText(!!data?.length),TELEGRAM_MENU_BUTTONS);
   return NextResponse.json({ok:true});
  }
  if(text==='/help'){
   await reply(telegramHelpText(),TELEGRAM_MENU_BUTTONS);
   return NextResponse.json({ok:true});
  }
  const {data:links,error:linksError}=await config.db.from('telegram_links').select('game_id,user_id,default_channel_id').eq('telegram_user_id',telegramId);
  if(linksError)throw linksError;
  const valid=(await Promise.all((links||[]).map(async l=>{
   const {data:member}=await config.db.from('game_members').select('user_id').eq('game_id',l.game_id).eq('user_id',l.user_id).is('roster_archived_at',null).maybeSingle();
   return member?l:null;
  }))).filter((link):link is NonNullable<typeof link>=>link!==null);
  if(!valid.length){await reply('Аккаунт ещё не привязан. Откройте свой профиль на сайте игры.');return NextResponse.json({ok:true})}
  const args=text.split(/\s+/),command=args[0].split('@')[0];
  if(command==='/games'){
   const {data:games}=await config.db.from('games').select('id,title').in('id',valid.map(l=>l.game_id));
   const groups=await Promise.all(valid.map(async l=>{
    const {data:member}=await config.db.from('game_members').select('group_name').eq('game_id',l.game_id).eq('user_id',l.user_id).maybeSingle();
    return {id:l.game_id,group:member?.group_name||'не указана'};
   }));
   const entries=(games||[]).map(g=>'🏛 Игра: '+telegramRepublicName(g.title)+'\n👥 Группа: '+(groups.find(x=>x.id===g.id)?.group||'не указана'));
   await reply('🏛 ГОС.ID · Мои игры\n\n'+(entries.join('\n\n')||'Нет подключённых игр.')+'\n\n👤 Перейдите в профиль через кнопку ниже.',telegramSectionButtons('profile','Мой профиль'));
   return NextResponse.json({ok:true});
  }
  const requested=command==='/game'?args[1]:!command.startsWith('/appeal_')&&args[1]&&/^[0-9a-f-]{36}$/.test(args[1])?args[1]:undefined;
  const game=valid.find(l=>l.game_id===requested)|| (valid.length===1?valid[0]:undefined);
  if(!game){await reply('Выберите игру командой /game ИДЕНТИФИКАТОР. Список: /games');return NextResponse.json({ok:true})}
  if(command==='/game'){await reply('🏛 ГОС.ID · Игра выбрана\n\nИспользуйте кнопки бота для просмотра информации.',telegramSectionButtons('dashboard','Открыть игру'));return NextResponse.json({ok:true})}
  const prefMap:Record<string,string>={
   '/settings_brief':'daily_brief','/settings_tasks':'task_reminders',
   '/settings_mentions':'mentions','/settings_documents':'documents',
   '/settings_votes':'votes','/settings_events':'events','/settings_quiet':'quiet_hours'
  };
  const key=prefMap[command];
  if(key){
   const {data:current,error:readError}=await config.db.from('telegram_notification_preferences')
    .select('daily_brief,task_reminders,mentions,documents,votes,events,quiet_hours')
    .eq('game_id',game.game_id).eq('user_id',game.user_id).maybeSingle();
   if(readError)throw readError;
   const now=current as Record<string,boolean>|null;
   const oldValue=now?.[key]??(key!=='quiet_hours');
   // Update only the toggled column: upsert with omitted columns would reset
   // other notification preferences to their database defaults.
   const table=config.db.from('telegram_notification_preferences');
   const update=now
    ? await table.update({[key]:!oldValue,updated_at:new Date().toISOString()})
       .eq('game_id',game.game_id).eq('user_id',game.user_id)
    : await table.insert({game_id:game.game_id,user_id:game.user_id,[key]:!oldValue,updated_at:new Date().toISOString()});
   if(update.error)throw update.error;
   const card=await telegramCabinetCard(config.db,game.game_id,game.user_id,'settings');
   await reply(card.text,card.buttons);
   return NextResponse.json({ok:true});
  }
  if(['/office','/brief','/agenda','/tasks','/inbox','/news','/crises','/economy','/career','/legal','/training','/settings'].includes(command)){
   const card=await telegramCabinetCard(config.db,game.game_id,game.user_id,command.slice(1) as Parameters<typeof telegramCabinetCard>[3]);
   await reply(card.text,card.buttons);
   return NextResponse.json({ok:true});
  }
  if(command==='/appeal'||command.startsWith('/appeal_')||(!text.startsWith('/')&&!callback)){
   const handled=await handleTelegramAppeal({
    db:config.db,gameId:game.game_id,userId:game.user_id,telegramId,
    messageId:message.message_id,text,isCallback:!!callback,reply
   });
   if(handled)return NextResponse.json({ok:true});
  }
  if(command==='/appeals'){
   const {data,error}=await config.db.from('official_appeals').select('id,author_id,recipient_id,body,status,reply_text,created_at')
    .eq('game_id',game.game_id).or('author_id.eq.'+game.user_id+',recipient_id.eq.'+game.user_id)
    .order('created_at',{ascending:false}).limit(8);
   if(error)throw error;
   const lines=(data||[]).map((a,i)=>{
    const incoming=a.recipient_id===game.user_id;
    const code=a.id.replace(/-/g,'').slice(0,12).toUpperCase();
    return (i+1)+'. '+(incoming?'📥 Входящее':'📤 Исходящее')+
     ' · '+(a.status==='replied'?'✅ Ответ получен':'🕒 На рассмотрении')+
     '\nКод: '+code+'\n'+a.body.slice(0,130)+
     (a.reply_text?'\nОтвет: '+a.reply_text.slice(0,180):
       incoming&&a.status==='open'?'\nОтветить: /reply '+code+' Ваш текст':'');
   });
   await reply('🏛 ГОС.ID · Приёмная\n\n'+(lines.join('\n\n')||'Обращений пока нет.'));
   return NextResponse.json({ok:true});
  }
  if(command==='/reply'){
   // Short, stable codes shown in /appeals; keep accepting full historical IDs.
   const match=text.match(/^\/reply\s+([0-9a-f]{12}|[0-9a-f-]{36})\s+([\s\S]{1,4000})$/i);
   if(!match){
    await reply('📬 ГОС.ID · Ответ на обращение\n\nОткройте «Приёмную», найдите входящее обращение и скопируйте его код.\n\nПример: /reply A1B2C3D4E5F6 Текст ответа.');
    return NextResponse.json({ok:true});
   }
   const {data:actor,error:actorError}=await config.db.from('game_members').select('kind').eq('game_id',game.game_id).eq('user_id',game.user_id).is('roster_archived_at',null).maybeSingle();
   if(actorError||!actor)throw actorError||new Error('Active membership required');
   const code=match[1].replace(/-/g,'').toLowerCase();
   let query=config.db.from('official_appeals').select('id,recipient_id').eq('game_id',game.game_id);
   if(actor.kind!=='teacher')query=query.eq('recipient_id',game.user_id);
   if(code.length===32)query=query.eq('id',match[1]);
   else{
    // PostgreSQL UUID ordering supports exact prefix lookup without listing all appeals.
    const prefix=code.slice(0,8)+'-'+code.slice(8,12)+'-';
    query=query.gte('id',prefix+'0000-0000-000000000000')
      .lte('id',prefix+'ffff-ffff-ffffffffffff');
   }
   const {data:matching,error:lookupError}=await query.limit(2);
   if(lookupError)throw lookupError;
   if(matching?.length!==1){
    await reply('📬 ГОС.ID · Приёмная\n\nКод обращения не найден или неоднозначен. Сверьте его со списком входящих обращений.');
    return NextResponse.json({ok:true});
   }
   const result=await config.db.rpc('telegram_reply_official_appeal',{
    p_telegram_user_id:telegramId,p_appeal_id:matching[0].id,p_text:match[2].trim(),p_message_id:message.message_id
   });
   if(result.error)throw result.error;
   await reply('📬 ГОС.ID · Приёмная\n\n✅ Ответ зарегистрирован и направлен автору обращения.');
   return NextResponse.json({ok:true});
  }
  if(command==='/status'){
   const {data,error}=await config.db.from('games').select('current_round,turn_open').eq('id',game.game_id).single();
   if(error)throw error;
   const {data:stage,error:stageError}=await config.db.from('game_stages').select('title')
    .eq('game_id',game.game_id).eq('stage_no',data?.current_round||1).maybeSingle();
   if(stageError)throw stageError;
   await reply('🏛 ГОС.ID · Состояние игры\n\n📍 Этап: '+
    telegramSentence(stage?.title||'Ожидает назначения')+'\n'+
    (data?.turn_open?'🟢 Работа по этапу продолжается.':'🕰 Ход закрыт.'),
    telegramSectionButtons('dashboard','Открыть обзор'));
   return NextResponse.json({ok:true});
  }
  if(command==='/stages'){
   const {data}=await config.db.from('game_stages').select('stage_no,title,status').eq('game_id',game.game_id).order('stage_no');
   const label=(s:string)=>s==='open'?'🟢 Открыт':s==='closed'||s==='completed'?'✅ Завершён':'🔒 Ожидает';
   await reply('🏛 ГОС.ID · Этапы\n\n'+((data||[]).map(s=>'Этап '+s.stage_no+'. '+s.title+'\n'+label(s.status)).join('\n\n')||'Этапов пока нет.'),telegramSectionButtons('stages','Открыть этапы'));
   return NextResponse.json({ok:true});
  }
  if(command==='/votes'){
   const {data}=await config.db.from('game_votes').select('id,title').eq('game_id',game.game_id).eq('status','open').limit(10);
   await reply('🏛 ГОС.ID · Голосования\n\n🗳 Открытые голосования:\n'+((data||[]).map((v,i)=>(i+1)+'. '+v.title).join('\n')||'Нет активных голосований.'),telegramSectionButtons('votes','Открыть голосования'));
   return NextResponse.json({ok:true});
  }
  if(command==='/docs'){
   const {data}=await config.db.from('formal_documents').select('id,title,status_label').eq('game_id',game.game_id).order('updated_at',{ascending:false}).limit(10);
   const entries=(data||[]).map((d,i)=>(i+1)+'. '+d.title+'\n'+(d.status_label||'На рассмотрении'));
   await reply('🏛 ГОС.ID · Документы\n\n📜 Последние документы:\n\n'+(entries.join('\n\n')||'Документов пока нет.')+'\n\nОткройте нужный документ кнопкой ниже.',telegramDocumentButtons(data||[]));
   return NextResponse.json({ok:true});
  }
  if(command==='/channels'){
   const allowed=await telegramVisibleChatChannels(config.db,game.game_id,game.user_id);
   const ids=allowed.map(c=>c.id);
   if(!ids.length){
    await reply('🏛 ГОС.ID · Чаты\n\nДоступных бесед пока нет.',telegramSectionButtons('dashboard','Открыть ГОС.ID'));
    return NextResponse.json({ok:true});
   }
   // Archived channels are already removed from `allowed`. Source messages
   // must also pass the same one-hour media visibility used by the game RLS.
   const cutoff=new Date(Date.now()-3600000).toISOString();
   const {data:messages,error:messageError}=await config.db.from('chat_messages')
    .select('channel_id,author_id,text,kind').eq('game_id',game.game_id)
    .in('channel_id',ids)
    .or('kind.not.in.(audio,video),created_at.gt.'+cutoff)
    .order('created_at',{ascending:false}).limit(2);
   if(messageError)throw messageError;
   const authorIds=[...new Set((messages||[]).map(m=>m.author_id))];
   const {data:people,error:peopleError}=authorIds.length
    ?await config.db.from('game_members').select('user_id,full_name')
      .eq('game_id',game.game_id).in('user_id',authorIds)
    :{data:[],error:null};
   if(peopleError)throw peopleError;
   const entries=(messages||[]).map(m=>
    '💬 '+(allowed.find(c=>c.id===m.channel_id)?.name||'Беседа')+'\n'+
    (people?.find(x=>x.user_id===m.author_id)?.full_name||'Участник')+': '+
    (m.kind==='text'||m.kind==='system'?(m.text?.slice(0,230)||'Сообщение'):'Медиафайл'));
   await reply('🏛 ГОС.ID · Чаты\n\n'+
    (entries.length?'Последние два сообщения:\n\n'+entries.join('\n\n'):'В доступных чатах пока нет сообщений.')+
    '\n\nДоступных чатов: '+allowed.length,
    telegramSectionButtons('dashboard','Открыть ГОС.ID'));
   return NextResponse.json({ok:true});
  }
  if(command==='/channel'){
   const id=args[1];
   if(!id){await reply('Выберите канал через /channels');return NextResponse.json({ok:true})}
   const allowed=await telegramVisibleChatChannels(config.db,game.game_id,game.user_id);
   if(!allowed.some(c=>c.id===id)){
    await reply('🏛 ГОС.ID · Чаты\n\nБеседа недоступна или перенесена в архив. Выберите действующий чат.');
    return NextResponse.json({ok:true});
   }
   const {data,error}=await config.db.rpc('telegram_select_channel',{p_telegram_user_id:telegramId,p_game_id:game.game_id,p_channel_id:id});
   await reply(error||!data?'Нет доступа к каналу.':'Канал выбран. Отправка: /chat текст');return NextResponse.json({ok:true});
  }
  if(command==='/chat'){
   if(!game.default_channel_id){await reply('Сначала выберите канал через /channels');return NextResponse.json({ok:true})}
   const allowed=await telegramVisibleChatChannels(config.db,game.game_id,game.user_id);
   if(!allowed.some(c=>c.id===game.default_channel_id)){
    await reply('🏛 ГОС.ID · Чаты\n\nВыбранная беседа больше недоступна. Выберите действующий канал через /channels.');
    return NextResponse.json({ok:true});
   }
   const payload=text.slice(command.length).trim();if(!payload){await reply('Введите /chat ваш текст');return NextResponse.json({ok:true})}
   const {error}=await config.db.rpc('telegram_post_chat',{p_telegram_user_id:telegramId,p_game_id:game.game_id,p_channel_id:game.default_channel_id,p_text:payload,p_chat_id:chatId,p_message_id:message.message_id});
   await reply(error?'Не удалось отправить: '+error.message:'Сообщение отправлено в игру.');return NextResponse.json({ok:true});
  }
  await reply('Неизвестная команда. Используйте /help');
 }catch(e){try{await reply('Ошибка обработки команды. Попробуйте позднее.')}catch{} console.error('Telegram webhook processing error',e instanceof Error?e.message:'unknown')}
 return NextResponse.json({ok:true});
}
