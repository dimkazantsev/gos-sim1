import {telegramApi,telegramApiResult,telegramSetProfilePhoto} from './telegram';
import {TELEGRAM_COMMANDS} from './telegramPresentation';

export const TELEGRAM_WEBHOOK_URL='https://gos-sim1.vercel.app/api/telegram/webhook';
const PRIVATE_SCOPE={type:'all_private_chats'} as const;
const BOT_NAME='ГОС.ID';
const SHORT_DESCRIPTION='🏛 ГОС.ID — Цифровая платформа России. События, решения, этапы и голосования.';
const DESCRIPTION='🏛 ГОС.ID — Цифровая платформа России.\n\nПолучайте уведомления о жизни республики, следите за государственными решениями, голосованиями, этапами и документами.\n\n🚀 Нажмите «Начать», чтобы открыть меню.\n🔐 Для игровых уведомлений привяжите Telegram в личном профиле ГОС.ID.';

type WebhookInfo={url:string;pending_update_count?:number;last_error_message?:string};
type BotCommand={command:string;description:string};
type MenuButton={type:string};
type BotName={name:string};
type BotShortDescription={short_description:string};
type BotDescription={description:string};
export type TelegramActivationResult={
 ok:true;webhook:true;commands:true;menu:true;logo:boolean;warnings:string[];
};
export class TelegramSetupError extends Error{
 constructor(public readonly step:string,reason:string){super(reason)}
}
const safeError=(e:unknown)=>{
 const message=e instanceof Error?e.message:'Неизвестная ошибка Telegram API';
 // Never return a token, secret or URL containing credentials to a browser.
 return message.replace(/bot\d+:[A-Za-z0-9_-]+/g,'bot[hidden]')
  .replace(/https?:\/\/\S+/g,'[URL]').slice(0,220);
};
async function step<T>(label:string,run:()=>Promise<T>):Promise<T>{
 try{return await run()}catch(e){throw new TelegramSetupError(label,safeError(e))}
}
const commandsMatch=(saved:BotCommand[])=>saved.length===TELEGRAM_COMMANDS.length&&
 saved.every((cmd,i)=>cmd.command===TELEGRAM_COMMANDS[i].command&&cmd.description===TELEGRAM_COMMANDS[i].description);

/** Confirm actual Telegram server state; HTTP success on set* is not sufficient. */
export async function verifyTelegramBot(token:string){
 const [webhook,commands,menu]=await Promise.all([
  telegramApiResult<WebhookInfo>(token,'getWebhookInfo',{}),
  telegramApiResult<BotCommand[]>(token,'getMyCommands',{scope:PRIVATE_SCOPE}),
  telegramApiResult<MenuButton>(token,'getChatMenuButton',{})
 ]);
 return {
  webhook:webhook.url===TELEGRAM_WEBHOOK_URL,
  commands:commandsMatch(commands),
  menu:menu.type==='commands',
  // This is informational only: historic delivery errors do not disprove
  // current configuration. Never expose Telegram update payloads.
  pending:Number(webhook.pending_update_count||0)
 };
}
export async function activateTelegramBot(token:string,secret:string,avatarJpegBase64:string):Promise<TelegramActivationResult>{
 await step('webhook',()=>telegramApi(token,'setWebhook',{
  url:TELEGRAM_WEBHOOK_URL,secret_token:secret,allowed_updates:['message','callback_query'],
  drop_pending_updates:false,max_connections:20
 }));
 const webhook=await step('webhook verification',()=>telegramApiResult<WebhookInfo>(token,'getWebhookInfo',{}));
 if(webhook.url!==TELEGRAM_WEBHOOK_URL)
  throw new TelegramSetupError('webhook verification','Telegram вернул другой адрес webhook.');

 const current=await step('commands read',()=>telegramApiResult<BotCommand[]>(token,'getMyCommands',{scope:PRIVATE_SCOPE}));
 if(!commandsMatch(current)){
  await step('commands',()=>telegramApi(token,'setMyCommands',{commands:TELEGRAM_COMMANDS,scope:PRIVATE_SCOPE}));
 }
 const checked=await step('commands verification',()=>telegramApiResult<BotCommand[]>(token,'getMyCommands',{scope:PRIVATE_SCOPE}));
 if(!commandsMatch(checked))
  throw new TelegramSetupError('commands verification','Список команд не совпадает с заданным.');

 const menu=await step('menu read',()=>telegramApiResult<MenuButton>(token,'getChatMenuButton',{}));
 if(menu.type!=='commands')await step('menu',()=>telegramApi(token,'setChatMenuButton',{menu_button:{type:'commands'}}));
 const confirmedMenu=await step('menu verification',()=>telegramApiResult<MenuButton>(token,'getChatMenuButton',{}));
 if(confirmedMenu.type!=='commands')
  throw new TelegramSetupError('menu verification','Telegram не подтвердил кнопку команд.');

 // Branding is not a prerequisite for the working webhook, commands and menu.
 // Repeated activation never fails because of an avatar or a localized name.
 const metadata=[
  ['Название по умолчанию',async()=>{
   const result=await telegramApiResult<BotName>(token,'getMyName',{});
   if(result.name!==BOT_NAME)await telegramApi(token,'setMyName',{name:BOT_NAME});
  }],
  ['Русское название',async()=>{
   const result=await telegramApiResult<BotName>(token,'getMyName',{language_code:'ru'});
   if(result.name!==BOT_NAME)await telegramApi(token,'setMyName',{name:BOT_NAME,language_code:'ru'});
  }],
  ['Краткое описание',async()=>{
   const result=await telegramApiResult<BotShortDescription>(token,'getMyShortDescription',{});
   if(result.short_description!==SHORT_DESCRIPTION)
    await telegramApi(token,'setMyShortDescription',{short_description:SHORT_DESCRIPTION});
  }],
  ['Описание бота',async()=>{
   const result=await telegramApiResult<BotDescription>(token,'getMyDescription',{});
   if(result.description!==DESCRIPTION)await telegramApi(token,'setMyDescription',{description:DESCRIPTION});
  }]
 ] as const;
 const outcomes=await Promise.allSettled([
  ...metadata.map(([,run])=>run()),
  ...(avatarJpegBase64?[telegramSetProfilePhoto(token,avatarJpegBase64)]:[])
 ]);
 const warnings=outcomes.flatMap((result,i)=>result.status==='rejected'
  ?[(metadata[i]?.[0]||'Эмблема')+': '+safeError(result.reason)]:[]);
 return {ok:true,webhook:true,commands:true,menu:true,logo:!!avatarJpegBase64&&outcomes.at(-1)?.status==='fulfilled',warnings};
}
