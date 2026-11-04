'use client';
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import styles from './TeacherStorySupplementPanel.module.css';

type Supplement={
 code:string;kind:'short_news'|'archive';title:string;body:string;
 stage_from:number;stage_to:number;after_episode:number;requirement:string;
 source_status:'authored_draft'|'original_missing';source_reference:string;
 evidence_required:boolean;evidence_kind:string|null;evidence_id:string|null;
 final_only:boolean;saved:boolean;approved:boolean;published:boolean;
};
const EVIDENCE_TYPES=[
 {value:'',label:'Нет подтверждающего документа'},
 {value:'political_post',label:'Публикация в политической хронике'},
 {value:'formal_document',label:'Официальный документ'},
 {value:'game_vote',label:'Завершённое голосование'},
 {value:'government_program',label:'Государственная программа'},
 {value:'municipal_project',label:'Муниципальный проект'},
];
export default function TeacherStorySupplementPanel({gameId,campaignEnabled}:{gameId:string;campaignEnabled:boolean}){
 const [open,setOpen]=useState(false);
 const [items,setItems]=useState<Supplement[]>([]);
 const [loaded,setLoaded]=useState(false);
 const [selected,setSelected]=useState('');
 const [title,setTitle]=useState('');
 const [body,setBody]=useState('');
 const [reference,setReference]=useState('');
 const [evidenceKind,setEvidenceKind]=useState('');
 const [evidenceId,setEvidenceId]=useState('');
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const item=items.find(x=>x.code===selected);
 const changed=Boolean(item&&(title!==item.title||body!==item.body||reference!==item.source_reference||evidenceKind!==(item.evidence_kind||'')||evidenceId!==(item.evidence_id||'')));
 const choose=(value:string,source=items)=>{
  if(changed&&!window.confirm('Несохранённые изменения будут потеряны. Продолжить?'))return;
  const picked=source.find(x=>x.code===value);
  if(!picked)return;
  setSelected(picked.code);setTitle(picked.title);setBody(picked.body);
  setReference(picked.source_reference||'');setEvidenceKind(picked.evidence_kind||'');setEvidenceId(picked.evidence_id||'');
  setNotice('');setError('');
 };
 const load=async()=>{
  if(pending)return;
  if(open){setOpen(false);return;}
  if(loaded){setOpen(true);return;}
  setPending(true);setError('');
  try{
   const response=await supabase.rpc('get_story_supplements_teacher',{p_game_id:gameId});
   if(response.error)throw response.error;
   if(!Array.isArray(response.data))throw new Error('Каталог сюжетных материалов недоступен.');
   const next=response.data as Supplement[];
   setItems(next);setLoaded(true);setOpen(true);
   const initial=next.find(x=>x.kind==='short_news');
   if(initial){setSelected(initial.code);setTitle(initial.title);setBody(initial.body);setReference(initial.source_reference||'');setEvidenceKind(initial.evidence_kind||'');setEvidenceId(initial.evidence_id||'');}
  }catch(e){setError(userError(e)||'Не удалось загрузить библиотеку.');}
  finally{setPending(false);}
 };
 const run=async(name:string,args:Record<string,unknown>,apply:()=>void,message:string)=>{
  if(pending)return;
  setPending(true);setError('');setNotice('');
  try{
   const response=await supabase.rpc(name,args);
   if(response.error)throw response.error;
   apply();setNotice(message);
  }catch(e){setError(userError(e)||'Операция не выполнена.');}
  finally{setPending(false);}
 };
 const save=()=>{
  if(!item)return;
  void run('save_story_supplement_teacher',{
   p_game_id:gameId,p_code:item.code,p_title:title,p_body:body,
   p_source_reference:reference,p_evidence_kind:evidenceKind||null,
   p_evidence_id:evidenceId.trim()||null,
  },()=>setItems(old=>old.map(x=>x.code===item.code?{...x,title,body,source_reference:reference,evidence_kind:evidenceKind||null,evidence_id:evidenceId||null,saved:true,approved:false}:x)),
  'Редакция сохранена. Для публикации нужно отдельное утверждение.');
 };
 const approve=(value:boolean)=>{
  if(!item||changed)return;
  void run('approve_story_supplement_teacher',{p_game_id:gameId,p_code:item.code,p_approved:value},
   ()=>setItems(old=>old.map(x=>x.code===item.code?{...x,approved:value}:x)),
   value?'Текст утверждён для этой игры.':'Утверждение отозвано.');
 };
 const publish=()=>{
  if(!item||changed||!item.approved||item.final_only||!campaignEnabled)return;
  if(!window.confirm('Опубликовать этот материал в «Политическом процессе»? Отменить публикацию нельзя.'))return;
  void run('publish_story_supplement_teacher',{p_game_id:gameId,p_code:item.code},
   ()=>setItems(old=>old.map(x=>x.code===item.code?{...x,published:true}:x)),
   'Материал опубликован. Дополнительные оценки и бюджетные последствия не начислялись.');
 };
 const news=items.filter(x=>x.kind==='short_news'),archive=items.filter(x=>x.kind==='archive');
 return <section className={styles.root} aria-label="Дополнительные материалы сюжетной кампании">
  <button className={styles.toggle} type="button" disabled={pending} onClick={()=>void load()} aria-expanded={open}>
   {open?'Свернуть материалы':'Открыть библиотеку: 30 малых новостей и 8 документов'}
  </button>
  {error&&<p className={styles.error} role="alert">{error}</p>}
  {open&&<div className={styles.layout}>
   <aside className={styles.list} aria-label="Материалы">
    <label className={styles.picker}>Выберите материал
     <select value={selected} onChange={e=>choose(e.target.value)} disabled={pending}>
      <optgroup label="Малые новости">{news.map(x=><option key={x.code} value={x.code}>{x.code} · {x.title}</option>)}</optgroup>
      <optgroup label="Архивные документы">{archive.map(x=><option key={x.code} value={x.code}>{x.code} · {x.title}</option>)}</optgroup>
     </select>
    </label>
    <div className={styles.desktopList}>
     {[...news,...archive].map(x=><button type="button" disabled={pending} aria-pressed={selected===x.code}
      className={styles.listItem} key={x.code} onClick={()=>choose(x.code)}>
      <b>{x.code} · {x.title}</b><small>{x.published?'Опубликовано':x.approved?'Утверждено':x.source_status==='original_missing'?'Нет оригинала':'Черновик'}</small>
     </button>)}
    </div>
   </aside>
   <div className={styles.details}>
    {item&&<>
     <div className={styles.heading}><h3>{item.code} · {item.title}</h3><small>Этапы {item.stage_from}{item.stage_from!==item.stage_to?'–'+item.stage_to:''} · после ЭП-{String(item.after_episode).padStart(2,'0')}</small></div>
     <p className={styles.rule}>{item.requirement}</p>
     {item.source_status==='original_missing'&&<p className={styles.warning}>Полный подлинный текст отсутствует в источнике 4.2. Не публикуйте реконструкцию как оригинальный документ. Загрузите проверенный текст и укажите его происхождение.</p>}
     {item.source_status==='authored_draft'&&<p className={styles.note}>Новая редакционная заготовка по расписанию 4.2, не восстановленный оригинал 4.1. Проверьте факты и ограничения перед утверждением.</p>}
     {item.final_only&&<p className={styles.warning}>К-30 может войти только в заключительный ЭП-24. Отдельная публикация заблокирована.</p>}
     <div className={styles.fields}>
      <label>Заголовок<input type="text" maxLength={200} disabled={pending||item.published} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label>Текст материала<textarea rows={9} maxLength={9000} disabled={pending||item.published} value={body} onChange={e=>setBody(e.target.value)} placeholder="Введите проверенный текст. Минимум 80 символов."/></label>
      <label>Источник и проверка фактов<input type="text" maxLength={500} disabled={pending||item.published} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Например, оригинальный сценарный документ, версия и реквизиты"/></label>
      {item.evidence_required&&<div className={styles.proof}>
       <p>Эта новость сообщает о проверяемом действии. Укажите существующую запись данной игры, иначе утверждение будет отклонено.</p>
       <label>Вид записи<select disabled={pending||item.published} value={evidenceKind} onChange={e=>setEvidenceKind(e.target.value)}>{EVIDENCE_TYPES.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
       <label>Идентификатор записи<input type="text" disabled={pending||item.published} value={evidenceId} onChange={e=>setEvidenceId(e.target.value)} placeholder="Идентификатор подтверждённого действия"/></label>
      </div>}
     </div>
     <div className={styles.actions}>
      <button type="button" disabled={pending||item.published||(!changed&&item.saved)} onClick={save}>Сохранить редакцию</button>
      <button type="button" disabled={pending||item.published||!item.saved||changed} onClick={()=>approve(!item.approved)}>{item.approved?'Отозвать утверждение':'Утвердить'}</button>
      <button type="button" disabled={pending||item.published||changed||!item.saved||!item.approved||item.final_only||!campaignEnabled} onClick={publish}>Опубликовать</button>
     </div>
     {!campaignEnabled&&<p className={styles.note}>Кампания выключена. Публикации недоступны, пока вы не разрешите их в настройках выше.</p>}
    </>}
    {notice&&<p className={styles.success} role="status">{notice}</p>}
   </div>
  </div>}
 </section>;
}