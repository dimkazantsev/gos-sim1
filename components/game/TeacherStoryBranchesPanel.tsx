'use client';
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import styles from './TeacherStorySupplementPanel.module.css';

type Branch={branch_no:number;first_episode:number;last_episode:number;title:string;
 when_recorded:string;when_absent:string;evidence_description:string;
 automatic_evidence:boolean|null;reviewed_outcome:string|null;reviewed_at:string|null;
 evidence_kind:string|null;evidence_id:string|null;teacher_note:string|null;published:boolean;};
const TYPES=[
 {value:'',name:'Выберите тип источника'},
 {value:'political_post',name:'Публикация в политической хронике'},
 {value:'formal_document',name:'Официальный документ'},
 {value:'game_vote',name:'Завершённое голосование'},
 {value:'government_program',name:'Государственная программа'},
 {value:'municipal_project',name:'Муниципальный проект'},
];
export default function TeacherStoryBranchesPanel({gameId,campaignEnabled}:{gameId:string;campaignEnabled:boolean}){
 const [open,setOpen]=useState(false);const [loaded,setLoaded]=useState(false);
 const [items,setItems]=useState<Branch[]>([]);const [number,setNumber]=useState(1);
 const [outcome,setOutcome]=useState('undetermined');const [kind,setKind]=useState('');
 const [sourceId,setSourceId]=useState('');const [note,setNote]=useState('');
 const [pending,setPending]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
 const current=items.find(x=>x.branch_no===number);
 const changed=Boolean(current&&(outcome!==(current.reviewed_outcome||'undetermined')||kind!==(current.evidence_kind||'')||sourceId!==(current.evidence_id||'')||note!==(current.teacher_note||'')));
 const pick=(n:number,source=items)=>{
  if(changed&&!window.confirm('Не сохранять изменения при переходе?'))return;
  const found=source.find(x=>x.branch_no===n);if(!found)return;
  setNumber(n);setOutcome(found.reviewed_outcome||'undetermined');setKind(found.evidence_kind||'');
  setSourceId(found.evidence_id||'');setNote(found.teacher_note||'');setError('');setMessage('');
 };
 const toggle=async()=>{
  if(pending)return;
  if(open){setOpen(false);return;}
  if(loaded){setOpen(true);return;}
  setPending(true);setError('');
  try{
   const response=await supabase.rpc('get_story_branches_teacher',{p_game_id:gameId});
   if(response.error)throw response.error;
   if(!Array.isArray(response.data))throw Error('Не получен перечень развилок.');
   const next=response.data as Branch[];setItems(next);setLoaded(true);setOpen(true);
   const first=next[0];if(first){setNumber(first.branch_no);setOutcome(first.reviewed_outcome||'undetermined');setKind(first.evidence_kind||'');setSourceId(first.evidence_id||'');setNote(first.teacher_note||'');}
  }catch(e){setError(userError(e)||'Невозможно загрузить развилки.');}
  finally{setPending(false);}
 };
 const save=async()=>{
  if(!current||pending||!changed||current.published)return;
  setPending(true);setError('');setMessage('');
  try{
   const response=await supabase.rpc('save_story_branch_review_teacher',{
    p_game_id:gameId,p_branch_no:number,p_outcome:outcome,
    p_evidence_kind:kind||null,p_evidence_id:sourceId.trim()||null,
    p_teacher_note:note.trim(),
   });
   if(response.error)throw response.error;
   setItems(old=>old.map(x=>x.branch_no===number?{...x,reviewed_outcome:outcome,evidence_kind:kind||null,evidence_id:sourceId||null,teacher_note:note}:x));
   setMessage('Проверка сохранена. Она не создаёт голосование, оценку или автоматическую публикацию.');
  }catch(e){setError(userError(e)||'Не удалось сохранить проверку.');}
  finally{setPending(false);}
 };
 const publish=async()=>{
  if(!current||pending||changed||current.published||!campaignEnabled||!current.reviewed_outcome||current.reviewed_outcome==='undetermined')return;
  if(!window.confirm('Опубликовать реакцию на подтверждённую развилку в общей хронике? Отмена невозможна.'))return;
  setPending(true);setError('');setMessage('');
  try{
   const response=await supabase.rpc('publish_story_branch_reaction_teacher',{p_game_id:gameId,p_branch_no:number});
   if(response.error)throw response.error;
   setItems(old=>old.map(x=>x.branch_no===number?{...x,published:true}:x));
   setMessage('Реакция опубликована в «Политическом процессе». Оценки и государственные показатели не изменены.');
  }catch(e){setError(userError(e)||'Публикация невозможна.');}
  finally{setPending(false);}
 };
 return <section className={styles.root} aria-label="Проверка девяти сюжетных развилок">
  <button className={styles.toggle} type="button" aria-expanded={open} disabled={pending} onClick={()=>void toggle()}>{open?'Свернуть развилки':'Проверка девяти сюжетных развилок'}</button>
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  {open&&<div className={styles.layout}>
   <aside className={styles.list}>
    <label className={styles.picker}>Развилка<select value={number} disabled={pending} onChange={e=>pick(Number(e.target.value))}>{items.map(x=><option key={x.branch_no} value={x.branch_no}>П-{String(x.branch_no).padStart(2,'0')} · {x.title}</option>)}</select></label>
    <div className={styles.desktopList}>{items.map(x=><button type="button" className={styles.listItem} aria-pressed={number===x.branch_no} key={x.branch_no} disabled={pending} onClick={()=>pick(x.branch_no)}><b>П-{String(x.branch_no).padStart(2,'0')} · {x.title}</b><small>{x.published?'Опубликовано':x.reviewed_outcome?'Проверка записана':'Не проверено'} · ЭП-{x.first_episode}–{x.last_episode}</small></button>)}</div>
   </aside>
   {current&&<div className={styles.details}>
    <div className={styles.heading}><h3>П-{String(number).padStart(2,'0')} · {current.title}</h3><small>Эпизоды {current.first_episode}–{current.last_episode}</small></div>
    <p className={styles.rule}><b>Проверять:</b> {current.evidence_description}</p>
    <p className={styles.rule}><b>Если решение подтверждено:</b> {current.when_recorded}</p>
    <p className={styles.rule}><b>Если решения нет:</b> {current.when_absent}</p>
    <p className={styles.note}>{current.automatic_evidence===null?'Эта развилка требует отдельной проверки источника преподавателем.':current.automatic_evidence?'В игре обнаружены связанные официальные записи. Они не доказывают содержательный итог без проверки.':'Подтверждённых процедур указанного вида в игре не обнаружено.'}</p>
    <div className={styles.fields}>
     <label>Редакционный итог<select value={outcome} disabled={pending} onChange={e=>setOutcome(e.target.value)}>
      <option value="undetermined">Не установлено</option><option value="recorded">Решение документально подтверждено</option><option value="neutral">Нет подтверждённого решения / нейтральная реакция</option>
     </select></label>
     <label>Источник<select value={kind} disabled={pending} onChange={e=>setKind(e.target.value)}>{TYPES.map(x=><option key={x.value} value={x.value}>{x.name}</option>)}</select></label>
     <label>Идентификатор источника<input type="text" value={sourceId} disabled={pending} onChange={e=>setSourceId(e.target.value)} placeholder="Идентификатор записи ГОС.ID"/></label>
     <label>Что именно подтверждает документ<textarea rows={5} maxLength={1500} disabled={pending} value={note} onChange={e=>setNote(e.target.value)} placeholder="Опишите проверенный факт, не приписывайте органу несуществующее решение."/></label>
    </div>
    <div className={styles.actions}><button type="button" disabled={pending||!changed||current.published} onClick={()=>void save()}>Сохранить проверку</button><button type="button" disabled={pending||changed||current.published||!campaignEnabled||!current.reviewed_outcome||current.reviewed_outcome==='undetermined'} onClick={()=>void publish()}>Опубликовать реакцию</button></div>
    <p className={styles.note}>Это закрытая редакционная проверка. Сюжетная реакция появляется у студентов только после отдельной утверждённой публикации. Коэффициенты и баллы не меняются.</p>
    {message&&<p className={styles.success} role="status">{message}</p>}
   </div>}
  </div>}
 </section>;
}