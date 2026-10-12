import {NextResponse} from 'next/server';
import {gameUrl,runtimeConfig,telegramSend,telegramAcknowledge} from '@/lib/server/telegram';
import {telegramCallbackCommand,telegramHelpText,telegramMenuText,telegramWelcomeText,TELEGRAM_MENU_BUTTONS,TELEGRAM_WELCOME_BUTTONS} from '@/lib/server/telegramPresentation';
export const runtime='nodejs';
type PrivateMessage={chat:{id:number;type:string};from?:{id:number};message_id:number;text?:string};
type TelegramUpdate={message?:PrivateMessage;callback_query?:{id:string;from:{id:number};data?:string;message?:PrivateMessage}};
export async function POST(request:Request){
 let config:ReturnType<typeof runtimeConfig>;
 try{config=runtimeConfig()}catch{return NextResponse.json({error:'Not configured'},{status:503})}
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
    telegramWelcomeText(true)+'\n\n🎮 '+gameUrl(data as string),TELEGRAM_WELCOME_BUTTONS);
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
   await reply((games||[]).map(g=>g.title+' — /game '+g.id).join('\n')||'Нет игр');return NextResponse.json({ok:true});
  }
  const requested=command==='/game'?args[1]:args[1]&&/^[0-9a-f-]{36}$/.test(args[1])?args[1]:undefined;
  const game=valid.find(l=>l.game_id===requested)|| (valid.length===1?valid[0]:undefined);
  if(!game){await reply('Укажите игру командой /game <id>. Список: /games');return NextResponse.json({ok:true})}
  if(command==='/game'){await reply('Игра выбрана для этой команды: '+gameUrl(game.game_id)+'\nЕсли у вас несколько игр, указывайте её UUID в командах.');return NextResponse.json({ok:true})}
  if(command==='/status'){
   const {data}=await config.db.from('games').select('title,status,current_round,turn_open').eq('id',game.game_id).single();
   await reply('ГОС.ID — '+(data?.title||'Игра')+'\nСостояние: '+(data?.status||'—')+'\nЭтап: '+(data?.current_round||'—')+'\nХод: '+(data?.turn_open?'открыт':'закрыт')+'\n'+gameUrl(game.game_id));return NextResponse.json({ok:true});
  }
  if(command==='/stages'){
   const {data}=await config.db.from('game_stages').select('stage_no,title,status').eq('game_id',game.game_id).order('stage_no');
   await reply((data||[]).map(s=>s.stage_no+'. '+s.title+' ['+s.status+']').join('\n').slice(0,3900)||'Этапов нет');return NextResponse.json({ok:true});
  }
  if(command==='/votes'){
   const {data}=await config.db.from('game_votes').select('id,status').eq('game_id',game.game_id).eq('status','open').limit(12);
   await reply('Открытые голосования:\n'+((data||[]).map(()=>'• Голосование открыто').join('\n')||'Нет')+'\n'+gameUrl(game.game_id));return NextResponse.json({ok:true});
  }
  if(command==='/docs'){
   const {data}=await config.db.from('formal_documents').select('id,status_label').eq('game_id',game.game_id).order('updated_at',{ascending:false}).limit(12);
   await reply('Документы:\n'+((data||[]).map(d=>'• Документ — '+d.status_label).join('\n')||'Нет')+'\n'+gameUrl(game.game_id));return NextResponse.json({ok:true});
  }
  if(command==='/channels'){
   const {data:member}=await config.db.from('game_members').select('kind').eq('game_id',game.game_id).eq('user_id',game.user_id).single();
   const {data:channels}=await config.db.from('chat_channels').select('id,name,kind').eq('game_id',game.game_id);
   const {data:membership}=await config.db.from('channel_members').select('channel_id').eq('user_id',game.user_id);
   const allowed=(channels||[]).filter(c=>c.kind==='public'||member?.kind==='teacher'||membership?.some(m=>m.channel_id===c.id));
   await reply(allowed.map(c=>c.name+' — /channel '+c.id).join('\n').slice(0,3900)||'Нет доступных каналов');return NextResponse.json({ok:true});
  }
  if(command==='/channel'){
   const id=args[1];if(!id){await reply('Выберите канал через /channels');return NextResponse.json({ok:true})}
   const {data,error}=await config.db.rpc('telegram_select_channel',{p_telegram_user_id:telegramId,p_game_id:game.game_id,p_channel_id:id});
   await reply(error||!data?'Нет доступа к каналу.':'Канал выбран. Отправка: /chat текст');return NextResponse.json({ok:true});
  }
  if(command==='/chat'){
   if(!game.default_channel_id){await reply('Сначала выберите канал через /channels');return NextResponse.json({ok:true})}
   const payload=text.slice(command.length).trim();if(!payload){await reply('Введите /chat ваш текст');return NextResponse.json({ok:true})}
   const {error}=await config.db.rpc('telegram_post_chat',{p_telegram_user_id:telegramId,p_game_id:game.game_id,p_channel_id:game.default_channel_id,p_text:payload,p_chat_id:chatId,p_message_id:message.message_id});
   await reply(error?'Не удалось отправить: '+error.message:'Сообщение отправлено в игру.');return NextResponse.json({ok:true});
  }
  await reply('Неизвестная команда. Используйте /help');
 }catch(e){try{await reply('Ошибка обработки команды. Попробуйте позднее.')}catch{} console.error('Telegram webhook processing error',e instanceof Error?e.message:'unknown')}
 return NextResponse.json({ok:true});
}
