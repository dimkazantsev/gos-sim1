'use client';
import {userError} from '@/lib/userError';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Eye,MessageCircle,Send,ThumbsDown,ThumbsUp,Trash2} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import ProfileAvatar from './ProfileAvatar';
import {useGameTableSync} from './useGameTableSync';
import {chatHandles} from './chatHandles';
import type {ReturnTypeRepublic} from './viewTypes';
type Discussion={likes:number;dislikes:number;mine:number;views:number;comment_count:number;comments:{id:string;author_id:string;full_name:string;body:string;created_at:string}[]};
export default function CivicDiscussion({kind,targetId,g,readOnly=false}:{kind:'post'|'document';targetId:string;g:ReturnTypeRepublic;readOnly?:boolean}){
 const [rawData,setData]=useState<Discussion|null>(null),[open,setOpen]=useState(false),[limit,setLimit]=useState(30),[body,setBody]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[visible,setVisible]=useState(false);
 const identity=kind+':'+targetId+':'+(g.me?.user_id||'');
 const activeIdentity=useRef(identity),dataIdentity=useRef(''),mutating=useRef('');activeIdentity.current=identity;
 const data=dataIdentity.current===identity?rawData:null;
 const mentionMatch=body.match(/(?:^|\\s)@([а-яёa-z0-9_-]*)$/i);
 const query=(mentionMatch?.[1]||'').toLocaleLowerCase('ru-RU');
 const addresses=chatHandles(g.members.filter(m=>m.game_id===g.game?.id&&m.user_id!==g.me?.user_id));
 const mentionOptions=mentionMatch?addresses.filter(x=>x.surname.toLocaleLowerCase('ru-RU').startsWith(query)||x.handle.startsWith(query)).slice(0,6):[];
 function insertMention(userId:string){
  const chosen=addresses.find(x=>x.member.user_id===userId);if(!chosen||!mentionMatch)return;
  const surname=chosen.surname;
  const ambiguous=addresses.some(x=>x.member.user_id!==userId&&x.surname.toLocaleLowerCase('ru-RU')===surname.toLocaleLowerCase('ru-RU'));
  const label=ambiguous?surname+'_'+userId.replace(/-/g,'').slice(0,8):surname;
  setBody(body.slice(0,body.length-mentionMatch[0].length)+(mentionMatch[0].startsWith(' ')?' ':'')+'@'+label+' ');
 }
 const ref=useRef<HTMLDivElement>(null),seen=useRef(''),recordingView=useRef(''),missingPost=useRef(false);
 const refreshGame=useRef(g.refresh);refreshGame.current=g.refresh;
 const scope=identity+':'+open+':'+limit;
 const activeScope=useRef(scope),request=useRef(0);activeScope.current=scope;
 const load=useCallback(async()=>{
  if(missingPost.current||scope!==activeScope.current)return;
  const ticket=++request.current,requestedScope=scope;
  const r=await supabase.rpc('get_civic_discussion',{p_kind:kind,p_target:targetId,p_limit:open?limit:1});
  if(ticket!==request.current||requestedScope!==activeScope.current)return;
  if(r.error){
   // A post may have just been deleted while the discussion request was in flight.
   // Do not offer a meaningless retry for a permanently removed post.
   if(kind==='post'&&/материал недоступен/i.test(r.error.message)){
    setError('');
    if(!missingPost.current){missingPost.current=true;void refreshGame.current()}
    return;
   }
   setError(userError(r.error));
  }else{dataIdentity.current=identity;setData(r.data as Discussion);setError('')}
 },[kind,targetId,limit,open,scope,identity]);
 const currentLoad=useRef(load);currentLoad.current=load;
 useEffect(()=>{setData(null);setOpen(false);setError('');setBody('');setBusy(false);setLimit(30);dataIdentity.current='';seen.current='';missingPost.current=false;const element=ref.current?.closest('.wallPost,.formalDetail')||ref.current;if(!element)return;const observer=new IntersectionObserver(entries=>setVisible(entries.some(x=>x.isIntersecting)),{threshold:0.01});observer.observe(element);return()=>observer.disconnect()},[kind,targetId,identity]);
 useEffect(()=>{
  if(!visible||readOnly)return;
  let live=true;
  const record=async()=>{
   if(document.visibilityState!=='visible'||seen.current===identity||recordingView.current===identity)return;
   recordingView.current=identity;
   try{const r=await supabase.rpc('record_civic_view',{p_kind:kind,p_target:targetId});if(live&&!r.error)seen.current=identity}
   finally{if(recordingView.current===identity)recordingView.current=''}
  };
  void record();document.addEventListener('visibilitychange',record);
  return()=>{live=false;document.removeEventListener('visibilitychange',record)};
 },[visible,readOnly,targetId,kind,identity]);
 // Only an opened conversation needs its comment rows, reaction counts and
 // fallback polling. Keep the existing one-time per-post view recording above.
 useGameTableSync(open&&visible?g.game?.id:undefined,['civic_comments','civic_reactions'],load,scope,undefined,750,45000);
 async function mutate(name:string,args:Record<string,unknown>,done?:()=>void){
  if(busy||readOnly||mutating.current===identity)return;const startedIdentity=identity;mutating.current=identity;setBusy(true);
  try{
   const r=await supabase.rpc(name,args);if(startedIdentity!==activeIdentity.current)return;
   if(r.error)setError(userError(r.error));else{done?.();await currentLoad.current()}
  }catch(e){if(startedIdentity===activeIdentity.current)setError(userError(e))}
  finally{if(mutating.current===startedIdentity)mutating.current='';if(startedIdentity===activeIdentity.current)setBusy(false)}
 }
 async function react(value:number){
  if(readOnly||busy||mutating.current===identity)return;
  if(data)return mutate('react_to_civic_content',{p_kind:kind,p_target:targetId,p_value:data.mine===value?0:value});
  // Initial reaction is a user gesture: read only this item's current
  // reaction first, so clicking an already liked post toggles it off.
  const started=identity;mutating.current=started;setBusy(true);setError('');
  try{
   const snapshot=await supabase.rpc('get_civic_discussion',{p_kind:kind,p_target:targetId,p_limit:1});
   if(started!==activeIdentity.current)return;
   if(snapshot.error){setError(userError(snapshot.error));return}
   const current=snapshot.data as Discussion;
   dataIdentity.current=started;setData(current);
   const result=await supabase.rpc('react_to_civic_content',{p_kind:kind,p_target:targetId,p_value:current.mine===value?0:value});
   if(started!==activeIdentity.current)return;
   if(result.error)setError(userError(result.error));
   else await currentLoad.current();
  }catch(e){if(started===activeIdentity.current)setError(userError(e))}
  finally{if(mutating.current===started)mutating.current='';if(started===activeIdentity.current)setBusy(false)}
 }
 function comment(){const submitted=body;if(submitted.trim())return mutate('comment_on_civic_content',{p_kind:kind,p_target:targetId,p_body:submitted},()=>setBody(current=>current===submitted?'':current))}
 function remove(id:string){return mutate('delete_civic_comment',{p_comment_id:id})}
 return <div ref={ref} className="civicDiscussion">
  <div className="civicDiscussionStats"><button type="button" aria-label="Нравится" aria-pressed={data?.mine===1} disabled={readOnly||busy} onClick={()=>void react(1)}><ThumbsUp size={18}/><span>{data?.likes??'—'}</span></button><button type="button" aria-label="Не нравится" aria-pressed={data?.mine===-1} disabled={readOnly||busy} onClick={()=>void react(-1)}><ThumbsDown size={18}/><span>{data?.dislikes??'—'}</span></button><button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><MessageCircle size={18}/>Комментарии <span>{data?.comment_count??'—'}</span></button><span className="civicViewCount" title="Уникальные просмотры участников"><Eye size={18}/>{data?.views??'—'}</span></div>
  {error&&<p className="error" role="alert">{error} <button type="button" onClick={()=>void load()}>Повторить</button></p>}
  {open&&<section className="civicComments" aria-label="Комментарии">
   {data?.comments.map(c=>{const pf=g.profiles.find(p=>p.user_id===c.author_id);return <article className="civicComment" key={c.id}><div className="civicCommentAvatar"><ProfileAvatar src={pf?.avatar_url} name={c.full_name} gender={pf?.gender}/></div><div className="civicCommentContent"><header><b>{c.full_name}</b><time>{new Date(c.created_at).toLocaleString('ru-RU')}</time>{!readOnly&&(g.teacher||c.author_id===g.me?.user_id)&&<button type="button" disabled={busy} aria-label="Удалить комментарий" onClick={()=>void remove(c.id)}><Trash2 size={16}/></button>}</header><p>{c.body}</p></div></article>})}
   {data&&!data.comment_count&&<p className="muted">Комментариев пока нет.</p>}
   {data&&data.comment_count>limit&&limit<200&&<button type="button" className="secondary" onClick={()=>setLimit(n=>Math.min(200,n+50))}>Показать ещё комментарии</button>}
   {data&&data.comment_count>200&&limit===200&&<small>Показаны 200 последних комментариев.</small>}
   {!readOnly&&<form className="civicCommentForm" onSubmit={e=>{e.preventDefault();void comment()}}><label>Ваш комментарий<textarea aria-label="Ваш комментарий" rows={2} maxLength={6000} value={body} onChange={e=>setBody(e.target.value)} placeholder="Обсудите решение · @фамилия для приглашения участника"/>{mentionMatch&&<div className="civicMentionMenu" aria-label="Упомянуть участника">{mentionOptions.length?mentionOptions.map(x=><button type="button" key={x.member.user_id} onClick={()=>insertMention(x.member.user_id)}>{x.member.full_name} · {x.member.role_title||'Участник'}</button>):<small>Участник не найден</small>}</div>}</label><button className="primary" type="submit" disabled={busy||!body.trim()}><Send size={18}/> Отправить</button></form>}
  </section>}
 </div>;
}
