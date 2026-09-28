'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {ArrowDown,FileText,Mic,Paperclip,Pin,PinOff,Plus,Search,Send,Video,X} from 'lucide-react';
import {IconAction} from '../ui/IconAction';
import ChatChannelDropdown from './ChatChannelDropdown';
import {useDialog} from '../ui/useDialog';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Message} from './types';
import {initials} from './constants';
import {buildChatEntries,formatChatTime,isChatAttachment,matchChatMessage} from './chatUtils';

const FILE_ACCEPT='image/*,.pdf,.doc,.docx,.txt,.xlsx,.ppt,.pptx';
const MAX_FILE_SIZE=25*1024*1024;
function highlightChatText(value:string,search:string):ReactNode{
 const query=search.trim();if(!query)return value;
 const haystack=value.toLocaleLowerCase('ru-RU'),needle=query.toLocaleLowerCase('ru-RU');
 const chunks:ReactNode[]=[];let cursor=0,position=haystack.indexOf(needle);
 while(position!==-1){
  if(position>cursor)chunks.push(value.slice(cursor,position));
  chunks.push(<mark key={position} className="chatSearchMatch">{value.slice(position,position+needle.length)}</mark>);
  cursor=position+needle.length;position=haystack.indexOf(needle,cursor);
 }
 if(cursor<value.length)chunks.push(value.slice(cursor));
 return chunks.length?chunks:value;
}
function formatBytes(size:number){return size<1024*1024?Math.max(1,Math.round(size/1024))+' КБ':(size/1024/1024).toFixed(1)+' МБ';}
function ChatAttachment({message:m}:{message:Message}){
 if(!m.url)return <span className="chatMissingFile">Вложение недоступно</span>;
 if(m.kind==='audio')return <audio controls preload="none" src={m.url} aria-label="Аудиосообщение"/>;
 if(m.kind==='video')return <video controls preload="metadata" playsInline src={m.url} aria-label="Видеосообщение"/>;
 if(m.mime_type?.startsWith('image/')){
  return <a className="chatPhoto" href={m.url} target="_blank" rel="noopener noreferrer" aria-label="Открыть изображение в новой вкладке"><img src={m.url} alt={m.text||'Изображение из чата'} loading="lazy"/></a>;
 }
 return <a className="chatDocument" href={m.url} target="_blank" rel="noopener noreferrer">
  <span className="chatDocumentIcon"><FileText aria-hidden="true"/></span>
  <span className="chatDocumentName"><b>{m.text||'Вложенный документ'}</b><small>{m.mime_type?.includes('pdf')?'PDF':m.mime_type?.includes('word')?'Документ':m.mime_type?.includes('spreadsheet')?'Таблица':'Файл'} · Открыть</small></span>
  <span className="chatDocumentArrow" aria-hidden="true">↗</span>
 </a>;
}

export default function ChatPanel({g,draft:text,onDraftChange:setText}:{g:ReturnTypeRepublic;draft:string;onDraftChange:(next:string)=>void}){
 const {channels,channelId,setChannelId,messages,chatPins,pinnedMessages,setChatPin,chatLoading,names,recording,setChatOpen,sendText,sendChatFile,toggleRecording,me,teacher}=g;
 const [sending,setSending]=useState(false);
 const [uploading,setUploading]=useState(false);
 const [overlay,setOverlay]=useState(false);
 const [searchOpen,setSearchOpen]=useState(false);
 const [pinsOpen,setPinsOpen]=useState(false);
 const [pinBusy,setPinBusy]=useState<string|null>(null);
 const [search,setSearch]=useState('');
 const [onlyFiles,setOnlyFiles]=useState(false);
 const [attachOpen,setAttachOpen]=useState(false);
 const [jumpVisible,setJumpVisible]=useState(false);
 const [localError,setLocalError]=useState('');
 const list=useRef<HTMLDivElement>(null);
 const composer=useRef<HTMLTextAreaElement>(null);
 const searchInput=useRef<HTMLInputElement>(null);
 const attachmentButton=useRef<HTMLButtonElement>(null);
 const uploadInput=useRef<HTMLInputElement>(null);
 const attachWrap=useRef<HTMLDivElement>(null);
 const previousFocus=useRef<HTMLElement|null>(null);
 const follow=useRef(true);
 const lastChannel=useRef(channelId);
 const pendingSend=useRef(false);
 const panel=useDialog(overlay,()=>setChatOpen(false));
 const channel=channels.find(c=>c.id===channelId);
 const channelMessages=useMemo(()=>messages.filter(m=>m.channel_id===channelId),[messages,channelId]);
 const filtered=useMemo(()=>channelMessages.filter(m=>matchChatMessage(m,search,names[m.author_id]||'Система',onlyFiles)),[channelMessages,search,names,onlyFiles]);
 const entries=useMemo(()=>buildChatEntries(filtered,me?.user_id||''),[filtered,me?.user_id]);
 const hasFilter=!!search.trim()||onlyFiles;
 useEffect(()=>{
  const media=window.matchMedia('(max-width:1099px)');
  const update=()=>setOverlay(media.matches);
  update();
  media.addEventListener('change',update);
  previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  return()=>{media.removeEventListener('change',update);previousFocus.current?.isConnected&&previousFocus.current.focus()};
 },[]);
 useEffect(()=>{
  if(channelId!==lastChannel.current){
   lastChannel.current=channelId;follow.current=true;
   setSearch('');setOnlyFiles(false);setSearchOpen(false);setAttachOpen(false);setPinsOpen(false);
   setLocalError('');setJumpVisible(false);
  }
 },[channelId]);
 useEffect(()=>{
  if(hasFilter)return;
  const el=list.current;
  if(el&&follow.current){el.scrollTop=el.scrollHeight;setJumpVisible(false)}
 },[messages,channelId,hasFilter]);
 useEffect(()=>{
  if(!composer.current)return;
  const node=composer.current;
  node.style.height='auto';
  node.style.height=Math.min(136,Math.max(44,node.scrollHeight))+'px';
 },[text]);
 useEffect(()=>{if(searchOpen)searchInput.current?.focus()},[searchOpen]);
 useEffect(()=>{
  if(!attachOpen)return;
  const click=(event:PointerEvent)=>{if(attachWrap.current&&!attachWrap.current.contains(event.target as Node))setAttachOpen(false)};
  document.addEventListener('pointerdown',click);
  return()=>document.removeEventListener('pointerdown',click);
 },[attachOpen]);
 useEffect(()=>{
  if(!overlay)return;
  const viewport=window.visualViewport,node=panel.current;
  if(!viewport||!node)return;
  const align=()=>{node.style.height=viewport.height+'px';node.style.top=viewport.offsetTop+'px'};
  align();viewport.addEventListener('resize',align);viewport.addEventListener('scroll',align);
  return()=>{viewport.removeEventListener('resize',align);viewport.removeEventListener('scroll',align);node.style.removeProperty('height');node.style.removeProperty('top')};
 },[overlay]);
 const scrollToLatest=()=>{if(list.current){list.current.scrollTop=list.current.scrollHeight;follow.current=true;setJumpVisible(false)}};
 async function send(){
  if(pendingSend.current||uploading||chatLoading||!text.trim()||!channelId)return;
  const sentText=text,fromChannel=channelId;
  pendingSend.current=true;setSending(true);setLocalError('');
  try{
   const ok=await sendText(sentText);
   if(ok){
    if(lastChannel.current===fromChannel&&text===sentText)setText('');
    follow.current=true;
    requestAnimationFrame(scrollToLatest);
   }else setLocalError('Не удалось отправить сообщение. Попробуйте ещё раз.');
  }catch{setLocalError('Сообщение не отправлено. Повторите попытку.')}
  finally{pendingSend.current=false;setSending(false);if(!overlay)composer.current?.focus()}
 }
 async function upload(file:File){
  if(!channelId||uploading)return;
  if(file.size>MAX_FILE_SIZE){setLocalError('Файл превышает 25 МБ. Выберите файл меньшего размера.');return}
  setLocalError('');setUploading(true);setAttachOpen(false);
  try{const ok=await sendChatFile(file);if(!ok)setLocalError('Не удалось прикрепить файл. Попробуйте снова.');else requestAnimationFrame(scrollToLatest)}
  catch{setLocalError('Файл не отправлен. Повторите попытку.')}
  finally{setUploading(false);if(uploadInput.current)uploadInput.current.value=''}
 }
 async function togglePin(m:Message){
  if(pinBusy)return;
  const pinned=chatPins.some(p=>p.message_id===m.id);
  setPinBusy(m.id);setLocalError('');
  try{if(!await setChatPin(m.id,!pinned))setLocalError('Не удалось изменить закрепление. Проверьте права или лимит канала.')}
  catch{setLocalError('Не удалось изменить закрепление. Попробуйте ещё раз.')}
  finally{setPinBusy(null)}
 }
 function showPinnedMessage(m:Message){
  setPinsOpen(false);
  resetSearch();
  requestAnimationFrame(()=>{
   const node=list.current?.querySelector<HTMLElement>('[data-message-id="'+CSS.escape(m.id)+'"]');
   if(node)node.scrollIntoView({block:'center',behavior:'smooth'});
   else{setPinsOpen(true);setLocalError('Сообщение находится вне загруженной истории. Материал доступен в закреплениях.')}
  });
 }
 function resetSearch(){setSearch('');setOnlyFiles(false);setSearchOpen(false);follow.current=true;requestAnimationFrame(scrollToLatest)}
 return <aside id="game-chat" ref={panel} tabIndex={-1} className="simChat gsChatV2" role={overlay?'dialog':undefined} aria-modal={overlay?true:undefined} aria-label="Командный чат" onKeyDown={e=>{if(e.key==='Escape'){
  if(attachOpen){e.stopPropagation();setAttachOpen(false);attachmentButton.current?.focus()}
  else if(searchOpen){e.stopPropagation();resetSearch()}
  else{e.stopPropagation();setChatOpen(false)}
 }}}>
  <header className="chatTop">
   <div className="chatHeadIcon" aria-hidden="true"><MessageIcon/></div>
   <ChatChannelDropdown channels={channels} value={channelId} onChange={setChannelId}/>
   <button type="button" className={'chatIconButton chatSearchToggle '+(searchOpen?'active':'')} onClick={()=>searchOpen?resetSearch():setSearchOpen(true)} aria-label={searchOpen?'Закрыть поиск':'Поиск в чате'} aria-pressed={searchOpen} title="Поиск"><Search aria-hidden="true"/></button>
   <IconAction onClick={()=>setChatOpen(false)} label="Закрыть чат"/>
  </header>
  {chatPins.length>0&&<div className="chatPinnedWrap">
   <button type="button" className="chatPinnedToggle" aria-expanded={pinsOpen} aria-controls="chat-pinned-list" onClick={()=>setPinsOpen(v=>!v)}>
    <Pin size={16} aria-hidden="true"/><span>Закреплено</span><b>{chatPins.length}</b><span className="chatPinnedPreview">{pinnedMessages[0]?.text||'Материалы канала'}</span>
   </button>
   {pinsOpen&&<div id="chat-pinned-list" className="chatPinnedList" aria-label="Закреплённые материалы">
    {chatPins.map(pin=>{
     const item=pinnedMessages.find(m=>m.id===pin.message_id);
     const removable=pin.pinned_by===me?.user_id||teacher;
     return <div className="chatPinnedItem" key={pin.id}>
      {item?<><div className="chatPinnedItemHead">
       <button type="button" className="chatPinnedJump" onClick={()=>showPinnedMessage(item)} title="Перейти к сообщению"><Pin size={14} aria-hidden="true"/>{item.text|| (item.kind==='audio'?'Аудиосообщение':item.kind==='video'?'Видеосообщение':'Файл')}</button>
       {removable&&<button type="button" className="chatUnpin" disabled={pinBusy===item.id} aria-label="Открепить сообщение" onClick={()=>void togglePin(item)}><PinOff size={15} aria-hidden="true"/></button>}
      </div>{isChatAttachment(item)&&<div className="chatPinnedMedia"><ChatAttachment message={item}/></div>}</>:
      <span className="chatMissingFile">Материал недоступен</span>}
     </div>;
    })}
   </div>}
  </div>}
  {searchOpen&&<div className="chatSearchBar">
   <div className="chatSearchField"><Search size={18} aria-hidden="true"/><input ref={searchInput} value={search} onChange={e=>setSearch(e.target.value)} aria-label="Поиск по сообщениям этого канала" placeholder="Сообщения и документы…" type="search"/></div>
   <button type="button" className={'chatFilesFilter '+(onlyFiles?'active':'')} aria-pressed={onlyFiles} onClick={()=>setOnlyFiles(x=>!x)}><Paperclip size={15} aria-hidden="true"/> Файлы</button>
   <span className="chatSearchCount" aria-live="polite">{filtered.length} из {channelMessages.length}</span>
  </div>}
  <div className="chatMessages" ref={list} role="log" aria-label="Сообщения" aria-live={hasFilter?'off':'polite'} aria-relevant="additions" onScroll={()=>{const el=list.current;if(!el)return;const nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<85;follow.current=nearBottom;setJumpVisible(!nearBottom&&!hasFilter&&channelMessages.length>0)}}>
   {chatLoading?<div className="chatEmpty" role="status"><span className="chatLoadingSpinner" aria-hidden="true"/><b>Загружаем сообщения…</b></div>:!entries.length?<div className="chatEmpty"><span className="chatEmptyIcon"><Search aria-hidden="true"/></span><b>{hasFilter?'Ничего не найдено':'Пока нет сообщений'}</b><p>{hasFilter?'Измените запрос или отключите фильтр.':'Начните обсуждение: сообщения увидят участники этого канала.'}</p></div>:
    entries.map(({message:m,startsDay,startsGroup,own,day,dayLabel})=>{
     const name=names[m.author_id]||'Система';
     const attachment=isChatAttachment(m);
     const showText=!!m.text&&(m.kind==='text'||m.kind==='system');
     return <div className="chatEntry" key={m.id} data-chat-date={day}>
      {startsDay&&<div className="chatDateSeparator"><span>{dayLabel}</span></div>}
      <article className={'chatMsg '+(own?'mine':'theirs')+(startsGroup?' groupStart':' grouped')} data-message-id={m.id} aria-label={name+', '+formatChatTime(m.created_at)}>
       {!own&&<span className={'chatAvatar '+(!startsGroup?'placeholder':'')} aria-hidden="true">{startsGroup?initials(name):''}</span>}
       <div className="chatMessageColumn">
        {startsGroup&&<div className="chatAuthor"><b>{own?'Вы':name}</b><time dateTime={m.created_at}>{formatChatTime(m.created_at)}</time></div>}
        <div className="chatBubble">
         {showText&&<p>{highlightChatText(m.text||'',search)}</p>}
         {attachment&&<ChatAttachment message={m}/>}
         {m.kind==='system'&&!showText&&<p>Системное сообщение</p>}
         {!startsGroup&&<time className="chatInlineTime" dateTime={m.created_at}>{formatChatTime(m.created_at)}</time>}
        </div>
       </div>
       <button type="button" className={'chatPinAction '+(chatPins.some(p=>p.message_id===m.id)?'isPinned':'')} disabled={!!pinBusy||(chatPins.length>=12&&!chatPins.some(p=>p.message_id===m.id))} aria-label={chatPins.some(p=>p.message_id===m.id)?'Открепить сообщение':'Закрепить сообщение'} aria-pressed={chatPins.some(p=>p.message_id===m.id)} title={chatPins.some(p=>p.message_id===m.id)?'Открепить':'Закрепить'} onClick={()=>void togglePin(m)}><Pin size={15} aria-hidden="true"/></button>
      </article>
     </div>;
    })}
  </div>
  {jumpVisible&&<button type="button" className="chatJumpLatest" onClick={scrollToLatest}><ArrowDown aria-hidden="true" size={16}/> К последним сообщениям</button>}
  {recording&&<div className="chatRecording" role="status"><span className="chatRecordingDot"/>Записывается {recording==='audio'?'аудио':'видео'}<button type="button" onClick={()=>void toggleRecording(recording)}>Завершить и отправить</button></div>}
  {localError&&<div className="chatLocalError" role="alert"><span>{localError}</span><button type="button" aria-label="Скрыть ошибку" onClick={()=>setLocalError('')}><X size={16}/></button></div>}
  <div className="chatCompose">
   <textarea ref={composer} aria-label="Ваше сообщение" rows={1} value={text} onChange={e=>setText(e.target.value)} placeholder={channelId?'Написать сообщение…':'Выберите канал'} disabled={!channelId||chatLoading} readOnly={sending} aria-busy={sending} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/>
   <div className="chatComposeActions">
    <div className="chatAttachWrap" ref={attachWrap}>
     <button type="button" ref={attachmentButton} className={'chatIconButton chatAttachButton '+(attachOpen?'active':'')} aria-label="Прикрепить или записать" aria-haspopup="menu" aria-expanded={attachOpen} disabled={!channelId||uploading||chatLoading} onClick={()=>setAttachOpen(v=>!v)}><Plus aria-hidden="true"/></button>
     {attachOpen&&<div className="chatAttachMenu" role="menu" aria-label="Добавить в чат">
      <button type="button" role="menuitem" onClick={()=>{setAttachOpen(false);uploadInput.current?.click()}}><Paperclip aria-hidden="true" size={18}/>Файл или изображение</button>
      <button type="button" role="menuitem" onClick={()=>{setAttachOpen(false);void toggleRecording('audio')}}><Mic aria-hidden="true" size={18}/>Аудиосообщение</button>
      <button type="button" role="menuitem" onClick={()=>{setAttachOpen(false);void toggleRecording('video')}}><Video aria-hidden="true" size={18}/>Видеосообщение</button>
     </div>}
     <input ref={uploadInput} type="file" hidden accept={FILE_ACCEPT} aria-label="Выбрать файл для чата" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file)}}/>
    </div>
    <span className="chatComposerHint">{uploading?'Загрузка файла…':sending?'Отправка…':'Enter — отправить · Shift + Enter — новая строка'}</span>
    <button type="button" className="chatSendButton iconOnly" disabled={sending||uploading||chatLoading||!text.trim()||!channelId} onClick={()=>void send()} aria-label="Отправить сообщение" title="Отправить"><Send aria-hidden="true" size={20}/></button>
   </div>
  </div>
 </aside>;
}
function MessageIcon(){return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8 8.2 8.2 0 0 1-3.5-.8L4 20l1.3-4.4A8 8 0 1 1 20 11.5Z"/></svg>}
