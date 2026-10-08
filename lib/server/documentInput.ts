import {createClient} from '@supabase/supabase-js';
import {Worker} from 'node:worker_threads';
import path from 'node:path';
import config from '@/public-client-config.json';

export const DOCUMENT_MAX_BYTES=10*1024*1024;
const DOCUMENT_TEXT_LIMIT=120000;
const PARSER_TIMEOUT_MS=10000;

export class DocumentInputError extends Error{
 constructor(message:string,readonly status=422){super(message);this.name='DocumentInputError';}
}

export function documentCors(request:Request):Record<string,string>{
 const origin=request.headers.get('origin');
 return origin==='https://dimkazantsev.github.io'?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{'Vary':'Origin'};
}

export async function documentClient(request:Request){
 const authorization=request.headers.get('authorization');
 const token=authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
 if(!token)throw new DocumentInputError('Войдите в игру для работы с документами.',401);
 const client=createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL||config.url,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||config.publishableKey,
  {global:{headers:{Authorization:'Bearer '+token},fetch:(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)})},auth:{persistSession:false,autoRefreshToken:false}}
 );
 const auth=await client.auth.getUser(token);
 if(auth.error||!auth.data.user)throw new DocumentInputError('Сессия истекла. Войдите снова.',401);
 return {client,userId:auth.data.user.id};
}

// Check the whole stream before multipart or JSON parsing, including ignored fields.
export async function readDocumentBody(request:Request,maxBytes:number){
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))
  throw new DocumentInputError('Превышен допустимый размер запроса.',413);
 const reader=request.body?.getReader();
 if(!reader)throw new DocumentInputError('Пустой запрос.',400);
 const chunks:Uint8Array[]=[];let size=0;
 try{
  while(true){
   const next=await reader.read();if(next.done)break;
   size+=next.value.byteLength;
   if(size>maxBytes){await reader.cancel();throw new DocumentInputError('Превышен допустимый размер запроса.',413);}
   chunks.push(next.value);
  }
 }finally{reader.releaseLock();}
 const body=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
 return body;
}

export type DocumentText={text:string;truncated:boolean;needsManualText:boolean;pages?:number};
export async function parseDocument(bytes:Uint8Array,kind:'txt'|'docx'|'pdf'):Promise<DocumentText>{
 if(bytes.byteLength>DOCUMENT_MAX_BYTES)throw new DocumentInputError('Документ больше 10 МБ.',413);
 if(kind==='txt'){
  const text=new TextDecoder().decode(bytes).replace(/\u0000/g,'').replace(/\r\n/g,'\n').trim();
  return {text:text.slice(0,DOCUMENT_TEXT_LIMIT),truncated:text.length>DOCUMENT_TEXT_LIMIT,needsManualText:!text};
 }
 // A malformed parser input must not take down the request's main JS thread.
 const worker=new Worker(path.join(process.cwd(),'lib/server/document-parser.worker.cjs'),{
  workerData:{bytes,kind,textLimit:DOCUMENT_TEXT_LIMIT,mammothPath:require.resolve('mammoth'),unpdfPath:require.resolve('unpdf')},
  resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}
 });
 return new Promise((resolve,reject)=>{
  let finished=false;
  const complete=(result?:DocumentText,error?:Error)=>{
   if(finished)return;finished=true;clearTimeout(timer);void worker.terminate();
   if(error)reject(error);else resolve(result!);
  };
  const timer=setTimeout(()=>complete(undefined,new DocumentInputError('Документ слишком сложный для автоматического чтения. Вставьте текст вручную.')),PARSER_TIMEOUT_MS);
  worker.once('message',(result:{ok:boolean;value?:DocumentText})=>result.ok&&result.value
   ?complete(result.value):complete(undefined,new DocumentInputError('Не удалось прочитать документ в допустимых пределах. Вставьте текст вручную.')));
  worker.once('error',()=>complete(undefined,new DocumentInputError('Не удалось прочитать документ. Вставьте текст вручную.')));
  worker.once('exit',()=>{if(!finished)complete(undefined,new DocumentInputError('Обработка документа прервана. Вставьте текст вручную.'));});
 });
}
