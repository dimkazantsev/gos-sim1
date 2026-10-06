'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {ArrowDown,AtSign,Download,FileText,Mic,Paperclip,Pin,PinOff,Search,Send,Square,Trash2,UserRound,Video,X} from 'lucide-react';
import {CHAT_MAX_FILE_BYTES,formatRecordingDuration} from './recordingMedia';
import {IconAction} from '../ui/IconAction';
import ChatChannelDropdown from './ChatChannelDropdown';
import ChatVoicePlayer from './ChatVoicePlayer';
import ChatVideoNote from './ChatVideoNote';
import {useDialog} from '../ui/useDialog';
import type {ReturnTypeRepublic} from './viewTypes';
import type {Message} from './types';
import {initials} from './constants';
import {PROCESS_TAGS} from './processTags';
import {chatHandles} from './chatHandles';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {buildChatEntries,formatChatTime,isChatAttachment,matchChatMessage} from './chatUtils';

const FILE_ACCEPT='image/*,audio/*,video/*,.pdf,.doc,.docx,.txt,.xlsx,.ppt,.pptx';
const MAX_FILE_SIZE=CHAT_MAX_FILE_BYTES;
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
function ChatAttachment({message:m,onRefresh}:{message:Message;onRefresh?:(messageId:string,path:string)=>Promise<string|null>}){
 if(!m.url)return <div className="chatAttachmentUnavailable">
  <span>Не удалось открыть вложение</span>
  {m.storage_path&&onRefresh&&<button type="button" onClick={()=>void onRefresh(m.id,m.storage_path!)}>Обновить ссылку</button>}
 </div>;
 if(m.kind==='audio'||m.mime_type?.startsWith('audio/'))return <ChatVoicePlayer src={m.url} messageId={m.id} durationHint={m.voice_meta?.duration} waveform={m.voice_meta?.waveform} fileName={m.text||'Голосовое сообщение'} onRefresh={m.storage_path&&onRefresh?()=>onRefresh(m.id,m.storage_path!):undefined} />;
 if(m.kind==='video'||m.mime_type?.startsWith('video/'))return <ChatVideoNote src={m.url}/>;
 if(m.mime_type?.startsWith('image/')){
  return <a className="chatPhoto" href={m.url} target="_blank" rel="noopener noreferrer" aria-label="Открыть изображение в новой вкладке"><img src={m.url} alt={m.text||'Изображение из чата'} loading="lazy"/></a>;
 }
 return <a className="chatDocument" href={m.url} target="_blank" rel="noopener noreferrer">
  <span className="chatDocumentIcon"><FileText aria-hidden="true"/></span>
  <span className="chatDocumentName"><b>{m.text||'Вложенный документ'}</b><small>{m.mime_type?.includes('pdf')?'PDF':m.mime_type?.includes('word')?'Документ':m.mime_type?.includes('spreadsheet')?'Таблица':'Файл'} · Открыть</small></span>
  <span className="chatDocumentArrow" aria-hidden="true">↗</span>
 </a>;
}

export default function ChatPanel({g,draft:text,onDraftChange:setText,previewChannelOpen=false,previewPinsOpen=false,onOpenMember,readOnly=false}:{g:ReturnTypeRepublic;draft:string;onDraftChange:(next:string)=>void;previewChannelOpen?:boolean;previewPinsOpen?:boolean;onOpenMember?:(userId:string)=>void;readOnly?:boolean}){
 const {channels,channelId,setChannelId,messages,chatPins:allPins,pinnedMessages:allPinnedMessages,setChatPin,refreshChatMediaUrl,chatLoading,names,recording,recordingPreview,recordingSaving,chatMediaError,chatMediaPhase,recordingStartedAt,recordingStream,discardRecording,sendRecordingPreview,setChatOpen,sendText,sendChatFile,toggleRecording,me,teacher,chatOverview,setChatChannelPinned}=g;
 useEffect(()=>{setSelectedMessages([])},[channelId]);
 useEffect(()=>()=>{if(selectHoldTimer.current)clearTimeout(selectHoldTimer.current)},[]);
  useEffect(()=>{if(!g.game?.id)return;let live=true;void supabase.rpc('ensure_social_channels',{p_game_id:g.game.id}).then(r=>{if(live){if(r.error)g.setError(r.error.message);else void g.refresh()}});return()=>{live=false}},[g.game?.id]);
 const [sending,setSending]=useState(false);
 const [uploading,setUploading]=useState(false);
 const [recordElapsed,setRecordElapsed]=useState(0);
 const [overlay,setOverlay]=useState(false);
 const [searchOpen,setSearchOpen]=useState(false);
 const [pinsOpen,setPinsOpen]=useState(previewPinsOpen);
 const [pinBusy,setPinBusy]=useState<string|null>(null);
 const [selectedMessages,setSelectedMessages]=useState<string[]>([]);
 const [deletingMessages,setDeletingMessages]=useState(false);
 const selectHoldTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const selectHoldActivated=useRef(false);
 const [search,setSearch]=useState('');
 const [onlyFiles,setOnlyFiles]=useState(false);
 const [attachOpen,setAttachOpen]=useState(false);
 const [jumpVisible,setJumpVisible]=useState(false);
 const [localError,setLocalError]=useState('');
 const list=useRef<HTMLDivElement>(null);
 const composer=useRef<HTMLTextAreaElement>(null);
 const liveCamera=useRef<HTMLVideoElement>(null);
 const mediaHoldTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const mediaHold=useRef<{kind:'audio'|'video';started:boolean;released:boolean}|null>(null);
 const heldClickUntil=useRef(0);
 const autoSendHold=useRef(false);
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
 const chatPins=useMemo(()=>allPins.filter(p=>p.channel_id===channelId),[allPins,channelId]);
 const pinnedMessages=useMemo(()=>allPinnedMessages.filter(m=>m.channel_id===channelId),[allPinnedMessages,channelId]);
 const channelMessages=useMemo(()=>messages.filter(m=>m.channel_id===channelId),[messages,channelId]);
 const filtered=useMemo(()=>channelMessages.filter(m=>matchChatMessage(m,search,names[m.author_id]||'Система',onlyFiles)),[channelMessages,search,names,onlyFiles]);
 const entries=useMemo(()=>buildChatEntries(filtered,me?.user_id||''),[filtered,me?.user_id]);
 const hasFilter=!!search.trim()||onlyFiles;
 const handles=chatHandles(g.members).filter(x=>x.member.user_id!==me?.user_id);
 const mentionMatch=text.match(/(?:^|\s)@([а-яёa-z0-9_-]*)$/i);
 const mentionQuery=(mentionMatch?.[1]||'').toLocaleLowerCase('ru-RU');
 const mentionSuggestions=mentionMatch?handles.filter(x=>x.handle.startsWith(mentionQuery)||x.aliases.some(a=>a.startsWith(mentionQuery))).slice(0,8):[];
 const peopleResults=search.trim().length>0?handles.filter(x=>{
  const q=search.trim().toLocaleLowerCase('ru-RU');
  return x.member.full_name.toLocaleLowerCase('ru-RU').includes(q)||x.handle.includes(q)||x.aliases.some(a=>a.includes(q));
 }).slice(0,8):[];
 function insertMention(userId:string){
  const person=handles.find(x=>x.member.user_id===userId);if(!person||!mentionMatch)return;
  const surname=person.member.full_name.trim().split(/\s+/)[0]||person.surname;
  const prefix=text.slice(0,text.length-mentionMatch[0].length)+(mentionMatch[0].startsWith(' ')?' ':'');
  setText(prefix+'@'+surname+' ');requestAnimationFrame(()=>composer.current?.focus());
 }
 function mentionedUsers(value:string){
  const tokens=[...value.matchAll(/@([\p{L}\d_-]+)/gu)].map(m=>m[1].toLocaleLowerCase('ru-RU'));
  return [...new Set(handles.filter(x=>tokens.some(token=>x.handle===token||x.aliases.includes(token))).map(x=>x.member.user_id))];
 }
 async function openPersonChat(userId:string){
  if(!g.game||sending)return;setSending(true);setLocalError('');
  try{const r=await supabase.rpc('open_direct_conversation',{p_game:g.game.id,p_recipient:userId});
   if(r.error){setLocalError(userError(r.error));return}
   const target=r.data as string;await g.refresh();setChannelId(target);setSearch('');setSearchOpen(false);setOnlyFiles(false);
   requestAnimationFrame(()=>composer.current?.focus());
  }catch(e){setLocalError(userError(e))}finally{setSending(false)}
 }
 function beginHold(kind:'audio'|'video'){
  if(mediaHoldTimer.current)clearTimeout(mediaHoldTimer.current);
  const hold={kind,started:false,released:false};
  mediaHold.current=hold;
  mediaHoldTimer.current=setTimeout(()=>{
   if(mediaHold.current!==hold||hold.released)return;
   hold.started=true;autoSendHold.current=true;heldClickUntil.current=Date.now()+1500;
   void toggleRecording(kind).then(()=>{
    if(hold.released)void toggleRecording(kind);
   });
  },320);
 }
 function releaseHold(){
  const hold=mediaHold.current;if(!hold)return;
  hold.released=true;
  if(mediaHoldTimer.current)clearTimeout(mediaHoldTimer.current);
  mediaHoldTimer.current=null;mediaHold.current=null;
  if(hold.started){heldClickUntil.current=Date.now()+1200;if(recording===hold.kind)void toggleRecording(hold.kind)}
 }
 function cancelHold(){
  const hold=mediaHold.current;if(mediaHoldTimer.current)clearTimeout(mediaHoldTimer.current);
  mediaHoldTimer.current=null;mediaHold.current=null;
  if(hold?.started){autoSendHold.current=false;discardRecording()}
 }
 useEffect(()=>{
  if(!recordingPreview||!autoSendHold.current)return;
  autoSendHold.current=false;
  void sendRecordingPreview();
 },[recordingPreview?.url]);
 useEffect(()=>()=>{if(mediaHoldTimer.current)clearTimeout(mediaHoldTimer.current)},[]);

 useEffect(()=>{
  const media=window.matchMedia('(max-width:1099px)');
  const update=()=>setOverlay(media.matches&&!window.matchMedia('(max-width:900px)').matches);
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
  if(!recordingStartedAt){setRecordElapsed(0);return}
  const update=()=>setRecordElapsed(Math.floor((Date.now()-recordingStartedAt)/1000));
  update();const timer=window.setInterval(update,1000);return()=>window.clearInterval(timer);
 },[recordingStartedAt]);
 useEffect(()=>{
  const video=liveCamera.current;
  if(!video||recording!=='video'||!recordingStream)return;
  video.srcObject=recordingStream;void video.play().catch(()=>{});
  return()=>{video.pause();video.srcObject=null};
 },[recording,recordingStream]);
 useEffect(()=>{
  if(!attachOpen)return;
  const click=(event:PointerEvent)=>{if(attachWrap.current&&!attachWrap.current.contains(event.target as Node))setAttachOpen(false)};
  document.addEventListener('pointerdown',click);
  return()=>document.removeEventListener('pointerdown',click);
 },[attachOpen]);
 useEffect(()=>{
  const viewport=window.visualViewport,node=panel.current;
  if(!viewport||!node)return;
  const mobile=window.matchMedia('(max-width:900px)');
  const tablet=window.matchMedia('(min-width:901px) and (max-width:1099px)');
  const align=()=>{
   if(!mobile.matches&&!tablet.matches){
    node.style.removeProperty('height');node.style.removeProperty('top');node.style.removeProperty('bottom');return;
   }
   const dockHeight=mobile.matches?(document.querySelector<HTMLElement>('.mobileDockV2')?.getBoundingClientRect().height||76):0;
   node.style.height=Math.max(0,viewport.height-dockHeight)+'px';
   node.style.top=viewport.offsetTop+'px';
   if(mobile.matches)node.style.bottom='auto';else node.style.removeProperty('bottom');
  };
  align();
  viewport.addEventListener('resize',align);viewport.addEventListener('scroll',align);
  mobile.addEventListener('change',align);tablet.addEventListener('change',align);
  return()=>{
   viewport.removeEventListener('resize',align);viewport.removeEventListener('scroll',align);
   mobile.removeEventListener('change',align);tablet.removeEventListener('change',align);
   node.style.removeProperty('height');node.style.removeProperty('top');node.style.removeProperty('bottom');
  };
 },[]);
 const scrollToLatest=()=>{if(list.current){list.current.scrollTop=list.current.scrollHeight;follow.current=true;setJumpVisible(false)}};
 async function send(){
  if(pendingSend.current||sending||uploading||chatLoading||!text.trim()||!channelId)return;
  const sentText=text,fromChannel=channelId,mentions=mentionedUsers(text);
  pendingSend.current=true;setSending(true);setLocalError('');
  try{
   const ok=await sendText(sentText,fromChannel,mentions);
   if(ok){
    if(lastChannel.current===fromChannel&&text===sentText)setText('');
    follow.current=true;
    requestAnimationFrame(scrollToLatest);
   }else setLocalError('Не удалось отправить сообщение. Попробуйте ещё раз.');
  }catch{setLocalError('Сообщение не отправлено. Повторите попытку.')}
  finally{pendingSend.current=false;setSending(false);if(!overlay)composer.current?.focus()}
 }
 async function upload(file:File){
  if(!channelId||uploading||recordingSaving)return;
  if(file.size>MAX_FILE_SIZE){setLocalError('Файл превышает 25 МБ. Выберите файл меньшего размера.');return}
  setLocalError('');setUploading(true);setAttachOpen(false);
  try{const ok=await sendChatFile(file);if(!ok)setLocalError('Вложение не отправлено. Подробности ниже.');else requestAnimationFrame(scrollToLatest)}
  catch{setLocalError('Файл не отправлен. Повторите попытку.')}
  finally{setUploading(false);if(uploadInput.current)uploadInput.current.value=''}
 }
 async function togglePin(m:Message){
  if(pinBusy)return;
  const pinned=chatPins.some(p=>p.message_id===m.id);
  const existing=chatPins.find(p=>p.message_id===m.id);
  if(pinned&&existing?.pinned_by!==me?.user_id&&!teacher)return;
  setPinBusy(m.id);setLocalError('');
  try{if(!await setChatPin(m.id,!pinned))setLocalError('Не удалось изменить закрепление. Проверьте права или лимит канала.')}
  catch{setLocalError('Не удалось изменить закрепление. Попробуйте ещё раз.')}
  finally{setPinBusy(null)}
 }
 function canDeleteMessage(m:Message){return !!teacher||m.author_id===me?.user_id}
 function toggleMessageSelection(m:Message){
  if(!canDeleteMessage(m))return;
  setSelectedMessages(current=>current.includes(m.id)?current.filter(id=>id!==m.id):[...current,m.id]);
 }
 function beginMessageSelection(m:Message){
  if(!canDeleteMessage(m))return;
  if(selectHoldTimer.current)clearTimeout(selectHoldTimer.current);
  selectHoldActivated.current=false;
  selectHoldTimer.current=setTimeout(()=>{selectHoldActivated.current=true;setSelectedMessages(current=>current.includes(m.id)?current:[...current,m.id])},420);
 }
 function cancelMessageSelectionHold(){
  if(selectHoldTimer.current)clearTimeout(selectHoldTimer.current);
  selectHoldTimer.current=null;
 }
 async function deleteSelectedMessages(){
  if(!selectedMessages.length||deletingMessages)return;
  setDeletingMessages(true);setLocalError('');
  try{
   const r=await supabase.rpc('delete_chat_messages',{p_message_ids:selectedMessages});
   if(r.error){setLocalError(userError(r.error));return}
   setSelectedMessages([]);
   await g.refresh();
  }catch(e){setLocalError(userError(e))}
  finally{setDeletingMessages(false)}
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
 return <aside id="game-chat" ref={panel} tabIndex={-1} className="simChat gsChatV2" role={overlay?'dialog':'region'} aria-modal={overlay?true:undefined} aria-label="Командный чат" onKeyDown={e=>{if(e.key==='Escape'){
  if(attachOpen){e.stopPropagation();setAttachOpen(false);attachmentButton.current?.focus()}
  else if(searchOpen){e.stopPropagation();resetSearch()}
  else{e.stopPropagation();setChatOpen(false)}
 }}}>
  <header className="chatTop">
   <div className="chatHeadIcon" aria-hidden="true"><MessageIcon/></div>
   <ChatChannelDropdown channels={channels} value={channelId} onChange={setChannelId} overview={chatOverview} onPin={setChatChannelPinned} initialOpen={previewChannelOpen}/>
   <button type="button" className={'chatIconButton chatSearchToggle '+(searchOpen?'active':'')} onClick={()=>searchOpen?resetSearch():setSearchOpen(true)} aria-label={searchOpen?'Закрыть поиск':'Поиск в чате'} aria-pressed={searchOpen} title="Поиск"><Search aria-hidden="true"/></button>
   <IconAction onClick={()=>setChatOpen(false)} label="Закрыть чат"/>
  </header>
  {selectedMessages.length>0&&<div className="chatSelectionBar" role="toolbar" aria-label="Выбранные сообщения">
   <button type="button" className="chatSelectionCancel" onClick={()=>setSelectedMessages([])} aria-label="Снять выделение"><X size={18} aria-hidden="true"/></button>
   <b>{selectedMessages.length}</b><span>Выбрано</span>
   <button type="button" className="chatSelectionDelete" disabled={deletingMessages} onClick={()=>void deleteSelectedMessages()} aria-label="Удалить выбранные сообщения"><Trash2 size={18} aria-hidden="true"/><span>{deletingMessages?'Удаление…':'Удалить'}</span></button>
  </div>}
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
      </div>{isChatAttachment(item)&&<div className="chatPinnedMedia"><ChatAttachment message={item} onRefresh={refreshChatMediaUrl}/></div>}</>:
      <span className="chatMissingFile">Материал недоступен</span>}
     </div>;
    })}
   </div>}
  </div>}
  {searchOpen&&<div className="chatSearchArea">
   <div className="chatSearchBar">
    <div className="chatSearchField"><Search size={18} aria-hidden="true"/><input ref={searchInput} value={search} onChange={e=>setSearch(e.target.value)} aria-label="Поиск сообщений или человека" placeholder="Сообщение, имя или фамилия…" type="search"/></div>
    <button type="button" className={'chatFilesFilter '+(onlyFiles?'active':'')} aria-pressed={onlyFiles} onClick={()=>setOnlyFiles(x=>!x)}><Paperclip size={15} aria-hidden="true"/> Файлы</button>
    <span className="chatSearchCount" aria-live="polite">{filtered.length} сообщений</span>
   </div>
   {peopleResults.length>0&&<div className="chatPeopleResults" aria-label="Найденные участники"><small>Люди</small>{peopleResults.map(x=><button type="button" key={x.member.user_id} disabled={sending} onClick={()=>void openPersonChat(x.member.user_id)}><span className="chatPersonAvatar"><UserRound size={16} aria-hidden="true"/></span><span><b>{x.member.full_name}</b><small>{x.member.role_title||x.member.team||'Участник'}</small></span><em>Написать</em></button>)}</div>}
  </div>}
  <div className="chatMessages" ref={list} role="log" aria-label="Сообщения" aria-live={hasFilter?'off':'polite'} aria-relevant="additions" onScroll={()=>{const el=list.current;if(!el)return;const nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<85;follow.current=nearBottom;setJumpVisible(!nearBottom&&!hasFilter&&channelMessages.length>0)}}>
   {chatLoading?<div className="chatEmpty" role="status"><span className="chatLoadingSpinner" aria-hidden="true"/><b>Загружаем сообщения…</b></div>:!entries.length?<div className="chatEmpty"><span className="chatEmptyIcon"><Search aria-hidden="true"/></span><b>{hasFilter?'Ничего не найдено':'Пока нет сообщений'}</b><p>{hasFilter?'Измените запрос или отключите фильтр.':'Начните обсуждение: сообщения увидят участники этого канала.'}</p></div>:
    entries.map(({message:m,startsDay,startsGroup,own,day,dayLabel})=>{
     const name=names[m.author_id]||'Система';
     const attachment=isChatAttachment(m);
     const showText=!!m.text&&(m.kind==='text'||m.kind==='system');
     return <div className="chatEntry" key={m.id} data-chat-date={day}>
      {startsDay&&<div className="chatDateSeparator"><span>{dayLabel}</span></div>}
      <article className={'chatMsg '+(own?'mine':'theirs')+(startsGroup?' groupStart':' grouped')+(selectedMessages.includes(m.id)?' selected':'')+(canDeleteMessage(m)?' selectable':'')} data-message-id={m.id} aria-label={name+', '+formatChatTime(m.created_at)} aria-selected={selectedMessages.includes(m.id)}
       onPointerDown={e=>{if((e.target as HTMLElement).closest('button,a,input,textarea,select'))return;beginMessageSelection(m)}}
       onPointerUp={cancelMessageSelectionHold} onPointerCancel={cancelMessageSelectionHold} onPointerLeave={cancelMessageSelectionHold}
       onContextMenu={e=>{if(!canDeleteMessage(m))return;e.preventDefault();cancelMessageSelectionHold();setSelectedMessages(current=>current.includes(m.id)?current:[...current,m.id])}}
       onClick={e=>{if(selectHoldActivated.current){selectHoldActivated.current=false;return}if(!selectedMessages.length||!canDeleteMessage(m)||(e.target as HTMLElement).closest('button,a,input,textarea,select'))return;toggleMessageSelection(m)}}>
       {!own&&<span className={'chatAvatar '+(!startsGroup?'placeholder':'')} aria-hidden="true">{startsGroup?initials(name):''}</span>}
       <div className="chatMessageColumn">
        {startsGroup&&<div className="chatAuthor">{onOpenMember&&g.members.some(member=>member.user_id===m.author_id)?<button type="button" className="chatAuthorProfile" onClick={()=>onOpenMember(m.author_id)}>{own?'Вы':name}</button>:<b>{own?'Вы':name}</b>}<time dateTime={m.created_at}>{formatChatTime(m.created_at)}</time></div>}
        <div className="chatBubble">
         {showText&&<p>{highlightChatText(m.text||'',search)}</p>}
         {attachment&&<ChatAttachment message={m} onRefresh={refreshChatMediaUrl}/>}
         {m.kind==='system'&&!showText&&<p>Системное сообщение</p>}
         {!startsGroup&&<time className="chatInlineTime" dateTime={m.created_at}>{formatChatTime(m.created_at)}</time>}
        </div>
       </div>
       {selectedMessages.length===0&&<button type="button" className={'chatPinAction '+(chatPins.some(p=>p.message_id===m.id)?'isPinned':'')} disabled={!!pinBusy||(chatPins.length>=12&&!chatPins.some(p=>p.message_id===m.id))||(chatPins.some(p=>p.message_id===m.id&&p.pinned_by!==me?.user_id)&&!teacher)} aria-label={chatPins.some(p=>p.message_id===m.id)?'Открепить сообщение':'Закрепить сообщение'} aria-pressed={chatPins.some(p=>p.message_id===m.id)} title={chatPins.some(p=>p.message_id===m.id)?'Открепить':'Закрепить'} onClick={()=>void togglePin(m)}><Pin size={15} aria-hidden="true"/></button>}
      </article>
     </div>;
    })}
  </div>
  {jumpVisible&&<button type="button" className="chatJumpLatest" onClick={scrollToLatest}><ArrowDown aria-hidden="true" size={16}/> К последним сообщениям</button>}
  {recording&&<section className="chatCapturePanel" aria-label={recording==='audio'?'Запись аудио':'Запись видео'}>
   <div className="chatCaptureStatus">
    <span className="chatCaptureLive" aria-hidden="true"/><b>{recording==='audio'?'Записывается аудио':'Записывается видео'}</b>
    <time aria-label="Длительность записи">{formatRecordingDuration(recordElapsed)}</time>
   </div>
   {recording==='video'&&<video ref={liveCamera} autoPlay muted playsInline className="chatCaptureCamera" aria-label="Предпросмотр камеры"/>}
   <div className="chatCaptureActions">
    <button type="button" className="chatCaptureCancel" onClick={discardRecording}><Trash2 size={16} aria-hidden="true"/>Отменить</button>
    <button type="button" className="chatCaptureStop" onClick={()=>void toggleRecording(recording)}><Square size={14} fill="currentColor" aria-hidden="true"/>Завершить</button>
   </div>
  </section>}
  {recordingPreview&&<section className="chatCapturePanel chatCaptureReview" aria-label="Предпросмотр записи">
   <div className="chatCaptureStatus">
    {recordingPreview.kind==='audio'?<Mic size={17} aria-hidden="true"/>:<Video size={17} aria-hidden="true"/>}
    <b>{recordingPreview.kind==='audio'?'Аудиосообщение':'Видеосообщение'}</b>
    <time>{formatRecordingDuration(recordingPreview.duration)}</time>
   </div>
   {recordingPreview.kind==='audio'
    ?<div className="chatCaptureVoicePreview"><ChatVoicePlayer src={recordingPreview.url} messageId="draft-voice" durationHint={recordingPreview.duration} waveform={recordingPreview.waveform} fileName={recordingPreview.fileName}/></div>
    :<ChatVideoNote src={recordingPreview.url} preview/>}
   {recordingPreview.channelId!==channelId&&<p className="chatCaptureNote">Запись будет отправлена в исходный канал.</p>}
   {recordingPreview.blob.size>MAX_FILE_SIZE&&<p className="chatCaptureNote">Превышен лимит 25 МБ. Сохраните запись на устройство или повторите.</p>}
   <div className="chatCaptureActions">
    <button type="button" className="chatCaptureCancel" onClick={discardRecording} disabled={recordingSaving}><Trash2 size={16} aria-hidden="true"/>Удалить</button>
    <a className="chatCaptureDownload" href={recordingPreview.url} download={recordingPreview.fileName} aria-label="Сохранить запись на устройство"><Download size={17} aria-hidden="true"/></a>
    <button type="button" className="chatCaptureSend" disabled={recordingSaving||recordingPreview.blob.size>MAX_FILE_SIZE} onClick={()=>void sendRecordingPreview()}>
     <Send size={16} aria-hidden="true"/>{recordingSaving?(chatMediaPhase==='analyzing'?'Подготовка…':chatMediaPhase==='uploading'?'Загрузка…':'Публикация…'):'Отправить в чат'}
    </button>
   </div>
  </section>}
  {chatMediaError&&<div className="chatLocalError chatMediaError" role="alert"><span>{chatMediaError}</span></div>}
  {localError&&<div className="chatLocalError" role="alert"><span>{localError}</span><button type="button" aria-label="Скрыть ошибку" onClick={()=>setLocalError('')}><X size={16}/></button></div>}
  {!readOnly?<div className="chatCompose">
   {mentionMatch&&<div className="chatAddressList chatMentionList" aria-label="Упомянуть участника"><small><AtSign size={14} aria-hidden="true"/> Упомянуть в текущем чате</small>{mentionSuggestions.map(x=><button type="button" key={x.member.user_id} onClick={()=>insertMention(x.member.user_id)}><b>{x.member.full_name}</b><span>{x.member.role_title||x.member.team||'Участник'}</span></button>)}{!mentionSuggestions.length&&<span>Участник не найден.</span>}</div>}
   {channels.find(c=>c.id===channelId)?.kind==='public'&&channels.find(c=>c.id===channelId)?.name!=='Вне игры'&&<details className="chatProcessTags"><summary>Сообщение для политического процесса</summary><small>Добавьте тег, чтобы направить сообщение в публичную ленту.</small><div aria-label="Теги сообщения">{PROCESS_TAGS.map(t=><button type="button" key={t.key} onClick={()=>{if(!text.includes('#'+t.key))setText(text+(text?' ':'')+'#'+t.key);composer.current?.focus()}}>{t.label}</button>)}</div></details>}
   <div className="chatInputRow">
    <textarea ref={composer} aria-label="Ваше сообщение" rows={1} value={text} onChange={e=>setText(e.target.value)}
     placeholder={channelId?'Сообщение · @фамилия для упоминания':'Выберите чат'}
     disabled={!channelId||chatLoading} readOnly={sending} aria-busy={sending}
     onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/>
   </div>
   <div className="chatComposeActions">
    <div className="chatAttachWrap" ref={attachWrap}>
     <button type="button" ref={attachmentButton} className={'chatIconButton chatAttachButton '+(attachOpen?'active':'')}
      aria-label="Прикрепить файл" aria-haspopup="menu" aria-expanded={attachOpen}
      disabled={!channelId||uploading||chatLoading||!!recording||!!recordingPreview||recordingSaving}
      onClick={()=>setAttachOpen(v=>!v)}><Paperclip aria-hidden="true"/></button>
     {attachOpen&&<div className="chatAttachMenu" role="menu" aria-label="Добавить в чат">
      <button type="button" role="menuitem" onClick={()=>{setAttachOpen(false);uploadInput.current?.click()}}>
       <Paperclip aria-hidden="true" size={18}/>Файл, фото, аудио или видео
      </button>
     </div>}
     <input ref={uploadInput} type="file" hidden accept={FILE_ACCEPT} aria-label="Выбрать файл для чата"
      onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file)}}/>
    </div>
    <button type="button" className={'chatIconButton chatMediaShortcut '+(recording==='audio'?'isRecording':'')}
     disabled={!channelId||uploading||chatLoading||recordingSaving||!!recordingPreview||recording==='video'}
     aria-label={recording==='audio'?'Завершить запись аудио':'Записать аудиосообщение'}
     title={recording==='audio'?'Завершить запись':'Короткое нажатие — запись, удержание — записать и отправить'}
     onPointerDown={e=>{if(e.pointerType!=='mouse'||e.button===0)beginHold('audio')}}
     onPointerUp={releaseHold} onPointerCancel={cancelHold} onPointerLeave={e=>{if(e.pointerType==='mouse')releaseHold()}}
     onClick={()=>{if(Date.now()<heldClickUntil.current)return;void toggleRecording('audio')}}>
     <Mic aria-hidden="true" size={19}/>
    </button>
    <button type="button" className={'chatIconButton chatMediaShortcut '+(recording==='video'?'isRecording':'')}
     disabled={!channelId||uploading||chatLoading||recordingSaving||!!recordingPreview||recording==='audio'}
     aria-label={recording==='video'?'Завершить запись видео':'Записать видеосообщение'}
     title={recording==='video'?'Завершить запись':'Короткое нажатие — запись, удержание — записать и отправить'}
     onPointerDown={e=>{if(e.pointerType!=='mouse'||e.button===0)beginHold('video')}}
     onPointerUp={releaseHold} onPointerCancel={cancelHold} onPointerLeave={e=>{if(e.pointerType==='mouse')releaseHold()}}
     onClick={()=>{if(Date.now()<heldClickUntil.current)return;void toggleRecording('video')}}>
     <Video aria-hidden="true" size={19}/>
    </button>
    {(uploading||recordingSaving||recording)&&<span className="chatComposerHint" aria-live="polite">
     {uploading?'Загружается вложение…':recordingSaving?(chatMediaPhase==='analyzing'?'Анализируется запись…':chatMediaPhase==='uploading'?'Загружается запись…':'Публикуется сообщение…'):'Идёт запись…'}
    </span>}
    <button type="button" className="chatSendButton iconOnly" disabled={sending||uploading||chatLoading||!text.trim()||!channelId}
     onClick={()=>void send()} aria-label="Отправить сообщение" title="Отправить"><Send aria-hidden="true" size={20}/></button>
   </div>
  </div>:<div className="chatGuestNote">Гостевой режим: просмотр переписки без отправки сообщений.</div>}
 </aside>;
}
function MessageIcon(){return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8 8.2 8.2 0 0 1-3.5-.8L4 20l1.3-4.4A8 8 0 1 1 20 11.5Z"/></svg>}
