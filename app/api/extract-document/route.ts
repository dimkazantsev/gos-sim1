import {NextResponse} from 'next/server';
import {extractText} from 'unpdf';
import mammoth from 'mammoth';
export const runtime='nodejs';
export async function POST(request:Request){
 try{
  const form=await request.formData(),file=form.get('file');
  if(!(file instanceof File))return NextResponse.json({error:'Файл не передан.'},{status:400});
  if(file.size>10*1024*1024)return NextResponse.json({error:'Файл больше 10 МБ.'},{status:413});
  const name=file.name.toLowerCase();let text='';
  if(file.type==='text/plain'||name.endsWith('.txt'))text=await file.text();
  else if(name.endsWith('.docx'))text=(await mammoth.extractRawText({buffer:Buffer.from(await file.arrayBuffer())})).value;
  else if(name.endsWith('.pdf'))text=(await extractText(new Uint8Array(await file.arrayBuffer()),{mergePages:true})).text;
  else return NextResponse.json({error:'Загрузите PDF, DOCX или TXT.'},{status:415});
  text=text.replace(/\u0000/g,'').replace(/\r\n/g,'\n').trim();
  return NextResponse.json({text:text.slice(0,120000),truncated:text.length>120000,needsManualText:!text,message:!text?'В документе нет текстового слоя. Вставьте текст в редактор; скан сохранён как приложение.':undefined});
 }catch{return NextResponse.json({error:'Не удалось прочитать документ. Проверьте формат и защиту файла; при необходимости вставьте текст вручную.'},{status:422})}
}
