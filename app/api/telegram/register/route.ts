import {NextResponse} from 'next/server';
import {runtimeConfig} from '@/lib/server/telegram';
export const runtime='nodejs';
// Only an authenticated active teacher may configure the production Telegram webhook.
export async function POST(request:Request){
 if(process.env.VERCEL_ENV!=='production')return NextResponse.json({error:'Доступно только в рабочей версии игры.'},{status:403});
 let config:ReturnType<typeof runtimeConfig>;
 try{config=runtimeConfig()}catch{return NextResponse.json({error:'Не настроены секретные переменные сервера.'},{status:503})}
 const header=request.headers.get('authorization')||'';
 if(!header.startsWith('Bearer '))return NextResponse.json({error:'Требуется вход в игру.'},{status:401});
 const {data:{user},error:authError}=await config.db.auth.getUser(header.slice(7));
 if(authError||!user)return NextResponse.json({error:'Невозможно проверить пользователя.'},{status:401});
 let gameId:string|undefined;
 try{const body=await request.json() as {gameId?:unknown};gameId=typeof body.gameId==='string'?body.gameId:undefined}catch{}
 if(!gameId||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameId))
 return NextResponse.json({error:'Не указана игра.'},{status:400});
 const {data:member,error:memberError}=await config.db.from('game_members').select('kind').eq('game_id',gameId).eq('user_id',user.id).is('roster_archived_at',null).maybeSingle();
 if(memberError||member?.kind!=='teacher')return NextResponse.json({error:'Только преподаватель может активировать бота.'},{status:403});
 const webhook='https://gos-sim1.vercel.app/api/telegram/webhook';
 try{
  const response=await fetch('https://api.telegram.org/bot'+config.token+'/setWebhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:webhook,secret_token:config.secret,allowed_updates:['message'],drop_pending_updates:false,max_connections:20}),cache:'no-store'});
  const json=await response.json() as {ok?:boolean;description?:string};
  if(!response.ok||!json.ok)throw new Error('Telegram API rejected the webhook: '+(json.description||'Unknown error'));
  return NextResponse.json({ok:true,url:webhook});
 }catch(e){console.error('Telegram webhook configuration failed',e instanceof Error?e.message:'unknown');return NextResponse.json({error:'Telegram не подтвердил настройку webhook.'},{status:502})}
}
