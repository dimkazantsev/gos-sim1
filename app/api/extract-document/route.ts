import {NextResponse} from 'next/server';
import {DOCUMENT_MAX_BYTES,DocumentInputError,documentClient,documentCors,parseDocument,readDocumentBody} from '@/lib/server/documentInput';

export const runtime='nodejs';
export const maxDuration=40;

export async function OPTIONS(request:Request){
 return new Response(null,{status:204,headers:{...documentCors(request),'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Cache-Control':'no-store'}});
}
export async function POST(request:Request){
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{...documentCors(request),'Cache-Control':'no-store'}});
 try{
  const {client,userId}=await documentClient(request);
  const member=await client.from('game_members').select('game_id').eq('user_id',userId).is('roster_archived_at',null).neq('kind','observer').limit(1).maybeSingle();
  if(member.error||!member.data)throw new DocumentInputError('Работа с документами доступна действующим участникам игры.',403);
  const bytes=await readDocumentBody(request,DOCUMENT_MAX_BYTES+128*1024);
  const bounded=new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('content-type')||''},body:Buffer.from(bytes)});
  const form=await bounded.formData(),file=form.get('file');
  if(!(file instanceof File))throw new DocumentInputError('Файл не передан.',400);
  if(file.size>DOCUMENT_MAX_BYTES)throw new DocumentInputError('Файл больше 10 МБ.',413);
  const name=file.name.toLowerCase();
  const kind=name.endsWith('.docx')?'docx':name.endsWith('.pdf')?'pdf':file.type==='text/plain'||name.endsWith('.txt')?'txt':null;
  if(!kind)throw new DocumentInputError('Загрузите PDF, DOCX или TXT.',415);
  const result=await parseDocument(new Uint8Array(await file.arrayBuffer()),kind);
  return json({...result,message:result.needsManualText?'В документе нет текстового слоя. Вставьте текст в редактор; скан сохранён как приложение.':undefined});
 }catch(error){
  return json({error:error instanceof DocumentInputError?error.message:'Не удалось прочитать документ. Проверьте формат и защиту файла; при необходимости вставьте текст вручную.'},error instanceof DocumentInputError?error.status:422);
 }
}
