'use client';
import {useEffect,useState} from 'react';
import {ExternalLink,FileText,Plus,Trash2} from 'lucide-react';
import {supabase} from '@/lib/supabase';

type Link={id:string;title:string;provider:'google'|'yandex';url:string};
export function documentProvider(raw:string):Link['provider']|null{
 try{
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password)return null;
  if(['docs.google.com','drive.google.com'].includes(u.hostname))return 'google';
  if(['docs.yandex.ru','docs.yandex.com','disk.yandex.ru','disk.yandex.com','doc.yandex.ru','doc.yandex.com','yadi.sk'].includes(u.hostname))return 'yandex';
 }catch{}
 return null;
}
export default function ProfileDocumentLinks({gameId,userId}:{gameId:string;userId:string}){
 const [links,setLinks]=useState<Link[]>([]),[title,setTitle]=useState(''),[url,setUrl]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[loaded,setLoaded]=useState(false);
 async function load(){
  const r=await supabase.from('profile_document_links').select('id,title,provider,url').eq('game_id',gameId).eq('user_id',userId).order('created_at',{ascending:false});
  if(r.error){setNotice('Не удалось открыть список документов: '+r.error.message);return}
  setLinks((r.data||[]) as Link[]);setLoaded(true);
 }
 useEffect(()=>{void load()},[gameId,userId]);
 async function add(e:React.FormEvent){
  e.preventDefault();if(busy)return;
  const provider=documentProvider(url.trim());
  if(!provider){setNotice('Вставьте HTTPS-ссылку на документ Google или Яндекса.');return}
  if(!title.trim()){setNotice('Укажите название документа.');return}
  setBusy(true);setNotice('');
  const r=await supabase.from('profile_document_links').insert({game_id:gameId,user_id:userId,title:title.trim(),url:url.trim(),provider}).select('id').single();
  if(r.error)setNotice(r.error.code==='23505'?'Этот документ уже добавлен.':'Не удалось сохранить документ: '+r.error.message);
  else{setTitle('');setUrl('');await load();setNotice('Документ добавлен в личный кабинет.')}
  setBusy(false);
 }
 async function remove(id:string){
  if(busy)return;setBusy(true);setNotice('');
  const r=await supabase.from('profile_document_links').delete().eq('id',id).eq('user_id',userId).select('id').single();
  if(r.error)setNotice('Не удалось убрать ссылку: '+r.error.message);
  else{setLinks(old=>old.filter(x=>x.id!==id));setNotice('Ссылка удалена. Сам документ сохранён у провайдера.')}
  setBusy(false);
 }
 return <section className="profileDocumentLinks surface">
  <header><div><small>РАБОТА С ДОКУМЕНТАМИ</small><h2>Google И Яндекс Документы</h2><p>Сохраняйте ссылки на свои документы и открывайте их редакторы из личного кабинета. Доступ к содержимому задаётся в самом документе.</p></div><FileText aria-hidden="true"/></header>
  <div className="profileDocumentProviders"><a href="https://docs.google.com/document/create" target="_blank" rel="noopener noreferrer">Создать Google Документ <ExternalLink size={16}/></a><a href="https://docs.yandex.ru/" target="_blank" rel="noopener noreferrer">Открыть Яндекс Документы <ExternalLink size={16}/></a></div>
  <form onSubmit={e=>void add(e)}><label>Название<input value={title} maxLength={160} required onChange={e=>setTitle(e.target.value)} placeholder="Проект постановления"/></label><label>Ссылка на документ<input type="url" value={url} maxLength={2048} required onChange={e=>setUrl(e.target.value)} placeholder="Https://docs.google.com/…"/></label><button className="primary" type="submit" disabled={busy}><Plus size={17}/> Добавить документ</button></form>
  <div className="profileDocumentList">{links.map(link=><article key={link.id}><div><span>{link.provider==='google'?'Google Документы':'Яндекс Документы'}</span><b>{link.title}</b></div><a href={link.url} target="_blank" rel="noopener noreferrer">Открыть <ExternalLink size={16}/></a><button type="button" disabled={busy} onClick={()=>void remove(link.id)} aria-label={'Убрать ссылку: '+link.title}><Trash2 size={17}/></button></article>)}</div>
  {loaded&&!links.length&&<p className="profileHint">Добавленные документы появятся здесь.</p>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
