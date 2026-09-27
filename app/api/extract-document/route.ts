import {NextResponse} from 'next/server';

export const runtime='nodejs';

export async function POST(request:Request){
  try{
    const form=await request.formData();
    const file=form.get('file');
    if(!(file instanceof File))return NextResponse.json({error:'Файл не передан'},{status:400});
    if(file.size>10*1024*1024)return NextResponse.json({error:'Файл больше 10 МБ'},{status:413});

    const name=file.name.toLowerCase();
    const type=file.type;
    if(type==='text/plain'||name.endsWith('.txt')){
      const text=(await file.text()).replace(/\u0000/g,'').replace(/\r\n/g,'\n').trim();
      return NextResponse.json({text:text.slice(0,120000),truncated:text.length>120000});
    }

    return NextResponse.json({
      text:'',
      fileName:file.name,
      needsManualText:true,
      message:'Файл прикреплён. Для PDF/DOCX текст можно вставить в редактор; тип документа будет распознан по названию и введённому тексту.'
    });
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Не удалось обработать документ'},{status:500});
  }
}
