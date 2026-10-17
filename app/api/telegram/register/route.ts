import {NextResponse} from 'next/server';
import {runtimeConfig} from '@/lib/server/telegram';
import {activateTelegramBot,TelegramSetupError,telegramSetupStepLabel} from '@/lib/server/telegramActivation';
export const runtime='nodejs';
export const maxDuration=60;
// Only an authenticated active teacher may configure the production Telegram webhook.
export async function POST(request:Request){
 if(process.env.VERCEL_ENV!=='production')return NextResponse.json({error:'Доступно только в рабочей версии игры.'},{status:403});
 let config:ReturnType<typeof runtimeConfig>;
 try{config=runtimeConfig()}catch{return NextResponse.json({error:'Не настроены секретные переменные сервера.'},{status:503})}
 const header=request.headers.get('authorization')||'';
 if(!header.startsWith('Bearer '))return NextResponse.json({error:'Требуется вход в игру.'},{status:401});
 const {data:{user},error:authError}=await config.db.auth.getUser(header.slice(7));
 if(authError||!user)return NextResponse.json({error:'Невозможно проверить пользователя.'},{status:401});
 let gameId:string|undefined,avatarJpegBase64:string|undefined;
 try{
  const body=await request.json() as {gameId?:unknown;avatarJpegBase64?:unknown};
  gameId=typeof body.gameId==='string'?body.gameId:undefined;
  avatarJpegBase64=typeof body.avatarJpegBase64==='string'?body.avatarJpegBase64:undefined;
 }catch{}
 if(!gameId||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameId))
 return NextResponse.json({error:'Не указана игра.'},{status:400});
 const {data:member,error:memberError}=await config.db.from('game_members').select('kind').eq('game_id',gameId).eq('user_id',user.id).is('roster_archived_at',null).maybeSingle();
 if(memberError||member?.kind!=='teacher')return NextResponse.json({error:'Только преподаватель может активировать бота.'},{status:403});
 try{
  const result=await activateTelegramBot(config.token,config.secret,avatarJpegBase64||'');
  return NextResponse.json(result);
 }catch(e){
  const stage=e instanceof TelegramSetupError?e.step:'unknown';
  const reason=e instanceof TelegramSetupError?e.message:'Не удалось завершить регистрацию Телеграма.';
  console.error('Telegram activation failed at',stage);
  return NextResponse.json({
   ok:false,stage,reason,
   error:'Настройка Телеграма не завершена ('+telegramSetupStepLabel(stage)+'): '+reason
  },{status:502});
 }
}
