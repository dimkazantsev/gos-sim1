import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';

/** Preserve account files before any game-scoped Storage deletion.
 * Missing legacy files are left untouched; permissions/network errors fail closed.
 * Other teachers' private assets are protected by the server deletion trigger.
 */
export async function preserveOwnTeacherAssets(gameId:string,userId:string){
 const {data:profile,error}=await supabase.from('teacher_profiles')
  .select('avatar_path,signature_path').eq('user_id',userId).maybeSingle();
 if(error)throw Error('Не удалось проверить личные файлы: '+userError(error));
 if(!profile)return;
 for(const kind of ['avatar','signature'] as const){
  const field=kind==='avatar'?'avatar_path':'signature_path';
  const oldPath=profile[field];
  if(!oldPath||!oldPath.startsWith(gameId+'/'))continue;
  const result=await supabase.storage.from('game-assets').download(oldPath);
  if(result.error){
   const status=Number((result.error as {statusCode?:string|number}).statusCode);
   if(status===404)continue; // No physical file exists; DB guard independently checks this.
   throw Error('Не удалось сохранить '+(kind==='avatar'?'фотографию':'подпись')+': '+userError(result.error));
  }
  if(!result.data)throw Error('Файл личного профиля недоступен: '+oldPath);
  const suffix=kind==='avatar'?'webp':'png';
  const contentType=kind==='avatar'?'image/webp':'image/png';
  const filePath=userId+'/'+kind+'-'+crypto.randomUUID()+'.'+suffix;
  const storedPath='teacher-assets/'+filePath;
  const upload=await supabase.storage.from('teacher-assets').upload(filePath,result.data,{
   upsert:false,contentType
  });
  if(upload.error)throw Error('Не удалось перенести личный файл: '+userError(upload.error));
  const update=await supabase.from('teacher_profiles').update({[field]:storedPath,updated_at:new Date().toISOString()})
   .eq('user_id',userId).eq(field,oldPath).select(field).single();
  if(update.error||!update.data)throw Error('Не удалось подтвердить перенос личного файла: '+userError(update.error));
 }
}
