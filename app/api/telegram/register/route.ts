import {NextResponse} from 'next/server';
import {runtimeConfig,telegramApi} from '@/lib/server/telegram';
import {TELEGRAM_COMMANDS} from '@/lib/server/telegramPresentation';
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
  await telegramApi(config.token,'setWebhook',{
   url:webhook,secret_token:config.secret,allowed_updates:['message','callback_query'],
   drop_pending_updates:false,max_connections:20
  });
  // Native Telegram Menu button remains available in every private chat.
  // Registration is teacher-authorized, repeatable, and does not mutate game data.
  await telegramApi(config.token,'setMyName',{name:'ГОС.ID',language_code:''});
  // Reapply for Russian clients, including users who had a localized bot name.
  await telegramApi(config.token,'setMyName',{name:'ГОС.ID',language_code:'ru'});
  await telegramApi(config.token,'setMyCommands',{
   commands:TELEGRAM_COMMANDS,scope:{type:'all_private_chats'}
  });
  await telegramApi(config.token,'setChatMenuButton',{
   menu_button:{type:'commands'}
  });
  await telegramApi(config.token,'setMyShortDescription',{
   short_description:'🏛 ГОС.ID — Цифровая платформа России. События, решения, этапы и голосования.'
  });
  await telegramApi(config.token,'setMyDescription',{
   description:'🏛 ГОС.ID — Цифровая платформа России.\n\nПолучайте уведомления о жизни республики, следите за государственными решениями, голосованиями, этапами и документами.\n\n🚀 Нажмите «Начать», чтобы открыть меню.\n🔐 Для игровых уведомлений привяжите Telegram в личном профиле ГОС.ID.'
  });
  return NextResponse.json({ok:true,url:webhook,menu:true});
 }catch(e){console.error('Telegram setup failed',e instanceof Error?e.message:'unknown');return NextResponse.json({error:'Telegram не подтвердил полную настройку webhook и меню. Повторите активацию.'},{status:502})}
}
