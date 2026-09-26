'use client';
import {useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import {initials} from './constants';

export default function ChatPanel({g}:{g:ReturnTypeRepublic}){
 const {channels,channelId,setChannelId,messages,names,recording,setChatOpen,sendText,toggleRecording}=g;
 const [text,setText]=useState('');
 async function send(){if(await sendText(text))setText('')}
 return <aside className="simChat"><div className="chatTop"><div><small>КОММУНИКАЦИИ</small><b>{channels.find(c=>c.id===channelId)?.name||'Общий штаб'}</b></div><button onClick={()=>setChatOpen(false)}>×</button></div><select value={channelId} onChange={e=>setChannelId(e.target.value)}>{channels.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><div className="chatMessages">{messages.length===0?<div className="emptyState">Сообщений пока нет.</div>:messages.map(m=><div className="chatMsg" key={m.id}><span>{initials(names[m.author_id]||'Система')}</span><div><div><b>{names[m.author_id]||'Система'}</b><time>{new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time></div>{m.text&&<p>{m.text}</p>}{m.kind==='audio'&&m.url&&<audio controls src={m.url}/>} {m.kind==='video'&&m.url&&<video controls playsInline src={m.url}/>}</div></div>)}</div>{recording&&<div className="recording">● Запись {recording==='audio'?'аудио':'видео'} — нажмите кнопку ещё раз для отправки</div>}<div className="chatCompose"><textarea rows={2} value={text} onChange={e=>setText(e.target.value)} placeholder="Сообщение…" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}}/><div><button onClick={()=>toggleRecording('audio')}>🎙</button><button onClick={()=>toggleRecording('video')}>◉</button><button className="primary" onClick={send}>Отправить</button></div></div></aside>
}