import {NextResponse} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {extractText} from 'unpdf';
import mammoth from 'mammoth';
import config from '@/public-client-config.json';
export const runtime='nodejs';
function cors(request:Request):Record<string,string>{const origin=request.headers.get('origin');return origin==='https://dimkazantsev.github.io'?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{}}
export async function OPTIONS(request:Request){return new Response(null,{status:204,headers:{...cors(request),'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'}})}
const allowed=(hostname:string)=>hostname==='docs.google.com'||hostname==='drive.google.com'||hostname==='cloud-api.yandex.net'||hostname.endsWith('.googleusercontent.com')||hostname.endsWith('.yandex.net')||hostname.endsWith('.yandex.ru')||hostname.endsWith('.yandex.com');
async function boundedFetch(raw:string){
 let url=new URL(raw);
 for(let redirects=0;redirects<5;redirects++){
  if(url.protocol!=='https:'||url.username||url.password||!allowed(url.hostname))throw Error('Провайдер вернул неподдерживаемый адрес.');
  const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(12000),cache:'no-store'});
  if(r.status>=300&&r.status<400){const to=r.headers.get('location');if(!to)throw Error('Нет ссылки на экспорт документа.');url=new URL(to,url);continue}
  if(!r.ok)throw Error('Документ недоступен. Разрешите доступ по ссылке или загрузите файл вручную.');
  if(Number(r.headers.get('content-length')||0)>10*1024*1024)throw Error('Документ больше 10 МБ.');
  const reader=r.body?.getReader();if(!reader)throw Error('Пустой ответ провайдера.');const chunks:Uint8Array[]=[];let size=0;
  while(true){const n=await reader.read();if(n.done)break;size+=n.value.length;if(size>10*1024*1024){await reader.cancel();throw Error('Документ больше 10 МБ.')}chunks.push(n.value)}
  const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length}return {bytes,type:r.headers.get('content-type')||'',disposition:r.headers.get('content-disposition')||''};
 }
 throw Error('Слишком много переходов при экспорте документа.');
}
export async function POST(request:Request){
 const headers=cors(request);
 try{
  const token=request.headers.get('authorization')?.replace(/^Bearer /i,'');if(!token)return NextResponse.json({error:'Войдите в игру для импорта документа.'},{status:401,headers});
  const client=createClient(config.url,config.publishableKey,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await client.auth.getUser(token);if(auth.error||!auth.data.user)return NextResponse.json({error:'Сессия истекла. Войдите снова.'},{status:401,headers});
  const input=await request.json();if(typeof input.linkId!=='string')return NextResponse.json({error:'Выберите сохранённый документ.'},{status:400,headers});
  const query=await client.from('profile_document_links').select('id,title,url,provider').eq('id',input.linkId).eq('user_id',auth.data.user.id).single();
  if(query.error||!query.data)return NextResponse.json({error:'Ссылка не найдена в вашем профиле.'},{status:404,headers});
  const link=query.data,u=new URL(link.url);let payload;
  if(link.provider==='google'){
   const id=u.pathname.match(/\/document\/d\/([\w-]+)/)?.[1];
   if(!id)throw Error('Выберите ссылку Google Документа формата docs.google.com/document/d/… или загрузите экспортированный файл.');
   payload=await boundedFetch('https://docs.google.com/document/d/'+id+'/export?format=txt');
  }else{
   const response=await boundedFetch('https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key='+encodeURIComponent(link.url));
   const result=JSON.parse(new TextDecoder().decode(response.bytes));if(typeof result.href!=='string')throw Error('Яндекс не предоставил публичный экспорт. Включите доступ по ссылке либо загрузите PDF/DOCX.');
   payload=await boundedFetch(result.href);
  }
  let text='';
  if(payload.type.includes('pdf')||new TextDecoder().decode(payload.bytes.slice(0,5))==='%PDF-')text=(await extractText(payload.bytes,{mergePages:true})).text;
  else if(payload.bytes[0]===80&&payload.bytes[1]===75)text=(await mammoth.extractRawText({buffer:Buffer.from(payload.bytes)})).value;
  else if(payload.type.includes('html'))throw Error('Провайдер вернул страницу входа. Для импорта нужен публичный текст или экспорт PDF/DOCX.');
  else text=new TextDecoder().decode(payload.bytes);
  text=text.replace(/\u0000/g,'').trim();if(!text)throw Error('В документе нет текстового слоя. Загрузите файл и введите текст вручную.');
  return NextResponse.json({title:link.title,text:text.slice(0,120000),provider:link.provider,url:link.url,truncated:text.length>120000},{headers});
 }catch(error){return NextResponse.json({error:error instanceof Error&&/[А-Яа-яЁё]/.test(error.message)?error.message:'Не удалось импортировать документ. Проверьте общий доступ и формат файла.'},{status:422,headers})}
}
