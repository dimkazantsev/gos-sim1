'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import MediaUploadButton from './MediaUploadButton';
import GradesView from './GradesView';

export default function ProfileView({g}:{g:ReturnTypeRepublic}){
 const {me,profiles,parties,partyInvitations,partyMandates,averageVsn,myEvaluations,actions,saveProfile}=g;
 const mine=profiles.find(x=>x.user_id===me?.user_id);
 const party=parties.find(p=>p.name===me?.team);
 const allocation=party?partyMandates.find(x=>x.party_id===party.id&&x.user_id===me?.user_id):undefined;
 const pendingInvites=partyInvitations.filter(i=>i.invited_user_id===me?.user_id&&i.status==='pending');
 const hasVsn=myEvaluations.length>0;
 const [bio,setBio]=useState(mine?.bio||'');
 const [file,setFile]=useState<File|null>(null);
 const [saving,setSaving]=useState(false);
 const [saved,setSaved]=useState(false);
 const initials=useMemo(()=>me?.full_name.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase()||'Я',[me?.full_name]);
 if(!me)return null;
 async function save(){
  setSaving(true);setSaved(false);
  const ok=await saveProfile(bio,file||undefined);
  setSaving(false);if(ok){setSaved(true);setFile(null)}
 }
 return <div className="profilePage">
  <section className="profileHero">
   <div className="profilePhoto">
    {mine?.avatar_url?<img src={mine.avatar_url} alt="Фото профиля"/>:<span>{initials}</span>}
    <div className="photoEdit"><MediaUploadButton files={file?[file]:[]} onChange={x=>setFile(x[0]||null)} accept="image/jpeg,image/png,image/webp,image/gif" multiple={false} label="Фото" hint="Загрузить изображение" variant="avatar"/></div>
   </div>
   <div className="profileIntro">
    <small>ЛИЧНЫЙ КАБИНЕТ</small>
    <h1>{me.full_name}</h1>
    <p>{me.role_title||'Участник деловой игры'}{party?' · '+party.name:''}</p>
    <div className="profileChips"><span>{me.group_name||'Группа не указана'}</span><span>ВСН {hasVsn?averageVsn.toFixed(1):'—'}</span><span>{actions.filter(a=>a.author_id===me.user_id).length} решений</span>{allocation&&<span>{allocation.effective_mandates} голосов в ГД</span>}</div>
   </div>
  </section>

  <GradesView g={g} compact/>

  <section className="profileGrid">
   <article className="surface profileEditor">
    <div className="surfaceHead"><div><small>О СЕБЕ В ИГРЕ</small><h2>Игровая визитка</h2></div></div>
    <p className="profileHint">Напишите коротко, какую роль вы играете, какие компетенции или интересы хотите подчеркнуть. Не добавляйте лишние персональные данные.</p>
    <textarea aria-label="О себе в игре" rows={8} maxLength={1000} value={bio} onChange={e=>setBio(e.target.value)} placeholder="Например: отвечаю за правовой анализ, переговоры и подготовку законопроектов…"/>
    <MediaUploadButton files={file?[file]:[]} onChange={x=>setFile(x[0]||null)} accept="image/jpeg,image/png,image/webp,image/gif" multiple={false} label="Фото профиля" hint="Загрузить изображение" variant="avatar"/>
    <div className="profileSaveRow"><button className="primary" disabled={saving} onClick={save}>{saving?'Сохраняю…':'Сохранить профиль'}</button>{saved&&<span>✓ Сохранено</span>}</div>
   </article>

   <aside className="surface profileSummary">
    <div className="surfaceHead"><div><small>МОЁ ПРЕДСТАВИТЕЛЬСТВО</small><h2>Фракция и мандаты</h2></div></div>
    {party&&allocation?<div className="profileMandateCard">
      <div className="profilePartyLine"><span className="profilePartyDot" style={{background:party.color}}/><div><small>ПАРТИЯ / ФРАКЦИЯ</small><b>{party.name}</b></div></div>
      <div className="profileMandateStats"><div><strong>{allocation.base_mandates}</strong><span>мандатов представляю</span></div><div className={allocation.ghost_loss?'affected':''}><strong>{allocation.effective_mandates}</strong><span>голосов сейчас</span></div><div><strong>{allocation.ghost_loss}</strong><span>потеря GV</span></div></div>
      <p>Ваш голос в мандатном голосовании имеет вес <b>{allocation.effective_mandates}</b>. При изменении состава партии мандаты перераспределяются автоматически между всеми её студентами.</p>
      {party.ghost_active&&<div className="profileGhostNote">⚡ Ghost voting действует только на ближайшее заседание ГД: ваша временная потеря — {allocation.ghost_loss}.</div>}
     </div>:pendingInvites.length?<div className="profileInviteNote"><b>У вас {pendingInvites.length} приглашение(я) в партию.</b><span>Откройте раздел «Партии», чтобы принять или отклонить.</span></div>:<div className="emptyState">Вы пока не состоите в партии. Вступление возможно после приглашения руководителя и вашего согласия.</div>}

    <div className="profilePositionDivider"/>

    <div className="surfaceHead"><div><small>МОЯ ПОЗИЦИЯ</small><h2>В игре</h2></div></div>
    <dl><div><dt>Партия</dt><dd>{me.team||'Не назначена'}</dd></div><div><dt>Роль</dt><dd>{me.role_title||'Не назначена'}</dd></div><div><dt>ВСН</dt><dd>{hasVsn?averageVsn.toFixed(1):'—'}</dd></div><div><dt>Решения</dt><dd>{actions.filter(a=>a.author_id===me.user_id).length}</dd></div></dl>
    {mine?.bio&&<div className="profileBioPreview"><small>Описание</small><p>{mine.bio}</p></div>}
   </aside>
  </section>
 </div>;
}