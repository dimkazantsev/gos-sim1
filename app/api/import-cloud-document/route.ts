import {NextResponse} from 'next/server';
import {DOCUMENT_MAX_BYTES,DocumentInputError,documentClient,documentCors,parseDocument,readDocumentBody} from '@/lib/server/documentInput';
export const runtime='nodejs';
export const maxDuration=40;

const allowed=(hostname:string)=>hostname==='docs.google.com'||hostname==='drive.google.com'||hostname==='cloud-api.yandex.net'||hostname.endsWith('.googleusercontent.com')||hostname.endsWith('.yandex.net')||hostname.endsWith('.yandex.ru')||hostname.endsWith('.yandex.com');
async function boundedFetch(raw:string,deadline:number){
 let url=new URL(raw);
 for(let redirects=0;redirects<5;redirects++){
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!allowed(url.hostname))throw new DocumentInputError('Провайдер вернул неподдерживаемый адрес.');
  const remaining=deadline-Date.now();if(remaining<=0)throw new DocumentInputError('Экспорт документа занял слишком много времени. Загрузите файл вручную.');
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(Math.min(12000,remaining)),cache:'no-store'});
  if(response.status>=300&&response.status<400){
   const target=response.headers.get('location');if(!target)throw new DocumentInputError('Нет ссылки на экспорт документа.');
   await response.body?.cancel();url=new URL(target,url);continue;
  }
  if(!response.ok){await response.body?.cancel();throw new DocumentInputError('Документ недоступен. Разрешите доступ по ссылке или загрузите файл вручную.');}
  const bytes=await readDocumentBody(new Request(url,{method:'POST',headers:response.headers,body:response.body,duplex:'half'} as RequestInit),DOCUMENT_MAX_BYTES);
  return {bytes,type:response.headers.get('content-type')||''};
 }
 throw new DocumentInputError('Слишком много переходов при экспорте документа.');
}
export async function OPTIONS(request:Request){
 return new Response(null,{status:204,headers:{...documentCors(request),'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Cache-Control':'no-store'}});
}
export async function POST(request:Request){
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{...documentCors(request),'Cache-Control':'no-store'}});
 try{
  const {client,userId}=await documentClient(request);
  const active=await client.from('game_members').select('game_id').eq('user_id',userId).is('roster_archived_at',null).neq('kind','observer').limit(1).maybeSingle();
  if(active.error||!active.data)throw new DocumentInputError('Работа с документами доступна действующим участникам игры.',403);
  const input=JSON.parse(new TextDecoder().decode(await readDocumentBody(request,16*1024)));
  if(!input||typeof input.linkId!=='string'||!/^[a-f0-9-]{36}$/i.test(input.linkId))throw new DocumentInputError('Выберите сохранённый документ.',400);
  const query=await client.from('profile_document_links').select('id,game_id,title,url,provider').eq('id',input.linkId).eq('user_id',userId).single();
  if(query.error||!query.data)throw new DocumentInputError('Ссылка не найдена в вашем профиле.',404);
  const link=query.data;
  const member=await client.from('game_members').select('game_id').eq('game_id',link.game_id).eq('user_id',userId).is('roster_archived_at',null).neq('kind','observer').maybeSingle();
  if(member.error||!member.data)throw new DocumentInputError('Вы больше не участвуете в этой игре.',403);
  const url=new URL(link.url),deadline=Date.now()+25000;let payload;
  if(link.provider==='google'){
   const id=url.hostname==='docs.google.com'?url.pathname.match(/\/document\/d\/([\w-]+)/)?.[1]:null;
   if(!id)throw new DocumentInputError('Выберите ссылку Google Документа формата docs.google.com/document/d/… или загрузите экспортированный файл.');
   payload=await boundedFetch('https://docs.google.com/document/d/'+id+'/export?format=txt',deadline);
  }else if(link.provider==='yandex'){
   const response=await boundedFetch('https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key='+encodeURIComponent(link.url),deadline);
   const result=JSON.parse(new TextDecoder().decode(response.bytes));
   if(typeof result.href!=='string')throw new DocumentInputError('Яндекс не предоставил публичный экспорт. Включите доступ по ссылке либо загрузите PDF/DOCX.');
   payload=await boundedFetch(result.href,deadline);
  }else throw new DocumentInputError('Неподдерживаемый провайдер документа.',415);
  const type=payload.type.split(';')[0].trim().toLowerCase();
  const kind=type==='application/pdf'||Buffer.from(payload.bytes.slice(0,1024)).includes(Buffer.from('%PDF-'))?'pdf':
   payload.bytes[0]===80&&payload.bytes[1]===75?'docx':type==='text/plain'?'txt':null;
  if(!kind)throw new DocumentInputError(type==='text/html'?'Провайдер вернул страницу входа. Для импорта нужен публичный текст или экспорт PDF/DOCX.':'Загрузите PDF, DOCX или TXT.',415);
  const result=await parseDocument(payload.bytes,kind);
  if(result.needsManualText)throw new DocumentInputError('В документе нет текстового слоя. Загрузите файл и введите текст вручную.');
  return json({title:link.title,...result,provider:link.provider,url:link.url});
 }catch(error){return json({error:error instanceof DocumentInputError?error.message:'Не удалось импортировать документ. Проверьте общий доступ и формат файла.'},error instanceof DocumentInputError?error.status:422);}
}
