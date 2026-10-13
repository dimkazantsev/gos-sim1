import {NextResponse} from 'next/server';
import {POST as registerWebhook} from '../register/route';
import {runtimeConfig} from '@/lib/server/telegram';
import {verifyTelegramBot} from '@/lib/server/telegramActivation';

export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';

const ALLOWED_ORIGINS=new Set(['https://dimkazantsev.github.io','https://gos-sim1.vercel.app']);
function cors(request:Request):Record<string,string>{
 const origin=request.headers.get('origin');
 return origin&&ALLOWED_ORIGINS.has(origin)
  ?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}
  :{'Vary':'Origin'};
}
const noStore={'Cache-Control':'no-store'};

export function OPTIONS(request:Request){
 const origin=request.headers.get('origin');
 if(origin&&!ALLOWED_ORIGINS.has(origin))
   return NextResponse.json({error:'Недоверенный источник запроса.'},{status:403,headers:noStore});
 return new Response(null,{status:204,headers:{...cors(request),'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type',...noStore}});
}

// Without credentials this remains a public method probe. The detailed
// verification is restricted to an authenticated active game teacher.
export async function GET(request:Request){
 const query=new URL(request.url).searchParams;
 const gameId=query.get('gameId');
 if(!gameId)return NextResponse.json({ok:true,method:'POST',service:'telegram-activation'},{headers:{...cors(request),...noStore}});
 const origin=request.headers.get('origin');
 if(origin&&!ALLOWED_ORIGINS.has(origin))
  return NextResponse.json({error:'Недоверенный источник запроса.'},{status:403,headers:noStore});
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(gameId))
  return NextResponse.json({error:'Неверный идентификатор игры.'},{status:400,headers:{...cors(request),...noStore}});
 let config:ReturnType<typeof runtimeConfig>;
 try{config=runtimeConfig()}catch{return NextResponse.json({error:'Telegram не настроен на сервере.'},{status:503,headers:{...cors(request),...noStore}})}
 const auth=request.headers.get('authorization')||'';
 if(!auth.startsWith('Bearer '))return NextResponse.json({error:'Необходимо войти.'},{status:401,headers:{...cors(request),...noStore}});
 const {data:{user},error}=await config.db.auth.getUser(auth.slice(7));
 if(error||!user)return NextResponse.json({error:'Не удалось проверить пользователя.'},{status:401,headers:{...cors(request),...noStore}});
 const {data:member,error:memberError}=await config.db.from('game_members').select('kind')
  .eq('game_id',gameId).eq('user_id',user.id).is('roster_archived_at',null).maybeSingle();
 if(memberError||member?.kind!=='teacher')
  return NextResponse.json({error:'Доступно только преподавателю.'},{status:403,headers:{...cors(request),...noStore}});
 try{
  const result=await verifyTelegramBot(config.token);
  return NextResponse.json({ok:true,...result},{headers:{...cors(request),...noStore}});
 }catch{
  return NextResponse.json({error:'Не удалось получить подтверждение Telegram API.'},{status:502,headers:{...cors(request),...noStore}});
 }
}

export async function POST(request:Request){
 const origin=request.headers.get('origin');
 if(origin&&!ALLOWED_ORIGINS.has(origin))
   return NextResponse.json({error:'Недоверенный источник запроса.'},{status:403,headers:noStore});
 const response=await registerWebhook(request);
 const headers=new Headers(response.headers);
 for(const [key,value] of Object.entries({...cors(request),...noStore}))headers.set(key,value);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
