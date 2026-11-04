'use client';
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import styles from './TeacherStorySupplementPanel.module.css';

type Branch={
 branch_no:number;first_episode:number;last_episode:number;stage_no:number;title:string;
 when_recorded:string;when_absent:string;evidence_description:string;
 automatic_evidence:boolean|null;reviewed_outcome:string|null;reviewed_at:string|null;
 automatic_review:boolean;evidence_kind:string|null;evidence_id:string|null;
 teacher_note:string|null;published:boolean;ready:boolean;
 response_title:string;response_body:string;
};
export default function TeacherStoryBranchesPanel({gameId}:{gameId:string}){
 const [open,setOpen]=useState(false),[loaded,setLoaded]=useState(false);
 const [items,setItems]=useState<Branch[]>([]),[number,setNumber]=useState(1);
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[editing,setEditing]=useState(false);
 const [pending,setPending]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const selected=items.find(item=>item.branch_no===number);
 const dirty=!!selected&&(title!==selected.response_title||body!==selected.response_body);
 const pick=(n:number,source=items)=>{
  if(dirty&&!window.confirm('Несохранённый текст будет потерян. Перейти к другой реакции?'))return;
  const item=source.find(x=>x.branch_no===n);if(!item)return;
  setNumber(n);setTitle(item.response_title);setBody(item.response_body);
  setEditing(false);setError('');setMessage('');
 };
 const reload=async()=>{
  if(pending)return;
  setPending(true);setError('');
  try{
   const response=await supabase.rpc('get_story_branches_teacher',{p_game_id:gameId});
   if(response.error)throw response.error;
   if(!Array.isArray(response.data))throw Error('Результаты автоматической проверки недоступны.');
   const updated=response.data as Branch[];
   setItems(updated);setLoaded(true);
   if(updated.length)pick(updated.some(x=>x.branch_no===number)?number:updated[0].branch_no,updated);
  }catch(e){setError(userError(e)||'Не удалось загрузить сюжетные реакции.');}
  finally{setPending(false);}
 };
 const toggle=()=>{
  if(pending)return;
  if(open){setOpen(false);return;}
  setOpen(true);
  if(!loaded)void reload();
 };
 const saveText=async()=>{
  if(!selected||pending||!dirty)return;
  setPending(true);setError('');setMessage('');
  try{
   const res=await supabase.rpc('edit_story_branch_text_teacher',{
    p_game_id:gameId,p_branch_no:number,p_title:title.trim(),p_body:body.trim()});
   if(res.error)throw res.error;
   setItems(old=>old.map(x=>x.branch_no===number?{...x,response_title:title.trim(),response_body:body.trim()}:x));
   setTitle(title.trim());setBody(body.trim());setEditing(false);
   setMessage(selected.published?'Опубликованная новость исправлена.':'Редакция сохранена для автоматической публикации.');
  }catch(e){setError(userError(e)||'Не удалось сохранить исправление.');}
  finally{setPending(false);}
 };
 const status=(item:Branch)=>item.published?'Опубликовано':item.reviewed_outcome==='recorded'?'Решение подтверждено':
  item.reviewed_outcome==='neutral'?'Подтверждения не найдено':item.ready?'Ожидает обработки':'Ожидает завершения этапа';
 return <section className={styles.root} aria-label="Автоматические сюжетные реакции">
  <button className={styles.toggle} type="button" aria-expanded={open} disabled={pending} onClick={toggle}>
   {open?'Свернуть сюжетные реакции':'Сюжетные реакции · автоматически'}
  </button>
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  {open&&<div>
   <p className={styles.note}>ГОС.ID самостоятельно проверяет решения после завершения соответствующего этапа и публикует сюжетную реакцию. Вам достаточно просмотреть результат и при необходимости исправить текст. Документы и идентификаторы вводить не требуется.</p>
   <div className={styles.actions}><button type="button" disabled={pending||dirty} onClick={()=>void reload()}>
    {pending?'Проверка…':'Обновить сведения'}</button></div>
   {!loaded&&<p className={styles.note} role="status">Загружаются результаты сюжетных реакций…</p>}
   <div className={styles.layout}>
    <aside className={styles.list}>
     <label className={styles.picker}>Сюжетная реакция<select value={number} disabled={pending}
      onChange={e=>pick(Number(e.target.value))}>
      {items.map(x=><option key={x.branch_no} value={x.branch_no}>{x.title} · Этап {x.stage_no}</option>)}
     </select></label>
     <div className={styles.desktopList}>{items.map(x=><button type="button" className={styles.listItem}
      aria-pressed={number===x.branch_no} key={x.branch_no} disabled={pending}
      onClick={()=>pick(x.branch_no)}>
      <b>{x.title}</b><small>Этап {x.stage_no} · {status(x)}</small>
     </button>)}</div>
    </aside>
    {selected&&<div className={styles.details}>
     <div className={styles.heading}><h3>{selected.title}</h3>
      <small>Этап {selected.stage_no} · {status(selected)}</small></div>
     <p className={styles.rule}><b>Что проверяет система:</b> {selected.evidence_description}</p>
     {selected.reviewed_outcome==='recorded'
      ?<p className={styles.rule}><b>Подтверждено:</b> {selected.teacher_note||selected.when_recorded}</p>
      :selected.reviewed_outcome==='neutral'
      ?<p className={styles.rule}>Документального подтверждения соответствующего решения не найдено. Это не означает, что предложение было отклонено.</p>
      :<p className={styles.note}>Проверка состоится автоматически после завершения соответствующего этапа.</p>}
     <div className={styles.fields}>
      <label>Заголовок сюжетной новости
       <input value={title} maxLength={220} disabled={pending||!editing}
        onChange={e=>setTitle(e.target.value)}/></label>
      <label>Текст новости
       <textarea value={body} rows={7} maxLength={9000} disabled={pending||!editing}
        onChange={e=>setBody(e.target.value)}/></label>
     </div>
     <div className={styles.actions}>
      {!editing?<button type="button" disabled={pending} onClick={()=>setEditing(true)}>Изменить текст</button>:<>
       <button type="button" disabled={pending} onClick={()=>{setTitle(selected.response_title);setBody(selected.response_body);setEditing(false);}}>Отменить</button>
       <button type="button" disabled={pending||!dirty} onClick={()=>void saveText()}>Сохранить изменения</button>
      </>}
     </div>
     {message&&<p className={styles.success} role="status">{message}</p>}
    </div>}
   </div>
  </div>}
 </section>;
}
