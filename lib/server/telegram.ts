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
export async function telegramApiResult<T>(token:string,method:string,payload:Record<string,unknown>):Promise<T>{
 const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
  method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),
  cache:'no-store',body:JSON.stringify(payload)
 });
 const data=await response.json() as {ok?:boolean;description?:string;result?:T};
 if(!response.ok||!data.ok||data.result===undefined)
  throw new Error('Telegram '+method+' failed: '+(data.description||'Unexpected API response'));
 return data.result;
}
export async function telegramApi(token:string,method:string,payload:Record<string,unknown>){
 await telegramApiResult<unknown>(token,method,payload);
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
/**
 * A Telegram profile photo must be a newly uploaded JPEG (never a URL/file_id).
 * The authorized teacher provides a JPEG rendered from the approved ID vector.
 * We verify JPEG structure and exact 1024×1024 dimensions before uploading.
 */
export async function telegramSetProfilePhoto(token:string,base64:string){
 if(typeof base64!=='string'||base64.length<1000||base64.length>1_000_000||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw new Error('Некорректные данные эмблемы ГОС.ID');
 const image=Buffer.from(base64,'base64');
 if(image.length<1000||image.length>750_000||image[0]!==0xff||image[1]!==0xd8||
    image[image.length-2]!==0xff||image[image.length-1]!==0xd9)
  throw new Error('Ожидается JPEG-эмблема ГОС.ID');
 let sizeOk=false;
 for(let offset=2;offset+10<image.length;){
  if(image[offset]!==0xff)break;
  while(image[offset]===0xff)offset++;
  const marker=image[offset++];
  if(marker===0xda||marker===0xd9)break;
  if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
  if(offset+2>image.length)break;
  const length=image.readUInt16BE(offset);
  if(length<2||offset+length>image.length)break;
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb].includes(marker)&&length>=7){
   sizeOk=image.readUInt16BE(offset+3)===1024&&image.readUInt16BE(offset+5)===1024;
   break;
  }
  offset+=length;
 }
 if(!sizeOk)throw new Error('Для бота необходима квадратная эмблема 1024 × 1024');
 const form=new FormData();
 form.append('photo',JSON.stringify({type:'static',photo:'attach://logo'}));
 form.append('logo',new Blob([new Uint8Array(image)],{type:'image/jpeg'}),'gos-id-1024.jpg');
 const response=await fetch('https://api.telegram.org/bot'+token+'/setMyProfilePhoto',{
  method:'POST',body:form,signal:AbortSignal.timeout(18000)
 });
 const data=await response.json() as {ok?:boolean;description?:string};
 if(!response.ok||!data.ok)throw new Error('Telegram rejected the approved brand image: '+(data.description||'Unknown error'));
}
