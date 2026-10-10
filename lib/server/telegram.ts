import {createClient} from '@supabase/supabase-js';
export const runtimeConfig=()=>{
 const token=process.env.TELEGRAM_BOT_TOKEN,secret=process.env.TELEGRAM_WEBHOOK_SECRET;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.Supa);
 if(!token||!secret||!url||!key)throw new Error('Telegram environment variables are not configured');
 return {token,secret,db:createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})};
};
export async function telegramSend(token:string,chatId:number|string,text:string){
 const result=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,link_preview_options:{is_disabled:true}})});
 const data=await result.json() as {ok:boolean;description?:string};
 if(!result.ok||!data.ok)throw new Error(data.description||'Telegram sendMessage failed');
}
export function gameUrl(gameId:string){return (process.env.NEXT_PUBLIC_GAME_URL||'https://gos-sim1.vercel.app').replace(/\/$/,'')+'/game/'+encodeURIComponent(gameId);}
