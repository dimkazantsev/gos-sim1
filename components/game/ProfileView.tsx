'use client';
import {useMemo,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';

export default function ProfileView({g}:{g:ReturnTypeRepublic}){
 const {me,profiles,parties,averageVsn,actions,saveProfile}=g;
 const mine=profiles.find(x=>x.user_id===me?.user_id);
 const party=parties.find(p=>p.name===me?.team);
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
    <label className="photoEdit">Изменить фото<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
   </div>
   <div className="profileIntro">
    <small>ЛИЧНЫЙ КАБИНЕТ</small>
    <h1>{me.full_name}</h1>
    <p>{me.role_title||'Участник деловой игры'}{party?' · '+party.name:''}</p>
    <div className="profileChips"><span>{me.group_name||'Группа не указана'}</span><span>ВСН {averageVsn?averageVsn.toFixed(1):'—'}</span><span>{actions.filter(a=>a.author_id===me.user_id).length} решений</span></div>
   </div>
  </section>

  <section className="profileGrid">
   <article className="surface profileEditor">
    <div className="surfaceHead"><div><small>О СЕБЕ В ИГРЕ</small><h2>Игровая визитка</h2></div></div>
    <p className="profileHint">Напишите коротко, какую роль вы играете, какие компетенции или интересы хотите подчеркнуть. Не добавляйте лишние персональные данные.</p>
    <textarea rows={8} maxLength={1000} value={bio} onChange={e=>setBio(e.target.value)} placeholder="Например: отвечаю за правовой анализ, переговоры и подготовку законопроектов…"/>
    {file&&<div className="selectedFile">Новое фото: <b>{file.name}</b></div>}
    <div className="profileSaveRow"><button className="primary" disabled={saving} onClick={save}>{saving?'Сохраняю…':'Сохранить профиль'}</button>{saved&&<span>✓ Сохранено</span>}</div>
   </article>

   <aside className="surface profileSummary">
    <div className="surfaceHead"><div><small>МОЯ ПОЗИЦИЯ</small><h2>В игре</h2></div></div>
    <dl><div><dt>Партия</dt><dd>{me.team||'Не назначена'}</dd></div><div><dt>Роль</dt><dd>{me.role_title||'Не назначена'}</dd></div><div><dt>ВСН</dt><dd>{averageVsn?averageVsn.toFixed(1):'—'}</dd></div><div><dt>Решения</dt><dd>{actions.filter(a=>a.author_id===me.user_id).length}</dd></div></dl>
    {mine?.bio&&<div className="profileBioPreview"><small>Описание</small><p>{mine.bio}</p></div>}
   </aside>
  </section>
 </div>;
}