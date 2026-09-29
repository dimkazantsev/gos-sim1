'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Activity,BookOpen,Camera,ChevronDown,FileSignature,UserRound,UsersRound} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
import GradesView from './GradesView';
import ClassroomJournal from './ClassroomJournal';
import SignatureUpload from './SignatureUpload';
import ProfileSecurityPanel from './ProfileSecurityPanel';
import RepublicComic from './RepublicComic';
import StyledSelect from '../ui/StyledSelect';

type PublicAssessment={stage_no:number;auto_score:number;final_score:number|null;status:string};
export default function ProfileView({g,targetUserId,onOpenProfile,onOwnProfile,readOnly=false}:{g:ReturnTypeRepublic;targetUserId?:string|null;onOpenProfile?:(id:string)=>void;onOwnProfile?:()=>void;readOnly?:boolean}){
 const {me,game,members,profiles,parties,partyInvitations,partyMandates,averageVsn,myEvaluations,actions,politicalPosts,ballots,formalDocuments,activities,saveProfile,teacher}=g;
 const target=members.find(m=>m.user_id===(targetUserId||me?.user_id))||me;
 const own=!readOnly&&target?.user_id===me?.user_id;
 const targetProfile=profiles.find(x=>x.user_id===target?.user_id);
 const party=parties.find(p=>p.name===target?.team);
 const allocation=party?partyMandates.find(x=>x.party_id===party.id&&x.user_id===target?.user_id):undefined;
 const pendingInvites=partyInvitations.filter(i=>i.invited_user_id===me?.user_id&&i.status==='pending');
 const [bio,setBio]=useState(targetProfile?.bio||'');
 const [file,setFile]=useState<File|null>(null),[photoPreview,setPhotoPreview]=useState('');
 const [saving,setSaving]=useState(false),[saved,setSaved]=useState(false),[showMyJournal,setShowMyJournal]=useState(false),[comicOpen,setComicOpen]=useState(false);
 const [publicScores,setPublicScores]=useState<PublicAssessment[]>([]),[search,setSearch]=useState('');
 const photoInput=useRef<HTMLInputElement>(null);
 const initials=useMemo(()=>target?.full_name.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()||'Я',[target?.full_name]);
 useEffect(()=>{setBio(targetProfile?.bio||'')},[target?.user_id,targetProfile?.bio]);
 useEffect(()=>{if(!file){setPhotoPreview('');return}const u=URL.createObjectURL(file);setPhotoPreview(u);return()=>URL.revokeObjectURL(u)},[file]);
 useEffect(()=>{
  if(!game||!target)return;
  let valid=true;
  void supabase.rpc('get_public_stage_scores',{p_game_id:game.id})
   .then(r=>{if(valid)setPublicScores((r.data||[]).filter(a=>a.user_id===target.user_id) as PublicAssessment[])});
  return()=>{valid=false};
 },[game?.id,target?.user_id]);
 if(!me||!target)return null;
 const counted=publicScores.map(s=>s.status==='final'?(s.final_score??s.auto_score):s.auto_score);
 const avg=counted.length?counted.reduce((a,b)=>a+b,0)/counted.length:null;
 const numberOfActions=actions.filter(a=>a.author_id===target.user_id).length;
 const numberOfPosts=politicalPosts.filter(p=>p.author_id===target.user_id).length;
 const numberOfVotes=ballots.filter(b=>b.voter_id===target.user_id).length;
 const numberOfDocuments=formalDocuments.filter(d=>d.author_id===target.user_id).length;
 const loggedActivity=activities.filter(a=>a.actor_id===target.user_id).length;
 async function save(){
  if(!own||saving)return;
  setSaving(true);setSaved(false);
  const ok=await saveProfile(bio,file||undefined);
  setSaving(false);if(ok){setSaved(true);setFile(null)}
 }
 function changeFile(next:File|undefined){
  if(!next)return;
  if(!['image/jpeg','image/png','image/webp','image/gif'].includes(next.type)||next.size>5*1024*1024){
   g.setError('Фото должно быть в формате JPEG, PNG, WebP или GIF размером до 5 МБ.');return;
  }
  setFile(next);setSaved(false);
 }
 return <div className="profilePage">
  <section className="profileHero">
   <div className="profilePhoto">
    {photoPreview||targetProfile?.avatar_url?<img src={photoPreview||targetProfile?.avatar_url||''} alt={'Фото: '+target.full_name}/>:<span>{initials}</span>}
    {own&&<><input ref={photoInput} type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Загрузить фотографию профиля"
     onChange={e=>{changeFile(e.target.files?.[0]);e.target.value=''}}/>
     <button type="button" className="profileCameraButton" title="Изменить фотографию" aria-label="Изменить фотографию профиля" onClick={()=>photoInput.current?.click()}><Camera size={20} aria-hidden="true"/></button></>}
   </div>
   <div className="profileIntro">
    <small>{own?'ЛИЧНЫЙ КАБИНЕТ':'ПУБЛИЧНЫЙ ПРОФИЛЬ ИГРОКА'}</small>
    <h1>{target.full_name}</h1>
    <p>{target.role_title||'Участник деловой игры'}{party?' · '+party.name:''}</p>
    <div className="profileChips">
     <span>{target.group_name||'Группа не указана'}</span>
     {target.kind==='student'&&<span>ВСН {avg!==null?avg.toFixed(2):'—'}</span>}
     <span>{numberOfActions} решений</span>{allocation&&<span>{allocation.effective_mandates} голосов в ГД</span>}
    </div>
    <div className="profileHeroControls">
     <button type="button" className="profileComicButton" onClick={()=>setComicOpen(true)}><BookOpen size={17}/> Комикс о Республике</button>
     {!own&&<button type="button" onClick={onOwnProfile}><UserRound size={17}/> Мой профиль</button>}
     {own&&file&&<button type="button" disabled={saving} className="primary" onClick={()=>void save()}>{saving?'Загрузка…':'Сохранить фотографию'}</button>}
    </div>
   </div>
  </section>

  <div className="profilePublicStrip">
   <div><UsersRound size={19}/><div><b>Профили участников</b><span>Должности, фракции, публичные оценки и участие в игре.</span></div></div>
   <StyledSelect label="Открыть профиль игрока" value={target.user_id} onChange={v=>v===me.user_id?onOwnProfile?.():onOpenProfile?.(v)}
    options={members.map(m=>({value:m.user_id,label:m.full_name+(m.role_title?' · '+m.role_title:'')}))}/>
  </div>

  {!own&&<>
   <section className="profilePublicStats">
    {[
     ['Принятые решения',numberOfActions],['Публикации',numberOfPosts],['Голосования',numberOfVotes],
     ['Созданные НПА',numberOfDocuments],['Действия в журнале',loggedActivity]
    ].map(([label,value])=><article key={label}><strong>{value}</strong><span>{label}</span></article>)}
   </section>
   <section className="profilePublicBiography surface"><h2>Игровая визитка</h2><p>{targetProfile?.bio||'Игрок пока не добавил описание.'}</p></section>
   {target.kind==='student'&&<section className="surface profilePublicScores"><header><h2>Публичные баллы по этапам</h2><strong>{avg===null?'—':avg.toFixed(2)}</strong></header>
    <div className="profileScoreCells">{Array.from({length:16},(_,i)=>{const row=publicScores.find(s=>s.stage_no===i+1);return <div key={i} className={row?.status||'empty'}><small>{i+1}</small><b>{row?(row.status==='final'?row.final_score??row.auto_score:row.auto_score):'—'}</b></div>})}</div>
    <p>Показаны только публичные результаты. Тексты, личные обоснования и внутренние материалы оценки не раскрываются.</p>
   </section>}
  </>}

  {own&&target.kind==='student'&&<GradesView g={g} compact/>}
  {own&&<section className="profileJournalAccess">
   <div><Activity size={19} aria-hidden="true"/><div><b>{teacher?'Мой журнал действий':'Личный журнал действий'}</b><span>История ваших действий и переходов по разделам игры.</span></div></div>
   <button type="button" aria-expanded={showMyJournal} onClick={()=>setShowMyJournal(!showMyJournal)}>{showMyJournal?'Скрыть журнал':'Открыть журнал'} <ChevronDown size={17} aria-hidden="true"/></button>
  </section>}
  {own&&showMyJournal&&<ClassroomJournal g={g}/>}

  <section className="profileGrid">
   {own&&<article className="surface profileEditor">
    <div className="surfaceHead"><div><small>О СЕБЕ В ИГРЕ</small><h2>Игровая визитка</h2></div></div>
    <p className="profileHint">Опишите свою игровую должность, интересы и компетенции. Этот текст смогут прочитать другие участники.</p>
    <textarea aria-label="О себе в игре" rows={3} maxLength={350} value={bio} onChange={e=>{setBio(e.target.value);setSaved(false)}}
      placeholder="Например: Отвечаю за переговоры и подготовку законопроектов…"/>
    <div className="profileSaveRow"><button className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Сохранение…':'Сохранить визитку'}</button><span>{bio.length}/350</span>{saved&&<span>✓ Сохранено</span>}</div>
    <SignatureUpload g={g}/>
    <ProfileSecurityPanel g={g}/>
   </article>}
   <aside className="surface profileSummary">
    <div className="surfaceHead"><div><small>ПРЕДСТАВИТЕЛЬСТВО</small><h2>Фракция и мандаты</h2></div></div>
    {party&&allocation?<div className="profileMandateCard">
      <div className="profilePartyLine"><span className="profilePartyDot" style={{background:party.color}}/><div><small>ПАРТИЯ / ФРАКЦИЯ</small><b>{party.name}</b></div></div>
      <div className="profileMandateStats"><div><strong>{allocation.base_mandates}</strong><span>Мандатов</span></div><div className={allocation.ghost_loss?'affected':''}><strong>{allocation.effective_mandates}</strong><span>Доступно голосов</span></div><div><strong>{allocation.ghost_loss}</strong><span>Потеря GV</span></div></div>
     </div>:own&&pendingInvites.length?<div className="profileInviteNote"><b>У вас {pendingInvites.length} приглашение(я) в партию.</b><span>Откройте раздел «Партии», чтобы принять или отклонить.</span></div>:<div className="emptyState">Партия пока не указана.</div>}
    <div className="profilePositionDivider"/>
    <div className="surfaceHead"><div><small>ИГРОВАЯ ПОЗИЦИЯ</small><h2>Роль в Республике</h2></div></div>
    <dl><div><dt>Партия</dt><dd>{target.team||'Не назначена'}</dd></div><div><dt>Должность</dt><dd>{target.role_title||'Не назначена'}</dd></div>{target.kind==='student'&&<div><dt>ВСН</dt><dd>{avg===null?'—':avg.toFixed(2)}</dd></div>}<div><dt>Решения</dt><dd>{numberOfActions}</dd></div></dl>
    {targetProfile?.bio&&<div className="profileBioPreview"><small>Описание</small><p>{targetProfile.bio}</p></div>}
   </aside>
  </section>
  <RepublicComic open={comicOpen} onClose={()=>setComicOpen(false)}/>
 </div>;
}
