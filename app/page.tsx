'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function readableError(err: unknown){
  const raw =
    err && typeof err === 'object' && 'message' in err
      ? String((err as {message?: unknown}).message ?? '')
      : err instanceof Error
        ? err.message
        : '';

  if(raw.includes('Invite codes must be at least 4 characters')){
    return 'Коды преподавателя и студентов должны содержать не менее 4 символов.';
  }
  if(raw.includes('Teacher and student codes must be different')){
    return 'Код преподавателя и код студентов должны отличаться.';
  }
  if(raw.includes('Invalid game or invite code')){
    return 'Неверный код игры или код участника.';
  }
  if(raw.includes('Authentication required')){
    return 'Не удалось авторизовать участника. Обновите страницу и попробуйте снова.';
  }
  if(raw.includes('duplicate key value') || raw.includes('games_game_code_key')){
    return 'Игра с таким кодом уже существует. Укажите другой код игры.';
  }
  return raw || 'Не удалось выполнить вход. Попробуйте ещё раз.';
}

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
    e.preventDefault();
    setBusy(true);
    setError('');

    try{
      const cleanFio=fio.trim();
      const cleanGameCode=gameCode.trim();
      const cleanInvite=invite.trim();
      const cleanStudentCode=studentCode.trim();

      if(cleanFio.length<2) throw new Error('Введите ФИО.');
      if(!cleanGameCode) throw new Error('Введите код игры.');
      if(cleanInvite.length<4){
        throw new Error(mode==='teacher'&&createMode
          ? 'Код преподавателя должен содержать не менее 4 символов.'
          : 'Код участника должен содержать не менее 4 символов.');
      }
      if(mode==='teacher'&&createMode){
        if(cleanStudentCode.length<4){
          throw new Error('Код для студентов должен содержать не менее 4 символов.');
        }
        if(cleanStudentCode===cleanInvite){
          throw new Error('Код преподавателя и код студентов должны отличаться.');
        }
      }

      const { data:sessionData } = await supabase.auth.getSession();
      if(!sessionData.session){
        const {error:authError}=await supabase.auth.signInAnonymously({
          options:{data:{full_name:cleanFio}}
        });
        if(authError) throw authError;
      }

      if(mode==='teacher' && createMode){
        const { data:gameId, error:createError } = await supabase.rpc('create_game_session', {
          p_title: gameTitle.trim(),
          p_game_code: cleanGameCode,
          p_teacher_code: cleanInvite,
          p_student_code: cleanStudentCode,
          p_teacher_name: cleanFio
        });
        if(createError) throw createError;
        router.push(`/game/${gameId}`);
      }else{
        const { data:gameId, error:joinError } = await supabase.rpc('join_game_with_code', {
          p_game_code: cleanGameCode,
          p_invite_code: cleanInvite,
          p_full_name: cleanFio,
          p_group_name: mode==='student'?group.trim():null
        });
        if(joinError) throw joinError;
        router.push(`/game/${gameId}`);
      }
    }catch(err){
      setError(readableError(err));
    }finally{
      setBusy(false);
    }
  }

  return <main className="loginPage">
    <div className="gridGlow"/>
    <form className="loginCard" onSubmit={submit}>
      <div className="logoRow"><div className="logo">G//S</div><div><small>POLITICAL & PUBLIC ADMINISTRATION LAB</small><h1>GOS//SIM</h1></div></div>
      <p className="muted">Вход в игровую сессию. ФИО сохраняется в профиле участника и протоколе игры.</p>

      <div className="seg">
        <button type="button" className={mode==='student'?'active':''} onClick={()=>{setMode('student');setCreateMode(false);setError('')}}>Студент</button>
        <button type="button" className={mode==='teacher'?'active':''} onClick={()=>{setMode('teacher');setError('')}}>Преподаватель</button>
      </div>

      {mode==='teacher'&&<div className="seg">
        <button type="button" className={!createMode?'active':''} onClick={()=>{setCreateMode(false);setError('')}}>Войти</button>
        <button type="button" className={createMode?'active':''} onClick={()=>{setCreateMode(true);setError('')}}>Создать игру</button>
      </div>}

      <label>ФИО
        <input value={fio} onChange={e=>setFio(e.target.value)} required />
      </label>

      {mode==='teacher'&&createMode&&<label>Название игры
        <input value={gameTitle} onChange={e=>setGameTitle(e.target.value)} required />
      </label>}

      <label>Код игры
        <input value={gameCode} onChange={e=>setGameCode(e.target.value)} placeholder="Например: GPU-2026" required />
      </label>

      {mode==='student'&&<label>Учебная группа
        <input value={group} onChange={e=>setGroup(e.target.value)} />
      </label>}

      <label>{mode==='teacher'?'Код преподавателя':'Код участника'}
        <input
          type="password"
          value={invite}
          minLength={4}
          onChange={e=>setInvite(e.target.value)}
          required
        />
        <small className="muted">Минимум 4 символа.</small>
      </label>

      {mode==='teacher'&&createMode&&<label>Код для студентов
        <input
          type="password"
          value={studentCode}
          minLength={4}
          onChange={e=>setStudentCode(e.target.value)}
          required
        />
        <small className="muted">Минимум 4 символа и не должен совпадать с кодом преподавателя.</small>
      </label>}

      {error&&<div className="errorBox">{error}</div>}

      <button className="primary" disabled={busy}>
        {busy?'Подключение…':mode==='teacher'&&createMode?'Создать государство':'Войти в государство'}
      </button>
    </form>
  </main>
}
