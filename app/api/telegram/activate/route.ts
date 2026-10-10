import {NextResponse} from 'next/server';
import {POST as registerWebhook} from '../register/route';

export const runtime='nodejs';
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
 return new Response(null,{status:204,headers:{...cors(request),'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type',...noStore}});
}

// Public method probe: never includes secrets or private information.
export function GET(request:Request){
 return NextResponse.json({ok:true,method:'POST',service:'telegram-activation'},{headers:{...cors(request),...noStore}});
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
