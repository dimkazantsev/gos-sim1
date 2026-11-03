'use client';
import {useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';

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
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const busy=useRef(false);
 const cached=useRef(new Map<number,Preview>());
 const change=preview&&(title!==preview.title||body!==preview.body);
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
  if(cache){setPreview(cache);setTitle(cache.title);setBody(cache.body);return;}
  await doCall<Preview>('get_story_episode_preview_teacher',
   {p_game_id:gameId,p_episode_no:item.episode_no},value=>{
    if(!value)throw Error('Текст ещё не загружен в закрытую библиотеку.');
    cached.current.set(item.episode_no,value);
    setPreview(value);setTitle(value.title);setBody(value.body);
   });
 };
 const save=async()=>{
  if(!preview)return;
  await doCall<Preview>('save_story_episode_edit_teacher',
   {p_game_id:gameId,p_episode_no:preview.episode_no,p_title:title,p_body:body},value=>{
    cached.current.set(value.episode_no,value);setPreview(value);setTitle(value.title);setBody(value.body);
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
 return <section className="surface" aria-labelledby="story-campaign-title">
  <div className="surfaceHead"><div>
   <small>ПРЕПОДАВАТЕЛЬ · СОБЫТИЯ</small>
   <h2 id="story-campaign-title">Сюжетная кампания</h2>
   <p>Генеральная линия · 24 эпизода · этапы 4–14. Участники видят только опубликованные выпуски.</p>
  </div><span>{campaign?.enabled?'Публикации разрешены':'Выключена'}</span></div>
  <div className="teacherDetailsBody">
   <p><b>Публикация только вручную.</b> Без новых фоновых запросов, подписок, дополнительных голосований и изменений показателей.</p>
   <div className="directorButtons compact">
    <button type="button" disabled={working} onClick={()=>void doCall<Campaign>('get_story_campaign_teacher',{p_game_id:gameId},useStatus)}>
     <b>{working?'Выполняется…':'Проверить состояние'}</b>
    </button>
    {campaign&&!campaign.prepared&&<button type="button" disabled={working}
     onClick={()=>void doCall<Campaign>('prepare_story_campaign_teacher',{p_game_id:gameId},useStatus)}>
     <b>Подготовить кампанию</b></button>}
    {campaign?.prepared&&(campaign.enabled
     ?<button type="button" disabled={working} onClick={()=>void setActive(false)}><b>Пауза</b></button>
     :<button type="button" disabled={working||campaign.current_episode>=24} onClick={()=>void setActive(true)}><b>Разрешить публикации</b></button>)}
   </div>
   {campaign&&<p role="status">Текущий выпуск: {campaign.current_episode} из 24 ·
     Загружено: {campaign.loaded_episodes} · Утверждено: {campaign.approved_episodes} ·
     Опубликовано: {campaign.published_episodes}.
    </p>}
   {campaign?.prepared&&<>
    <div className="teacherDetails" style={{marginTop:12}}>
     <div className="teacherDetailsBody" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(235px,1fr))',gap:8}}>
      {campaign.episodes.map(item=><button key={item.episode_no} type="button"
       disabled={working||!item.loaded} aria-pressed={preview?.episode_no===item.episode_no}
       onClick={()=>void openEpisode(item)} className="teacherQuick" style={{textAlign:'left'}}>
       <b>{String(item.episode_no).padStart(2,'0')}. {item.title}</b>
       <small>Этап {item.stage_no} · {item.published?'Опубликовано':item.approved?'Утверждено':item.loaded?'Черновик':'Не загружено'}</small>
      </button>)}
     </div>
    </div>
    {preview&&<section className="surface" aria-label="Редактор сюжетного выпуска" style={{marginTop:12}}>
     <div className="surfaceHead"><div><small>ЭПИЗОД {preview.episode_no} · ЭТАП {preview.stage_no}</small>
      <h3>Редакция для публикации</h3></div></div>
     <p>{preview.evidence_rule}</p>
     <p><small>{preview.editor_note}</small></p>
     {preview.evidence?.kind&&<div className="processNotice" style={{margin:'12px 0'}}>
      <b>Подтверждённые сведения по игровым документам</b>
      <p><small>{preview.evidence.warning}</small></p>
      {preview.evidence.records.length===0
       ?<p><small>Подходящих подтверждённых записей пока нет. Не объявляйте положительный итог.</small></p>
       :<div style={{display:'grid',gap:5}}>{preview.evidence.records.map((record,i)=>
        <p key={i} style={{margin:0}}><small>{evidenceText(record)}</small></p>)}</div>}
     </div>}
     {!!preview.variants?.length&&!preview.published&&<div className="teacherDetails" style={{margin:'12px 0'}}>
      <p><b>Редакционные варианты финала</b></p>
      <p><small>Выбор только по документально подтверждённым решениям. Сначала сохранить редакцию, затем утвердить её и опубликовать. Никаких отдельных голосований.</small></p>
      <div className="teacherDetailsBody" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:8}}>
       {preview.variants.map(option=><button type="button" className="teacherQuick" key={option.id}
        style={{textAlign:'left'}} disabled={working}
        onClick={()=>{setTitle(option.title);setBody(option.body);}}>
        <b>{option.id} · {option.title}</b><small style={{display:'block'}}>{option.condition}</small></button>)}
      </div>
     </div>}
     <label>Заголовок<input value={title} disabled={working||preview.published}
      onChange={e=>setTitle(e.target.value)} maxLength={220}/></label>
     <label>Текст выпуска<textarea value={body} disabled={working||preview.published}
      onChange={e=>setBody(e.target.value)} rows={9} maxLength={9000}/></label>
     <div className="directorButtons compact">
      <button type="button" disabled={working||!change||preview.published}
       onClick={()=>void save()}><b>Сохранить редакцию</b></button>
      <button type="button" disabled={working||!!change||preview.published}
       onClick={()=>void approve(!selected?.approved)}><b>{selected?.approved?'Отозвать утверждение':'Утвердить редакцию'}</b></button>
      <button type="button" disabled={working||!!change||!selected?.approved||!campaign.enabled
       ||preview.published||preview.episode_no!==next}
       onClick={()=>void publish()}><b>Опубликовать</b></button>
     </div>
     {preview.episode_no!==next&&!preview.published&&<p><small>Следующий доступный по порядку эпизод — {next}.</small></p>}
    </section>}
   </>}
   {notice&&<p className="processNotice" role="status">{notice}</p>}
   {error&&<p className="processNotice" role="alert">{error}</p>}
  </div>
 </section>;
}