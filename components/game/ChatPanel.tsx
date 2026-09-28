'use client';
import {useEffect,useRef,useState} from 'react';
import {Mic,Send,Video,X} from 'lucide-react';
import type {ReturnTypeRepublic} from './viewTypes';
import {initials} from './constants';
import MediaUploadButton from './MediaUploadButton';
import {useDialog} from '../ui/useDialog';

export default function ChatPanel({g,draft:text,onDraftChange:setText}:{g:ReturnTypeRepublic;draft:string;onDraftChange:(text:string)=>void}){
 const {channels,channelId,setChannelId,messages,names,recording,setChatOpen,sendText,sendChatFile,toggleRecording}=g;
 const [sending,setSending]=useState(false),[overlay,setOverlay]=useState(false);
 const list=useRef<HTMLDivElement>(null),composer=useRef<HTMLTextAreaElement>(null);
 const follow=useRef(true),lastChannel=useRef(channelId);
 const panel=useDialog(overlay,()=>setChatOpen(false));
 useEffect(()=>{
  const media=window.matchMedia('(max-width:1099px)'),update=()=>setOverlay(media.matches);
  update();media.addEventListener('change',update);
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  if(!media.matches)composer.current?.focus();
  return()=>{media.removeEventListener('change',update);if(previous?.isConnected)previous.focus()};
 },[]);
 useEffect(()=>{if(channelId!==lastChannel.current){follow.current=true;lastChannel.current=channelId}if(follow.current&&list.current)list.current.scrollTop=list.current.scrollHeight},[messages,channelId]);
 async function send(){if(sending||!text.trim()||!channelId)return;setSending(true);try{if(await sendText(text)){setText('');follow.current=true}}finally{setSending(false);if(!overlay)composer.current?.focus()}}
 return <aside id="game-chat" ref={panel} tabIndex={-1} className="simChat" role={overlay?'dialog':undefined} aria-modal={overlay?true:undefined} aria-label="Связь с участниками" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setChatOpen(false)}}}>
  <div className="chatTop"><div><small>СВЯЗЬ С КОМАНДОЙ</small><b>{channels.find(c=>c.id===channelId)?.name||'Общий штаб'}</b></div><button onClick={()=>setChatOpen(false)} aria-label="Закрыть чат"><X aria-hidden="true"/></button></div>
  <select aria-label="Канал общения" value={channelId} onChange={e=>setChannelId(e.target.value)}>{channels.length?channels.map(c=><option key={c.id} value={c.id}>{c.name}</option>):<option value="">Нет доступных каналов</option>}</select>
  <div className="chatMessages" ref={list} role="log" aria-label="Сообщения" aria-live="polite" aria-relevant="additions" onScroll={()=>{const el=list.current;if(el)follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<80}}>
   {messages.length===0?<div className="emptyState">Начните обсуждение.<br/>Сообщения увидят участники этого канала.</div>:messages.map(m=><div className="chatMsg" key={m.id}><span aria-hidden="true">{initials(names[m.author_id]||'Система')}</span><div><div><b>{names[m.author_id]||'Система'}</b><time dateTime={m.created_at}>{new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time></div>{m.text&&<p>{m.text}</p>}{m.kind==='audio'&&m.url&&<audio controls src={m.url} aria-label="Аудиосообщение"/>}{m.kind==='video'&&m.url&&<video controls playsInline src={m.url} aria-label="Видеосообщение"/>}{m.kind==='file'&&m.url&&m.mime_type?.startsWith('image/')&&<img className="chatImage" src={m.url} alt={m.text||'Изображение в сообщении'}/>} {m.kind==='file'&&m.url&&!m.mime_type?.startsWith('image/')&&<a className="chatFile" href={m.url} target="_blank" rel="noreferrer">{m.text||'Скачать файл'} ↗</a>}</div></div>)}
  </div>
  {recording&&<div className="recording" role="status">Идёт запись {recording==='audio'?'аудио':'видео'}. Нажмите кнопку записи ещё раз, чтобы отправить.</div>}
  <div className="chatCompose"><textarea ref={composer} aria-label="Ваше сообщение" rows={2} value={text} onChange={e=>setText(e.target.value)} placeholder="Обсудите следующий ход…" disabled={!channelId} readOnly={sending} aria-busy={sending} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/>
   <div className="chatComposeActions"><MediaUploadButton files={[]} onChange={x=>{if(x[0])void sendChatFile(x[0])}} accept="image/*,.pdf,.doc,.docx,.txt" multiple={false} label="Файл" hint="Прикрепить файл"/><button disabled={!channelId} onClick={()=>toggleRecording('audio')} aria-label={recording==='audio'?'Остановить и отправить аудиозапись':'Записать аудиосообщение'} aria-pressed={recording==='audio'}><Mic aria-hidden="true"/></button><button disabled={!channelId} onClick={()=>toggleRecording('video')} aria-label={recording==='video'?'Остановить и отправить видеозапись':'Записать видеосообщение'} aria-pressed={recording==='video'}><Video aria-hidden="true"/></button><button className="primary" disabled={sending||!text.trim()||!channelId} onClick={()=>void send()}><Send aria-hidden="true"/>{sending?'Отправка…':'Отправить'}</button></div><p className="chatComposeHint">Enter — отправить · Shift + Enter — новая строка</p>
  </div>
 </aside>;
}
