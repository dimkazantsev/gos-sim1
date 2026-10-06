export type DocumentExtractionStatus='extracted'|'no_text'|'unsupported'|'error';

export async function extractCandidateDocumentText(file:File):Promise<{text:string;status:DocumentExtractionStatus;note:string}>{
 const name=file.name.toLowerCase();
 try{
  if(file.type.startsWith('text/')||name.endsWith('.txt')){
   const text=(await file.text()).trim();
   return {text,status:text.length>=20?'extracted':'no_text',note:text.length>=20?'Текст распознан из текстового файла.':'В файле почти нет распознаваемого текста.'};
  }
  if(name.endsWith('.docx')||file.type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'){
   const mammoth=await import('mammoth');
   const result=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
   const text=String(result.value||'').trim();
   return {text,status:text.length>=20?'extracted':'no_text',note:text.length>=20?'Текст извлечён из DOCX.':'В DOCX почти нет распознаваемого текста.'};
  }
  if(name.endsWith('.pdf')||file.type==='application/pdf'){
   const {extractText,getDocumentProxy}=await import('unpdf');
   const pdf=await getDocumentProxy(new Uint8Array(await file.arrayBuffer()),{maxImageSize:16_777_216});
   if(pdf.numPages>80)return {text:'',status:'error',note:'PDF слишком большой для автоматической проверки: более 80 страниц.'};
   const extracted=await Promise.race([
    extractText(pdf,{mergePages:true}),
    new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('timeout')),15000))
   ]);
   const text=String(extracted.text||'').trim();
   return {text,status:text.length>=20?'extracted':'no_text',note:text.length>=20?'Текст извлечён из PDF.':'PDF не содержит достаточного текстового слоя. Вставьте текст вручную или загрузите текстовый PDF.'};
  }
  if(name.endsWith('.doc'))return {text:'',status:'unsupported',note:'Старый формат DOC не разбирается автоматически. Сохраните документ как DOCX/PDF или вставьте текст вручную.'};
  if(file.type.startsWith('image/'))return {text:'',status:'unsupported',note:'Для изображения автоматическое OCR в этой версии не выполняется. Вставьте распознанный текст вручную для проверки.'};
  return {text:'',status:'unsupported',note:'Формат не поддерживает автоматическое извлечение текста. Вставьте текст документа вручную.'};
 }catch{
  return {text:'',status:'error',note:'Не удалось извлечь текст автоматически. Файл сохранён; текст можно вставить вручную.'};
 }
}
