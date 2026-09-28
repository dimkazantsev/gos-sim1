'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function Home(){
  const router = useRouter();
  const [mode,setMode]=useState<'student'|'teacher'>('student');
  const [createMode,setCreateMode]=useState(false);
  const [gameTitle,setGameTitle]=useState('Моделирование ПАУ/ГПУ');
  const [studentCode,setStudentCode]=useState('');
  const [fio,setFio]=useState('');
  const [group,setGroup]=useState('');
  const [gameCode,setGameCode]=useState('');
  const [invite,setInvite]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function submit(e:FormEvent){
    e.preventDefault(); setBusy(true); setError('');
    try{
      const { data:sessionData } = await supabase.auth.getSession();
      if(!sessionData.session){
        const {error:authError}=await supabase.auth.signInAnonymously({options:{data:{full_name:fio}}});
        if(authError) throw authError;
      }
      if(mode==='teacher' && createMode){
        const { data:gameId, error:createError } = await supabase.rpc('create_game_session', {
          p_title: gameTitle,
          p_game_code: gameCode,
          p_teacher_code: invite,
          p_student_code: studentCode,
          p_teacher_name: fio
        });
        if(createError) throw createError;
        router.push(`/game/${gameId}`);
      }else{
        const { data:gameId, error:joinError } = await supabase.rpc('join_game_with_code', {
          p_game_code: gameCode,
          p_invite_code: invite,
          p_full_name: fio,
          p_group_name: mode==='student'?group:null
        });
        if(joinError) throw joinError;
        router.push(`/game/${gameId}`);
      }
    }catch(err){setError(err instanceof Error?err.message:'Не удалось войти');}
    finally{setBusy(false);}
  }

  return <main className="loginPage">
    <div className="gridGlow"/>
    <form className="loginCard" onSubmit={submit}>
      <div className="logoRow"><div className="logo">G//SS</div><div><small>POLITICAL & PUBLIC ADMINISTRATION LAB</small><h1>GOS//SIMS</h1></div></div>
      <p className="muted">Вход в игровую сессию. ФИО сохраняется в профиле участника и протоколе игры.</p>
      <div className="seg"><button type="button" className={mode==='student'?'active':''} onClick={()=>{setMode('student');setCreateMode(false)}}>Студент</button><button type="button" className={mode==='teacher'?'active':''} onClick={()=>setMode('teacher')}>Преподаватель</button></div>{mode==='teacher'&&<div className="seg"><button type="button" className={!createMode?'active':''} onClick={()=>setCreateMode(false)}>Войти</button><button type="button" className={createMode?'active':''} onClick={()=>setCreateMode(true)}>Создать игру</button></div>}
      <label>ФИО<input value={fio} onChange={e=>setFio(e.target.value)} required /></label>
      {mode==='teacher'&&createMode&&<label>Название игры<input value={gameTitle} onChange={e=>setGameTitle(e.target.value)} required /></label>}
      <label>Код игры<input value={gameCode} onChange={e=>setGameCode(e.target.value)} placeholder="GPU-2026" required /></label>
      {mode==='student'&&<label>Учебная группа<input value={group} onChange={e=>setGroup(e.target.value)} /></label>}
      <label>{mode==='teacher'?'Код преподавателя':'Код участника'}<input type="password" value={invite} onChange={e=>setInvite(e.target.value)} required /></label>{mode==='teacher'&&createMode&&<label>Код для студентов<input type="password" value={studentCode} onChange={e=>setStudentCode(e.target.value)} required /></label>}
      {error&&<div className="errorBox">{error}</div>}
      <button className="primary" disabled={busy}>{busy?'Подключение…':'Войти в государство'}</button>
    </form>
  </main>
}
