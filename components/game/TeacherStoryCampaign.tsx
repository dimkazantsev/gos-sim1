'use client';
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';

type StoryStatus={
 prepared:boolean;enabled:boolean;current_episode:number;
 approved_episodes:number;total_episodes:number;
 metrics_enabled:boolean;publication_enabled:boolean;
};

/**
 * Teacher-only, opt-in shell. Contains no scenario content, endings, coefficients,
 * timers, queries on mount, channels or subscriptions. Future scripts belong
 * exclusively in Supabase private schema, never in this public source file.
 */
export default function TeacherStoryCampaign({gameId}:{gameId:string}){
 const [status,setStatus]=useState<StoryStatus|null>(null);
 const [working,setWorking]=useState(false);
 const [checked,setChecked]=useState(false);
 const [error,setError]=useState('');
 const query=async(prepare:boolean)=>{
  if(working)return;
  setWorking(true);setError('');
  try{
   const response=prepare
    ?await supabase.rpc('prepare_story_campaign_teacher',{p_game_id:gameId})
    :await supabase.rpc('get_story_campaign_teacher',{p_game_id:gameId});
   if(response.error)throw response.error;
   if(!response.data||typeof response.data!=='object'||Array.isArray(response.data))throw Error('Статус кампании недоступен.');
   setStatus(response.data as StoryStatus);
   setChecked(true);
  }catch(e){setError(userError(e));}finally{setWorking(false);}
 };
 return <section className="surface" aria-labelledby="story-campaign-title">
  <div className="surfaceHead">
   <div>
    <small>ПРЕПОДАВАТЕЛЬ · СОБЫТИЯ</small>
    <h2 id="story-campaign-title">Сюжетная кампания</h2>
    <p>Закрытая подготовка генеральной линии. Не показывается участникам до отдельного разрешения.</p>
   </div>
   <span className="sectionUnreadBadge">{status?.enabled?'Активна':'Выключена'}</span>
  </div>
  <div className="teacherDetailsBody">
   <p>24 эпизода · этапы 4–14. Этапы 15–16 не изменяются.</p>
   {checked&&status&&<p role="status">
    {status.prepared?'Закрытое состояние игры подготовлено.':'Для этой игры кампания ещё не подготовлена.'}
    {' '}Утверждённых эпизодов: {status.approved_episodes} из {status.total_episodes}.
    {' '}Публикации и числовые последствия выключены.
   </p>}
   <div className="directorButtons compact">
    <button type="button" disabled={working} onClick={()=>void query(false)}>
     <b>{working?'Проверка…':'Проверить состояние'}</b>
    </button>
    {checked&&!status?.prepared&&<button type="button" disabled={working} onClick={()=>void query(true)}>
     <b>Подготовить закрытую кампанию</b>
    </button>}
   </div>
   {error&&<p className="processNotice" role="alert">{error}</p>}
   <small>Нет фоновых запросов, отдельной подписки, предварительной загрузки эпизодов или автоматического изменения показателей.</small>
  </div>
 </section>;
