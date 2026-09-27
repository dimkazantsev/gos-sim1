import {NextResponse} from 'next/server';
import mammoth from 'mammoth';
import {extractText,getDocumentProxy} from 'unpdf';

export const runtime='nodejs';

export async function POST(request:Request){
  try{
    const form=await request.formData();
    const file=form.get('file');
    if(!(file instanceof File))return NextResponse.json({error:'Файл не передан'},{status:400});
    if(file.size>10*1024*1024)return NextResponse.json({error:'Файл больше 10 МБ'},{status:413});

    const name=file.name.toLowerCase();
    const type=file.type;
    const ab=await file.arrayBuffer();
    let text='';
    let pages:number|undefined;

    if(type==='text/plain'||name.endsWith('.txt')){
      text=new TextDecoder('utf-8').decode(ab);
    }else if(type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'||name.endsWith('.docx')){
      const result=await mammoth.extractRawText({buffer:Buffer.from(ab)});
      text=result.value||'';
    }else if(type==='application/pdf'||name.endsWith('.pdf')){
      const pdf=await getDocumentProxy(new Uint8Array(ab));
      if(pdf.numPages>60)return NextResponse.json({error:'PDF содержит больше 60 страниц. Сократите документ или вставьте текст вручную.'},{status:422});
      const result=await extractText(pdf,{mergePages:true});
      pages=result.totalPages;
      text=typeof result.text==='string'?result.text:result.text.join('\n');
    }else{
      return NextResponse.json({error:'Автоматическое распознавание поддерживает PDF, DOCX и TXT. Файл можно загрузить и дополнительно вставить текст вручную.'},{status:415});
    }

    text=text.replace(/\u0000/g,'').replace(/\r\n/g,'\n').trim();
    return NextResponse.json({text:text.slice(0,120000),pages,truncated:text.length>120000});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Не удалось распознать документ'},{status:500});
  }
}
