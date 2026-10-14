'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Activity,BookOpen,BookOpenCheck,Camera,ChevronDown,Compass,FileSignature,Library,UserRound,UsersRound} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import {AwardShelf} from './Achievements';
import GradesView from './GradesView';
import ClassroomJournal from './ClassroomJournal';
import SignatureUpload from './SignatureUpload';
import ProfileSecurityPanel from './ProfileSecurityPanel';
import RepublicComic from './RepublicComic';
import {BlitzArchive} from './Blitz';
import SessionManager from './SessionManager';
import StyledSelect from '../ui/StyledSelect';
import {cropPortrait,decodePortrait,preparePortraitDetector} from './avatarCrop';
import ProfileAvatar from './ProfileAvatar';
import ProfileDocumentLinks from './ProfileDocumentLinks';
import ProfileOffices from './ProfileOffices';
import TelegramConnection from './TelegramConnection';
import AssignedTasks from './AssignedTasks';
import {ListTodo} from 'lucide-react';
import type {ProfileSetupStatus,ProfileSetupField} from './profileSetup';
import {PROFILE_SETUP_LABELS} from './profileSetup';
import {currentGameMembers,currentGameProfiles} from './gameRoster';

type PublicAssessment={stage_no:number;auto_score:number;final_score:number|null;status:string};
type PublicStats={accepted_actions:number;posts:number;votes_cast:number;documents_created:number;activity_entries:number;events_decided:number};
export default function ProfileView({g,targetUserId,onOpenProfile,onOwnProfile,onStartTutorial,previewAchievementsUserId,readOnly=false,setupStatus=null,setupNotice='',setupFocusVersion=0,onProfileChanged,onFinishSetup,pendingBlitz=0}:{g:ReturnTypeRepublic;targetUserId?:string|null;onOpenProfile?:(id:string)=>void;onOwnProfile?:()=>void;onStartTutorial?:()=>void;previewAchievementsUserId?:string;readOnly?:boolean;setupStatus?:ProfileSetupStatus|null;setupNotice?:string;setupFocusVersion?:number;onProfileChanged?:()=>void;onFinishSetup?:()=>void;pendingBlitz?:number}){
 const {me,game,parties,partyInvitations,partyMandates,averageVsn,myEvaluations,politicalPosts,ballots,formalDocuments,activities,saveProfile,teacher}=g;
 const members=useMemo(()=>currentGameMembers(g.members,game?.id||''),[g.members,game?.id]);
 const profiles=useMemo(()=>currentGameProfiles(g.profiles,members,game?.id||''),[g.profiles,members,game?.id]);
 const target=members.find(m=>m.user_id===(targetUserId||me?.user_id))||me;
 const own=!readOnly&&target?.user_id===me?.user_id;
 const targetProfile=profiles.find(x=>x.user_id===target?.user_id);
 const party=parties.find(p=>p.name===target?.team);
 const allocation=party?partyMandates.find(x=>x.party_id===party.id&&x.user_id===target?.user_id):undefined;
 const pendingInvites=partyInvitations.filter(i=>i.invited_user_id===me?.user_id&&i.status==='pending');
 const [tasksOpen,setTasksOpen]=useState(false);
 const [blitzOpen,setBlitzOpen]=useState(false);
 useEffect(()=>{if(typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('tasks')==='1')setTasksOpen(true)},[game?.id]);
 const [bio,setBio]=useState(targetProfile?.bio||'');
 const [fullName,setFullName]=useState(target?.full_name||'');
 const [gender,setGender]=useState<'male'|'female'|'unspecified'>(targetProfile?.gender||'unspecified');
 const [photoBusy,setPhotoBusy]=useState(false);
 const [photoPreview,setPhotoPreview]=useState('');
 const [customRole,setCustomRole]=useState('');
 const [roleSaving,setRoleSaving]=useState(false);
 const previewRef=useRef('');
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;void preparePortraitDetector().catch(()=>{});return()=>{mounted.current=false;if(previewRef.current)URL.revokeObjectURL(previewRef.current)}},[]);
 useEffect(()=>{if(previewRef.current)URL.revokeObjectURL(previewRef.current);previewRef.current='';setPhotoPreview('')},[target?.user_id]);
 const [saving,setSaving]=useState(false),[saved,setSaved]=useState(false),[showMyJournal,setShowMyJournal]=useState(false),[comicOpen,setComicOpen]=useState(false);
 const [comicView,setComicView]=useState<'intro'|'archive'>('intro');
 const [publicScores,setPublicScores]=useState<PublicAssessment[]>([]);
 const [publicStats,setPublicStats]=useState<PublicStats|null>(null);
 const photoInput=useRef<HTMLInputElement>(null);
 const initials=useMemo(()=>target?.full_name.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()||'Я',[target?.full_name]);
 useEffect(()=>{setFullName(target?.full_name||'');setBio(targetProfile?.bio||'');setGender(targetProfile?.gender||'unspecified')},[target?.user_id,targetProfile?.bio,targetProfile?.gender]);
 const setupMissing=setupStatus?.completed?[]:(setupStatus?.missing||[]);
 const needs=(field:ProfileSetupField)=>own&&setupMissing.includes(field);
 useEffect(()=>{
  if(!own||setupFocusVersion<=0)return;
  const key=setupMissing[0];if(!key)return;
  const frame=requestAnimationFrame(()=>{
   const panel=document.querySelector<HTMLElement>('[data-profile-setup-field="'+key+'"]');
   panel?.scrollIntoView({behavior:'smooth',block:'center'});
   const input=panel?.querySelector<HTMLElement>('input:not([type="hidden"]),textarea,button,select,[tabindex="0"]');
   (input||panel)?.focus({preventScroll:true});
  });
  return()=>cancelAnimationFrame(frame);
 },[setupFocusVersion,own]);


 useEffect(()=>{
  if(!game||!target)return;
  let valid=true;
  void supabase.rpc('get_public_stage_scores',{p_game_id:game.id})
   .then(r=>{if(valid)setPublicScores(((r.data||[]) as (PublicAssessment & {user_id:string})[]).filter(a=>a.user_id===target.user_id))});
  return()=>{valid=false};
 },[game?.id,target?.user_id]);
 useEffect(()=>{
  if(!game||!target||previewAchievementsUserId)return;
  let active=true;setPublicStats(null);
  void supabase.rpc('get_member_public_stats',{p_game_id:game.id,p_user_id:target.user_id})
   .then(r=>{if(active&&!r.error&&r.data?.[0])setPublicStats(r.data[0] as PublicStats)});
  return()=>{active=false};
 },[game?.id,target?.user_id,previewAchievementsUserId]);
 if(!me||!target)return null;
 const counted=publicScores.map(s=>s.status==='final'?(s.final_score??s.auto_score):s.auto_score);
 const avg=counted.length?counted.reduce((a,b)=>a+b,0)/counted.length:null;
 const numberOfPosts=politicalPosts.filter(p=>p.author_id===target.user_id).length;
 const numberOfVotes=ballots.filter(b=>b.voter_id===target.user_id).length;
 const numberOfDocuments=formalDocuments.filter(d=>d.author_id===target.user_id).length;
 const loggedActivity=publicStats?.activity_entries??null;
 async function save(){
  if(!own||saving)return;
  setSaving(true);setSaved(false);
  if(game&&me&&fullName.trim()!==me.full_name.trim()){
   const identity=await supabase.rpc('update_my_game_identity',{p_game:game.id,p_full_name:fullName.trim(),p_gender:gender});
   if(identity.error){g.setError(identity.error.message);setSaving(false);return}
  }
  const ok=await saveProfile(bio,undefined,gender);
  if(ok){await g.refresh();onProfileChanged?.()}setSaving(false);if(ok){setSaved(true)}
 }
 async function changeFile(next:File|undefined){
  if(!next||!own||photoBusy)return;
  if(!['image/jpeg','image/png','image/webp'].includes(next.type)||next.size>5*1024*1024){
   g.setError('Фото должно быть в формате JPEG, PNG или WebP размером до 5 МБ.');return;
  }
  setPhotoBusy(true);setSaved(false);
  let nextUrl='';
  try{
   const cropped=await cropPortrait(next);
   const url=URL.createObjectURL(cropped);
   nextUrl=url;
   await decodePortrait(url);
   const ok=await saveProfile(bio,cropped,gender);
   if(!mounted.current){URL.revokeObjectURL(url);return}
   if(ok){
    const previous=previewRef.current;previewRef.current=url;setPhotoPreview(url);
    nextUrl='';
    if(previous)URL.revokeObjectURL(previous);
   }else{URL.revokeObjectURL(url);g.setError('Не удалось сохранить фотографию. Попробуйте ещё раз.')}

  }catch(err){g.setError(err instanceof Error?err.message:'Не удалось обработать фотографию.')}
  finally{if(nextUrl)URL.revokeObjectURL(nextUrl);if(mounted.current)setPhotoBusy(false)}
 }
 if(tasksOpen&&game&&me)return <AssignedTasks gameId={game.id} userId={me.user_id} teacher={teacher} members={members} onBack={()=>setTasksOpen(false)}/>;
 return <div className="profilePage">
  <section className="profileHero">
   <div className="profilePhoto">
    <ProfileAvatar key={target.user_id} src={photoPreview||targetProfile?.avatar_url} name={target.full_name} gender={own?gender:targetProfile?.gender}/>
    {own&&<><input ref={photoInput} type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label="Загрузить фотографию профиля"
     onChange={e=>{void changeFile(e.target.files?.[0]);e.target.value=''}}/>
     <button type="button" className="profileCameraButton" title="Изменить фотографию" aria-label="Изменить фотографию профиля" disabled={photoBusy} onClick={()=>photoInput.current?.click()}><Camera size={20} aria-hidden="true"/></button></>}
   </div>
   <div className="profileIntro">
    <small>{own?'ЛИЧНЫЙ КАБИНЕТ':'ПУБЛИЧНЫЙ ПРОФИЛЬ ИГРОКА'}</small>
    <h1>{target.full_name}</h1>
    <p>{target.role_title||'Участник деловой игры'}{party?' · '+party.name:''}</p>
    <div className="profileChips">
     <span>{target.kind==='teacher'?'Преподаватель':target.kind==='observer'?'Гость':'Участник'}</span>
     {target.kind==='student'&&target.group_name&&<span>Группа: {target.group_name}</span>}
     {target.kind==='student'&&<span>ВСН {avg!==null?avg.toFixed(2):'—'}</span>}
     {allocation&&<span>{allocation.effective_mandates} голосов в ГД</span>}
    </div>
    <div className="profileHeroControls">
     <button type="button" className="profileComicButton" aria-label="Вводный комикс" onClick={()=>{setComicView('intro');setComicOpen(true)}}><BookOpen size={17}/> Пролог</button>
     <button type="button" onClick={()=>{setComicView('archive');setComicOpen(true)}}><Library size={17}/> Архив комиксов</button>
     {own&&onStartTutorial&&<button type="button" onClick={onStartTutorial} title="Повторить интерактивное обучение навигации"><Compass size={17}/> Пройти обучение</button>}
     {own&&target.kind==='student'&&game&&<button type="button" onClick={()=>setBlitzOpen(true)} aria-haspopup="dialog" aria-label={'Блиц-вопросы'+(pendingBlitz?' — ответ не дан: '+pendingBlitz:'')}><BookOpenCheck size={17}/> Блиц-вопросы {pendingBlitz>0&&<span className="profileBlitzButtonBadge" aria-hidden="true">{pendingBlitz>99?'99+':pendingBlitz}</span>}</button>}
     {own&&target.kind!=='observer'&&<button type="button" onClick={()=>setTasksOpen(true)}><ListTodo size={17}/> Назначить задачу</button>}

     {!own&&<button type="button" onClick={onOwnProfile}><UserRound size={17}/> Мой профиль</button>}

    </div>
   </div>
  </section>

  <ProfileOffices g={g} userId={target.user_id} readOnly={readOnly}/>
  {own&&teacher&&<section className="profileRoleSwitcher">
   <div><small>Права администратора сохраняются</small><h2>Игровая должность преподавателя</h2><p>По умолчанию вы нейтральный преподаватель. При желании можете занять любую игровую должность. Это не меняет полномочия преподавателя.</p></div>
   <StyledSelect label="Действовать в игре как" value={me.role_title||'Преподаватель'}
    onChange={v=>void g.updateMember(me.user_id,{role_title:v})}
    options={[...new Set(['Преподаватель','Президент Российской Федерации','Председатель Правительства Российской Федерации',
     'Депутат Государственной Думы','Председатель Государственной Думы','Министр финансов','Министр экономики',
     'Министр здравоохранения','Министр образования','Министр культуры','Председатель Банка России',
     'Глава муниципального образования','Глава городской администрации','Сенатор Совета Федерации',
     'Руководитель регионального органа власти','Редактор средств массовой информации',
     ...members.map(m=>m.role_title||'')].filter(Boolean))].map(v=>({value:v,label:v}))}/>
   <form className="profileCustomRole" onSubmit={async e=>{e.preventDefault();if(roleSaving||!customRole.trim())return;setRoleSaving(true);const ok=await g.updateMember(me.user_id,{role_title:customRole.trim()});if(ok)setCustomRole('');setRoleSaving(false)}}>
    <label>Другая игровая должность<input value={customRole} onChange={e=>setCustomRole(e.target.value)} maxLength={180} placeholder="Укажите любую должность из правил игры"/></label>
    <button type="submit" disabled={roleSaving||!customRole.trim()}>Принять должность</button>
   </form>
  </section>}
  <div className="profilePublicStrip">
   <div><UsersRound size={19}/><div><b>Профили участников</b><span>Должности, фракции, публичные оценки и участие в игре.</span></div></div>
   <StyledSelect label="Открыть профиль игрока" value={target.user_id} onChange={v=>v===me.user_id?onOwnProfile?.():onOpenProfile?.(v)}
    options={members.map(m=>({value:m.user_id,label:m.full_name+(m.role_title?' · '+m.role_title:'')}))}/>
  </div>

  {!own&&<>
   <section className="profilePublicStats">
    {[
     ['Публикации',publicStats?.posts],['Голосования',publicStats?.votes_cast],
     ['Созданные НПА',publicStats?.documents_created],['Действия в журнале',publicStats?.activity_entries],['Ответы на события',publicStats?.events_decided]
    ].map(([label,value])=><article key={label}><strong>{value??'—'}</strong><span>{label}</span></article>)}
   </section>
   <section className="profilePublicBiography surface"><h2>Игровая визитка</h2><p>{targetProfile?.bio||'Игрок пока не добавил описание.'}</p></section>
   {target.kind==='student'&&<section className="surface profilePublicScores"><header><h2>Публичные баллы по этапам</h2><strong>{avg===null?'—':avg.toFixed(2)}</strong></header>
    <div className="profileScoreCells">{Array.from({length:16},(_,i)=>{const row=publicScores.find(s=>s.stage_no===i+1);return <div key={i} className={row?.status||'empty'}><small>{i+1}</small><b>{row?(row.status==='final'?row.final_score??row.auto_score:row.auto_score):'—'}</b></div>})}</div>
    <p>Показаны только публичные результаты. Тексты, личные обоснования и внутренние материалы оценки не раскрываются.</p>
   </section>}
  </>}

  
  {game&&target.kind==='student'&&<AwardShelf gameId={game.id} userId={previewAchievementsUserId||target.user_id} showCatalog={own||teacher||!!previewAchievementsUserId} previewOnly={!!previewAchievementsUserId} defaultCollapsed/>}
  {own&&target.kind==='student'&&<GradesView g={g} compact/>}
  {own&&<section className="profileJournalAccess">
   <div><Activity size={19} aria-hidden="true"/><div><b>{teacher?'Мой журнал действий':'Личный журнал действий'}</b><span>История ваших действий и переходов по разделам игры.</span></div></div>
   <button type="button" aria-expanded={showMyJournal} onClick={()=>setShowMyJournal(!showMyJournal)}>{showMyJournal?'Скрыть журнал':'Открыть журнал'} <ChevronDown size={17} aria-hidden="true"/></button>
  </section>}
  {own&&showMyJournal&&<ClassroomJournal g={g}/>}

  <section className="profileGrid">
   {own&&<article className="surface profileEditor" id="profile-setup-editor">
    <div className="surfaceHead"><div><small>О СЕБЕ В ИГРЕ</small><h2>Игровая визитка</h2></div></div>{!targetProfile?.onboarding_completed_at&&<div className={'profileOnboardingHint'+(setupMissing.length?' isIncomplete':'')} role="status"><strong>{setupMissing.length?'Профиль заполнен не полностью':'Обязательная настройка профиля'}</strong><p>{setupMissing.length?'Заполните отмеченные красным поля. После сохранения нажмите «Закончить настройку» здесь.':'Проверьте ФИО, пол, описание, подпись, почту и личный пароль.'}</p>{setupMissing.length>0&&<div className="profileSetupMissingList">{setupMissing.map(k=><span key={k}>{PROFILE_SETUP_LABELS[k]}</span>)}</div>}</div>}
    {setupNotice&&<p className="profileSetupFeedback" role="status">{setupNotice}</p>}
    <label data-profile-setup-field="name" className={'profileFullNameField'+(needs('name')?' profileSetupInvalid':'')}>Фамилия, имя и отчество<input aria-invalid={needs('name')} autoComplete="name" value={fullName} onChange={e=>setFullName(e.target.value)} minLength={5} placeholder="Иванов Иван Иванович"/></label>
    <p className="profileHint">Опишите свою игровую должность, интересы и компетенции. Этот текст смогут прочитать другие участники.</p>
    <div data-profile-setup-field="gender" className={needs('gender')?'profileSetupInvalid':''}><StyledSelect label="Пол для оформления аватара" value={gender} onChange={v=>setGender(v as typeof gender)} options={[{value:"unspecified",label:"Выберите пол"},{value:"male",label:"Мужской"},{value:"female",label:"Женский"}]}/>{needs('gender')&&<small className="profileSetupFieldError">Обязательное поле</small>}</div>
    <div data-profile-setup-field="bio" className={needs('bio')?'profileSetupInvalid':''}><textarea aria-invalid={needs('bio')} aria-label="О себе в игре" rows={3} maxLength={350} value={bio} onChange={e=>{setBio(e.target.value);setSaved(false)}}
      placeholder="Например: Отвечаю за переговоры и подготовку законопроектов…"/>{needs('bio')&&<small className="profileSetupFieldError">Укажите не менее 15 символов</small>}</div>
    <div className="profileSaveRow"><button className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Сохранение…':'Сохранить визитку'}</button><span>{bio.length}/350</span>{saved&&<span>✓ Сохранено</span>}</div>
    <div data-profile-setup-field="signature" className={needs('signature')?'profileSetupInvalid':''}><SignatureUpload g={g} onSaved={onProfileChanged}/>{needs('signature')&&<small className="profileSetupFieldError">Загрузите и сохраните подпись</small>}</div>
    <ProfileSecurityPanel g={g} missing={setupMissing} onChanged={onProfileChanged}/>
    {!targetProfile?.onboarding_completed_at&&<div className="profileSetupFinish"><button type="button" className="primary" onClick={onFinishSetup}>Закончить настройку</button><p>После подтверждения всех полей предупреждения исчезнут навсегда.</p></div>}
   </article>}
   <aside className="surface profileSummary">
    <div className="surfaceHead"><div><small>ПРЕДСТАВИТЕЛЬСТВО</small><h2>Фракция и мандаты</h2></div></div>
    {party&&allocation?<div className="profileMandateCard">
      <div className="profilePartyLine"><span className="profilePartyDot" style={{background:party.color}}/><div><small>ПАРТИЯ / ФРАКЦИЯ</small><b>{party.name}</b></div></div>
      <div className="profileMandateStats"><div><strong>{allocation.base_mandates}</strong><span>Мандатов</span></div><div className={allocation.ghost_loss?'affected':''}><strong>{allocation.effective_mandates}</strong><span>Доступно голосов</span></div><div><strong>{allocation.ghost_loss}</strong><span>Потеря GV</span></div></div>
     </div>:own&&pendingInvites.length?<div className="profileInviteNote"><b>У вас {pendingInvites.length} приглашение(я) в партию.</b><span>Откройте раздел «Партии», чтобы принять или отклонить.</span></div>:<div className="emptyState">Партия пока не указана.</div>}
    <div className="profilePositionDivider"/>
    <div className="surfaceHead"><div><small>ИГРОВАЯ ПОЗИЦИЯ</small><h2>Роль в Республике</h2></div></div>
    <dl><div><dt>Партия</dt><dd>{target.team||'Не назначена'}</dd></div><div><dt>Должность</dt><dd>{target.role_title||'Не назначена'}</dd></div>{target.kind==='student'&&<div><dt>ВСН</dt><dd>{avg===null?'—':avg.toFixed(2)}</dd></div>}</dl>
    {targetProfile?.bio&&<div className="profileBioPreview"><small>Описание</small><p>{targetProfile.bio}</p></div>}
   </aside>
  </section>
  {own&&game&&<TelegramConnection gameId={game.id} teacher={teacher}/>}
  {own&&game&&<ProfileDocumentLinks gameId={game.id} userId={me.user_id}/>}
  {own&&teacher&&<SessionManager g={g}/>}
  {own&&game&&target.kind==='student'&&!previewAchievementsUserId&&<BlitzArchive gameId={game.id} userId={target.user_id} open={blitzOpen} onClose={()=>setBlitzOpen(false)}/>}
  <RepublicComic gameId={game?.id} initialView={comicView} teacherPreview={Boolean(own&&teacher)} open={comicOpen} onClose={()=>setComicOpen(false)}/>
 </div>;
}
