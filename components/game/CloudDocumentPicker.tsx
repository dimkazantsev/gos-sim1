'use client';
import {useEffect,useState} from 'react';
import {Download,ExternalLink,FolderOpen} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import StyledSelect from '../ui/StyledSelect';
type Link={id:string;title:string;url:string;provider:string};
export default function CloudDocumentPicker({gameId,userId,disabled,onImport}:{gameId?:string;userId?:string;disabled?:boolean;onImport:(title:string,text:string,url:string)=>void}){
 const [links,setLinks]=useState<Link[]>([]),[id,setId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{if(!gameId||!userId)return;let live=true;void supabase.from('profile_document_links').select('id,title,url,provider').eq('game_id',gameId).eq('user_id',userId).order('created_at',{ascending:false}).then(r=>{if(live&&!r.error)setLinks((r.data||[]) as Link[])});return()=>{live=false}},[gameId,userId]);
 const selected=links.find(x=>x.id===id);
 async function importDocument(){
  if(disabled||busy||!selected)return;setBusy(true);setMessage('');
  try{const auth=await supabase.auth.getSession();if(!auth.data.session)throw Error('Войдите в игру для импорта.');
   const origin=process.env.NEXT_PUBLIC_GAME_API_ORIGIN||'';
   const r=await fetch(origin+'/api/import-cloud-document',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.data.session.access_token},body:JSON.stringify({linkId:id})});const data=await r.json();
   if(!r.ok)throw Error(data.error||'Не удалось импортировать документ.');
   onImport(data.title,data.text,data.url);setMessage('Текст импортирован. Проверьте реквизиты, субъект и правовой маршрут перед регистрацией.');
  }catch(e){setMessage(e instanceof Error&&/[А-Яа-яЁё]/.test(e.message)?e.message:'Не удалось связаться с сервисом импорта.')}finally{setBusy(false)}
 }
 return <details className="cloudDocumentPicker"><summary><FolderOpen size={18}/> Импорт из Google или Яндекс Документов</summary><p>Выберите ссылку, сохранённую в профиле. Для извлечения текста нужен публичный экспорт; закрытый документ можно скачать у провайдера и загрузить сюда.</p>
 <div><StyledSelect label="Мой облачный документ" value={id} onChange={setId} options={[{value:'',label:'Выбрать документ'},...links.map(l=>({value:l.id,label:l.title+' · '+(l.provider==='google'?'Google':'Яндекс')}))]}/><button type="button" className="secondary" disabled={disabled||busy||!selected} onClick={()=>void importDocument()}><Download size={17}/>{busy?'Импорт…':'Импортировать текст'}</button>{selected&&<a href={selected.url} target="_blank" rel="noreferrer"><ExternalLink size={17}/> Открыть оригинал</a>}</div>
 {!links.length&&<p>Сначала сохраните ссылку в разделе «Мой профиль» → «Google и Яндекс Документы».</p>}{message&&<p role="status">{message}</p>}
 </details>;
}
