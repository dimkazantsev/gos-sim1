import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {resolveStoredAsset} from '@/lib/resolveStoredAsset';

export type TeacherAssetKind='avatar'|'signature';

export async function teacherAssetUrl(path:string|null|undefined):Promise<string|null>{
 if(!path)return null;
 const location=resolveStoredAsset('game-assets',path);
 const {data,error}=await supabase.storage.from(location.bucket).createSignedUrl(location.path,3600);
 if(error)return null;
 return data?.signedUrl||null;
}

/** Saves against auth.uid(), never against a game_id.
 * Supabase RLS enforces identity and permitted object type/size.
 * Old images remain available for already-signed documents.
 */
export async function savePermanentTeacherAsset(userId:string,file:File,kind:TeacherAssetKind){
 if(file.size===0||file.size>(kind==='avatar'?5:2)*1024*1024)throw Error('Неверный размер изображения.');
 if(file.type!==(kind==='avatar'?'image/webp':'image/png'))throw Error('Неверный формат изображения.');
 const path=userId+'/'+kind+'-'+crypto.randomUUID()+'.'+(kind==='avatar'?'webp':'png');
 const asset='teacher-assets/'+path,field=kind==='avatar'?'avatar_path':'signature_path';
 const upload=await supabase.storage.from('teacher-assets').upload(path,file,{
  upsert:false,contentType:file.type
 });
 if(upload.error)throw Error('Не удалось загрузить файл: '+userError(upload.error));
 const r=await supabase.from('teacher_profiles')
  .update({[field]:asset,updated_at:new Date().toISOString()})
  .eq('user_id',userId).select(field).single();
 if(r.error||!r.data){
  // Only the brand-new unreferenced object may be removed.
  await supabase.storage.from('teacher-assets').remove([path]);
  throw Error('Файл не привязан к постоянному профилю: '+userError(r.error));
 }
 return {path:asset,url:await teacherAssetUrl(asset)};
}
