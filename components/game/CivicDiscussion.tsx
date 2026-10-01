'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Eye,MessageCircle,Send,ThumbsDown,ThumbsUp,Trash2} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import ProfileAvatar from './ProfileAvatar';
import type {ReturnTypeRepublic} from './viewTypes';
type Discussion={likes:number;dislikes:number;mine:number;views:number;comment_count:number;comments:{id:string;author_id:string;full_name:string;body:string;created_at:string}[]};
export default function CivicDiscussion({kind,targetId,g,readOnly=false}:{kind:'post'|'document';targetId:string;g:ReturnTypeRepublic;readOnly?:boolean}){
 const [data,setData]=useState<Discussion|null>(null),[open,setOpen]=useState(false),[limit,setLimit]=useState(30),[body,setBody]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[visible,setVisible]=useState(false);
 const ref=useRef<HTMLDivElement>(null),seen=useRef('');
 const load=useCallback(async()=>{const r=await supabase.rpc('get_civic_discussion',{p_kind:kind,p_target:targetId,p_limit:limit});if(r.error)setError(r.error.message);else{setData(r.data as Discussion);setError('')}},[kind,targetId,limit]);
 useEffect(()=>{setData(null);setOpen(false);setError('');setBody('');setLimit(30);seen.current='';const element=ref.current?.closest('.wallPost,.formalDetail')||ref.current;if(!element)return;const observer=new IntersectionObserver(entries=>setVisible(entries.some(x=>x.isIntersecting)),{threshold:0.01});observer.observe(element);return()=>observer.disconnect()},[kind,targetId]);
 useEffect(()=>{if(!visible)return;let current=true;void(async()=>{if(!readOnly&&seen.current!==targetId){const r=await supabase.rpc('record_civic_view',{p_kind:kind,p_target:targetId});if(!r.error)seen.current=targetId}if(current)await load()})();const interval=setInterval(()=>void load(),open?15000:60000);return()=>{current=false;clearInterval(interval)}},[visible,load,open,readOnly,targetId,kind]);
 async function react(value:number){if(busy||!data)return;setBusy(true);const r=await supabase.rpc('react_to_civic_content',{p_kind:kind,p_target:targetId,p_value:data.mine===value?0:value});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 async function comment(){if(!body.trim()||busy)return;setBusy(true);const r=await supabase.rpc('comment_on_civic_content',{p_kind:kind,p_target:targetId,p_body:body});if(r.error)setError(r.error.message);else{setBody('');await load()}setBusy(false)}
 async function remove(id:string){setBusy(true);const r=await supabase.rpc('delete_civic_comment',{p_comment_id:id});if(r.error)setError(r.error.message);else await load();setBusy(false)}
 return <div ref={ref} className="civicDiscussion">
  <div className="civicDiscussionStats"><button type="button" aria-label="Нравится" aria-pressed={data?.mine===1} disabled={readOnly||busy||!data} onClick={()=>void react(1)}><ThumbsUp size={18}/><span>{data?.likes??'—'}</span></button><button type="button" aria-label="Не нравится" aria-pressed={data?.mine===-1} disabled={readOnly||busy||!data} onClick={()=>void react(-1)}><ThumbsDown size={18}/><span>{data?.dislikes??'—'}</span></button><button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><MessageCircle size={18}/>Комментарии <span>{data?.comment_count??'—'}</span></button><span className="civicViewCount" title="Уникальные просмотры участников"><Eye size={18}/>{data?.views??'—'}</span></div>
  {error&&<p className="error" role="alert">{error} <button type="button" onClick={()=>void load()}>Повторить</button></p>}
  {open&&<section className="civicComments" aria-label="Комментарии">
   {data?.comments.map(c=>{const pf=g.profiles.find(p=>p.user_id===c.author_id);return <article className="civicComment" key={c.id}><div className="civicCommentAvatar"><ProfileAvatar src={pf?.avatar_url} name={c.full_name} gender={pf?.gender}/></div><div className="civicCommentContent"><header><b>{c.full_name}</b><time>{new Date(c.created_at).toLocaleString('ru-RU')}</time>{!readOnly&&(g.teacher||c.author_id===g.me?.user_id)&&<button type="button" disabled={busy} aria-label="Удалить комментарий" onClick={()=>void remove(c.id)}><Trash2 size={16}/></button>}</header><p>{c.body}</p></div></article>})}
   {data&&!data.comment_count&&<p className="muted">Комментариев пока нет.</p>}
   {data&&data.comment_count>limit&&limit<200&&<button type="button" className="secondary" onClick={()=>setLimit(n=>Math.min(200,n+50))}>Показать ещё комментарии</button>}
   {data&&data.comment_count>200&&limit===200&&<small>Показаны 200 последних комментариев.</small>}
   {!readOnly&&<form className="civicCommentForm" onSubmit={e=>{e.preventDefault();void comment()}}><label>Ваш комментарий<textarea aria-label="Ваш комментарий" rows={2} maxLength={6000} value={body} onChange={e=>setBody(e.target.value)} placeholder="Обсудите текст и решение"/></label><button className="primary" type="submit" disabled={busy||!body.trim()}><Send size={18}/> Отправить</button></form>}
  </section>}
 </div>;
}
