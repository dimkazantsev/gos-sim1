import {createClient} from '@supabase/supabase-js';
import {telegramMessageHtml,TELEGRAM_BACK_BUTTONS} from './telegramPresentation';
import type {TelegramMarkup} from './telegramPresentation';
export const runtimeConfig=()=>{
 const token=process.env.TELEGRAM_BOT_TOKEN,secret=process.env.TELEGRAM_WEBHOOK_SECRET;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY);
 if(!token||!secret||!url||!key)throw new Error('Telegram environment variables are not configured');
 return {token,secret,db:createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})};
};
/** No token, secret or user content is written to logs by these helpers. */
export async function telegramApi(token:string,method:string,payload:Record<string,unknown>){
 const result=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
  method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),
  cache:'no-store',body:JSON.stringify(payload)
 });
 const data=await result.json() as {ok?:boolean;description?:string};
 if(!result.ok||!data.ok)throw new Error('Telegram '+method+' failed: '+(data.description||'Unknown error'));
}
export async function telegramSend(token:string,chatId:number|string,text:string,replyMarkup:TelegramMarkup=TELEGRAM_BACK_BUTTONS){
 await telegramApi(token,'sendMessage',{
  chat_id:chatId,text:telegramMessageHtml(text),parse_mode:'HTML',
  link_preview_options:{is_disabled:true},reply_markup:replyMarkup
 });
}
export async function telegramAcknowledge(token:string,callbackId:string){
 await telegramApi(token,'answerCallbackQuery',{callback_query_id:callbackId});
}
export function gameUrl(gameId:string){return (process.env.NEXT_PUBLIC_GAME_URL||'https://gos-sim1.vercel.app').replace(/\/$/,'')+'/game/'+encodeURIComponent(gameId);}
