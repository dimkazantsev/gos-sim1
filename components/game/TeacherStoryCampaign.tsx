'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import styles from './TeacherStoryCampaign.module.css';
import TeacherStorySupplementPanel from './TeacherStorySupplementPanel';
import TeacherStoryBranchesPanel from './TeacherStoryBranchesPanel';
import StoryNewsIllustration from './StoryNewsIllustration';

type Episode={episode_no:number;stage_no:number;title:string;loaded:boolean;approved:boolean;published:boolean};
type Campaign={prepared:boolean;enabled:boolean;current_episode:number;approved_episodes:number;
 published_episodes:number;loaded_episodes:number;total_episodes:number;metrics_enabled:boolean;
 publication_enabled:boolean;episodes:Episode[]};
type Variant={id:string;title:string;body:string;condition:string};
type Evidence={kind:string;warning:string;records:Record<string,string>[]};
type Preview={episode_no:number;stage_no:number;title:string;body:string;
 evidence_rule:string;editor_note:string;approved:boolean;published:boolean;
 variants?:Variant[];evidence?:Evidence};
const EVIDENCE_FIELDS:Record<string,string>={vote_status:'Голосование',vote_result:'Результат',program_status:'Государственная программа',document_status:'Документ',project_status:'Муниципальный проект'};
const EVIDENCE_VALUES:Record<string,string>={draft:'Черновик',open:'Открыто',closed:'Завершено',pending:'На рассмотрении',ready:'Подготовлено',approved:'Одобрено',accepted:'Принято',rejected:'Отклонено',published:'Опубликовано',signed:'Подписано',active:'Действует',completed:'Выполнено',cancelled:'Отменено',canceled:'Отменено',in_progress:'В работе',submitted:'Направлено',voting:'На голосовании'};
const evidenceText=(record:Record<string,string>)=>Object.entries(record).map(([key,value])=>`${EVIDENCE_FIELDS[key]||'Сведения'}: ${EVIDENCE_VALUES[String(value)]||String(value||'Нет данных')}`).join(' · ');
/** Visible to teachers only. No chapter contents or spoiler logic in the public build. */
export default function TeacherStoryCampaign({gameId}:{gameId:string}){
 const [campaign,setCampaign]=useState<Campaign|null>(null);
 const [preview,setPreview]=useState<Preview|null>(null);
 const [title,setTitle]=useState('');
 const [body,setBody]=useState('');
 const [working,setWorking]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [editing,setEditing]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const busy=useRef(false);
 const cached=useRef(new Map<number,Preview>());
 const change=preview&&(title!==preview.title||body!==preview.body);
 // Load only when the teacher opens this workspace. One index query and one
 // first-episode preview; subsequent episodes are loaded on selection and cached.
 useEffect(()=>{
  let active=true;
  const initialise=async()=>{
   setWorking(true);setLoaded(false);setError('');
   try{
    const result=await supabase.rpc('get_story_campaign_teacher',{p_game_id:gameId});
    if(result.error)throw result.error;
    if(!active)return;
    const status=result.data as Campaign;
    if(!status||!Array.isArray(status.episodes))throw Error('Сведения о сюжетной кампании недоступны.');
    setCampaign(status);
    if(status.prepared){
     const target=status.episodes.find(item=>item.episode_no===Math.min(24,status.current_episode+1)&&item.loaded)
      ||status.episodes.find(item=>item.loaded);
     if(target){
      const response=await supabase.rpc('get_story_episode_preview_teacher',
       {p_game_id:gameId,p_episode_no:target.episode_no});
      if(response.error)throw response.error;
      if(!active)return;
      const value=response.data as Preview|null;
      if(value){
       cached.current.set(target.episode_no,value);
       setPreview(value);setTitle(value.title);setBody(value.body);
      }
     }
    }
   }catch(e){if(active)setError(userError(e)||'Не удалось загрузить сюжетную кампанию.');}
   finally{if(active){setWorking(false);setLoaded(true);}}
  };
  void initialise();
  return()=>{active=false;};
 },[gameId]);
 const selected=campaign?.episodes.find(item=>item.episode_no===preview?.episode_no);
 const next=(campaign?.current_episode||0)+1;
 const useStatus=(value:unknown)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Статус сюжетной кампании недоступен.');
  setCampaign(value as Campaign);
 };
 const doCall=async<T,>(name:string,args:Record<string,unknown>,apply:(value:T)=>void)=>{
  if(busy.current)return;
  busy.current=true;setWorking(true);setError('');setNotice('');
  try{
   const response=await supabase.rpc(name,args);
   if(response.error)throw response.error;
   apply(response.data as T);
  }catch(e){setError(userError(e)||'Не удалось выполнить действие.');}
  finally{busy.current=false;setWorking(false);}
 };
 const openEpisode=async(item:Episode)=>{
  if(working||change&&!window.confirm('Редакция не сохранена. Перейти к другому эпизоду?'))return;
  const cache=cached.current.get(item.episode_no);
  if(cache){setPreview(cache);setTitle(cache.title);setBody(cache.body);setEditing(false);return;}
  await doCall<Preview>('get_story_episode_preview_teacher',
   {p_game_id:gameId,p_episode_no:item.episode_no},value=>{
    if(!value)throw Error('Текст ещё не загружен в закрытую библиотеку.');
    cached.current.set(item.episode_no,value);
    setPreview(value);setTitle(value.title);setBody(value.body);setEditing(false);
   });
 };
 const save=async()=>{
  if(!preview)return;
  await doCall<Preview>('save_story_episode_edit_teacher',
   {p_game_id:gameId,p_episode_no:preview.episode_no,p_title:title,p_body:body},value=>{
    cached.current.set(value.episode_no,value);setPreview(value);setTitle(value.title);setBody(value.body);setEditing(false);
    setCampaign(previous=>previous?{...previous,episodes:previous.episodes.map(e=>e.episode_no===value.episode_no?{...e,approved:false}:e),
     approved_episodes:Math.max(0,previous.approved_episodes-(selected?.approved?1:0))}:previous);
    setNotice('Редакция сохранена. Для публикации нужно повторное утверждение.');
   });
 };
 const approve=async(value:boolean)=>{
  if(!preview||change)return;
  await doCall<Campaign>('approve_story_episode_teacher',
   {p_game_id:gameId,p_episode_no:preview.episode_no,p_approved:value},data=>{
    useStatus(data);
    const updated={...preview,approved:value};cached.current.set(preview.episode_no,updated);setPreview(updated);
    setNotice(value?'Редакция утверждена для этой игры.':'Утверждение отозвано.');
   });
 };
 const publish=async()=>{
  if(!preview||change||!selected?.approved||!campaign?.enabled)return;
  if(!window.confirm('Опубликовать этот эпизод в «Политическом процессе»? Отменить публикацию будет нельзя.'))return;
  await doCall<{published:boolean;campaign:Campaign;post_id:string}>('publish_story_episode_teacher',
   {p_game_id:gameId,p_episode_no:preview.episode_no},result=>{
    useStatus(result.campaign);
    const updated={...preview,published:true};cached.current.set(preview.episode_no,updated);setPreview(updated);
    setNotice('Эпизод опубликован в общей хронике. Государственные показатели и оценки не изменяются.');
   });
 };
 const setActive=async(enabled:boolean)=>{
  if(!campaign)return;
  if(enabled&&!window.confirm('Разрешить ручную публикацию согласованных эпизодов?'))return;
  await doCall<Campaign>('set_story_campaign_enabled_teacher',
   {p_game_id:gameId,p_enabled:enabled},value=>{
    useStatus(value);setNotice(enabled?'Ручная публикация разрешена. Ничего не опубликовано автоматически.':'Кампания приостановлена.');
   });
 };
 const chooseVariant=(option:Variant)=>{
  if(change&&!window.confirm('Несохранённые изменения будут заменены выбранным вариантом. Продолжить?'))return;
  setTitle(option.title);setBody(option.body);setEditing(true);
 };
 const cancelEditing=()=>{
  if(!preview)return;
  if(change&&!window.confirm('Отменить несохранённые изменения?'))return;
  setTitle(preview.title);setBody(preview.body);setEditing(false);
 };
 return <section className={['surface',styles.root].join(' ')} aria-labelledby="story-campaign-title">
  <div className="surfaceHead"><div>
   <small>ПРЕПОДАВАТЕЛЬ · СОБЫТИЯ</small>
   <h2 id="story-campaign-title">Сюжетная кампания</h2>
   <p>24 эпизода · этапы 4–14. Преподаватель выбирает, утверждает и публикует каждый выпуск.</p>
  </div><span>{!loaded?'Загрузка…':campaign?.enabled?'Публикации разрешены':'Публикации выключены'}</span></div>
  <div className="teacherDetailsBody">
   <div className={styles.toolbar}>
    {campaign&&<div className={styles.summary} role="status">
     <span>Выпуск <b>{campaign.current_episode} из 24</b></span>
     <span>Загружено <b>{campaign.loaded_episodes}</b></span>
     <span>Утверждено <b>{campaign.approved_episodes}</b></span>
     <span>Опубликовано <b>{campaign.published_episodes}</b></span>
    </div>}
    <div className={styles.actions}>
     <button className={styles.actionButton} type="button" disabled={working}
      onClick={()=>void doCall<Campaign>('get_story_campaign_teacher',{p_game_id:gameId},useStatus)}>
      {working?'Загрузка…':'Обновить состояние'}
     </button>
     {campaign&&!campaign.prepared&&<button className={styles.actionButton} type="button" disabled={working}
      onClick={()=>void doCall<Campaign>('prepare_story_campaign_teacher',{p_game_id:gameId},useStatus)}>
      Подготовить кампанию</button>}
     {campaign?.prepared&&(campaign.enabled
      ?<button className={styles.actionButton} type="button" disabled={working}
       onClick={()=>void setActive(false)}>Приостановить публикации</button>
      :<button className={styles.actionButton} type="button" disabled={working||campaign.current_episode>=24}
       onClick={()=>void setActive(true)}>Разрешить публикации</button>)}
    </div>
   </div>
   {error&&<p className="processNotice" role="alert">{error}</p>}
   {notice&&<p className="processNotice" role="status">{notice}</p>}
   {!loaded&&<p role="status">Загружаются эпизоды и первый выпуск…</p>}
   {loaded&&!campaign&&<p>Не удалось получить сведения о кампании. Нажмите «Обновить состояние».</p>}
   {campaign&&!campaign.prepared&&<p>Для этой игры кампания ещё не подготовлена. Нажмите «Подготовить кампанию», чтобы открыть закрытые редакции.</p>}
   {campaign?.prepared&&<div className={styles.workspace}>
    <aside className={styles.sidebar} aria-label="Эпизоды сюжетной кампании">
     <div className={styles.sidebarHead}>
      <h3>Эпизоды</h3><small>{campaign.episodes.length} выпуска · по порядку</small>
     </div>
     <label className={styles.mobilePicker}>
      Выбрать выпуск
      <select value={preview?.episode_no??''} disabled={working}
       onChange={event=>{
        const item=campaign.episodes.find(e=>e.episode_no===Number(event.target.value));
        if(item)void openEpisode(item);
       }}>
       <option value="" disabled>Выберите эпизод</option>
       {campaign.episodes.map(item=><option key={item.episode_no} value={item.episode_no}
        disabled={!item.loaded}>
        {String(item.episode_no).padStart(2,'0')}. {item.title} · Этап {item.stage_no}
       </option>)}
      </select>
     </label>
     <div className={styles.episodeGrid}>
      {campaign.episodes.map(item=><button key={item.episode_no} type="button"
       disabled={working||!item.loaded} aria-pressed={preview?.episode_no===item.episode_no}
       onClick={()=>void openEpisode(item)} className={styles.episodeButton}>
       <span className={styles.episodeTitle}>{String(item.episode_no).padStart(2,'0')}. {item.title}</span>
       <span className={styles.episodeMeta}>Этап {item.stage_no} · {item.published?'Опубликовано':item.approved?'Утверждено':item.loaded?'Черновик':'Не загружено'}</span>
      </button>)}
     </div>
    </aside>
    {preview?<section className={styles.editorPanel} aria-label="Редактор выбранного эпизода">
     <header className={styles.editorHead}>
      <small>ЭПИЗОД {String(preview.episode_no).padStart(2,'0')} · ЭТАП {preview.stage_no}</small>
      <h3>{preview.title}</h3>
      <span className={styles.editorStatus}>{preview.published?'Опубликовано':selected?.approved?'Утверждено':'Черновик'}</span>
     </header>
     {!!preview.editor_note&&<section className={styles.guideSection} aria-label="Сценарный план эпизода">
      <div className={styles.guideHead}>
       <h4>{preview.editor_note.startsWith('Редакция 4.2')?'Сценарный план · редакция 4.2':'Заметка редактора'}</h4>
       <small>Только преподавателю</small>
      </div>
      {preview.editor_note.startsWith('Редакция 4.2')&&<p className={styles.helperText}>
       Здесь указаны исходное событие, допустимые действия участников, проверяемые решения и переход к следующему эпизоду. Это сценарная карта, а не опубликованная новость.
      </p>}
      <div className={styles.guideBody}>{preview.editor_note}</div>
     </section>}
     <section className={styles.storySection} aria-label="Содержание эпизода">
      <h4>Текст публикации · черновик</h4>
      {editing&&!preview.published
       ?<div className={styles.editFields}>
        <label>Заголовок<input className={styles.editorInput} value={title}
         onChange={e=>setTitle(e.target.value)} maxLength={220} disabled={working}/></label>
        <label>Текст выпуска<textarea className={styles.editorTextarea} value={body}
         onChange={e=>setBody(e.target.value)} rows={14} maxLength={9000} disabled={working}/></label>
       </div>
       :<div className={styles.storyText}>{preview.body}</div>}
     </section>
     <details className={styles.visualPreview} aria-label="Предпросмотр оформления сюжетной новости">
      <summary>Как новость увидят студенты · иллюстрация и текст</summary>
      <div className={styles.visualPreviewContent}>
       <p className={styles.helperText}>Иллюстрация точно соответствует оформлению выпуска в разделе «Политический процесс». Она встроена в приложение: дополнительных запросов и загрузки изображения нет.</p>
       <article className={styles.visualPreviewArticle}>
        <small>ГОС.ID · Сюжетная хроника · Этап {preview.stage_no}</small>
        <StoryNewsIllustration episodeNo={preview.episode_no}/>
        <h4>{title}</h4>
        <div className={styles.storyText}>{body}</div>
       </article>
       <p className={styles.helperText}>Предпросмотр не публикует новость. Изменения текста видны здесь сразу, но попадают в игру только после сохранения, утверждения и отдельной публикации.</p>
      </div>
     </details>
     {!!preview.evidence_rule&&<section className={styles.contextSection}>
      <h4>Условия и связь с игровым процессом</h4>
      <p>{preview.evidence_rule}</p>
     </section>}
     {preview.evidence?.kind&&<section className={styles.contextSection}>
      <h4>Подтверждённые игровые решения</h4>
      <p className={styles.helperText}>{preview.evidence.warning}</p>
      {preview.evidence.records.length===0
       ?<p className={styles.helperText}>Подтверждённых записей пока нет. Нельзя объявлять положительный результат.</p>
       :<div className={styles.evidenceRecords}>{preview.evidence.records.map((record,i)=>
        <p key={i}>{evidenceText(record)}</p>)}</div>}
     </section>}
     {!!preview.variants?.length&&!preview.published&&<section className={styles.contextSection}>
      <h4>Варианты финала</h4>
      <p className={styles.helperText}>Выберите вариант по подтверждённым решениям, затем сохраните и утвердите текст. Выбор сам по себе ничего не публикует.</p>
      <div className={styles.variantGrid}>
       {preview.variants.map(option=><button type="button" className={styles.episodeButton}
        key={option.id} disabled={working} onClick={()=>chooseVariant(option)}>
        <span className={styles.episodeTitle}>{option.id} · {option.title}</span>
        <span className={styles.episodeMeta}>{option.condition}</span>
       </button>)}
      </div>
     </section>}

     <footer className={styles.editorFooter}>
      <h4>Управление выпуском</h4>
      {preview.published
       ?<p className={styles.helperText}>Эпизод уже опубликован в «Политическом процессе». Изменение опубликованного текста здесь недоступно.</p>
       :<>
        <div className={styles.actions}>
         {editing
          ?<>
           <button className={styles.actionButton} type="button" disabled={working}
            onClick={cancelEditing}>Отменить правки</button>
           <button className={styles.actionButton} type="button" disabled={working||!change}
            onClick={()=>void save()}>Сохранить редакцию</button>
          </>
          :<button className={styles.actionButton} type="button" disabled={working}
            onClick={()=>setEditing(true)}>Изменить текст</button>}
         <button className={styles.actionButton} type="button"
          disabled={working||editing||!!change}
          onClick={()=>void approve(!selected?.approved)}>
          {selected?.approved?'Отозвать утверждение':'Утвердить редакцию'}</button>
         <button className={styles.actionButton} type="button"
          disabled={working||editing||!!change||!selected?.approved||!campaign.enabled||preview.episode_no!==next}
          onClick={()=>void publish()}>Опубликовать</button>
        </div>
        <p className={styles.helperText}>
         {preview.episode_no!==next
          ?<>Публикация строго по порядку. Следующий выпуск — {next}.</>
          :!campaign.enabled
          ?<>Сначала разрешите публикации в верхней панели.</>
          :!selected?.approved
          ?<>Для публикации необходимо утвердить редакцию.</>
          :<>Редакция утверждена. Публикация доступна только по вашему нажатию.</>}
        </p>
       </>}
     </footer>
    </section>
    :<section className={styles.editorPanel}><h3>Выберите эпизод</h3>
      <p>Нажмите на выпуск слева или выберите его в списке сверху. Текст и управление откроются здесь.</p>
     </section>}
   </div>}
   {campaign?.prepared&&<TeacherStorySupplementPanel key={gameId} gameId={gameId} campaignEnabled={campaign.enabled}/>}
   {campaign?.prepared&&<TeacherStoryBranchesPanel key={'branches-'+gameId} gameId={gameId} campaignEnabled={campaign.enabled}/>}
  </div>
 </section>;
}