/* Offline visual review, using real React components and explicitly fictional data.
   No browser automation, no network reads or writes, no game credentials. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const originalResolve=Module._resolveFilename;
Module._resolveFilename=function(request,...args){return originalResolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const h=React.createElement,noop=()=>{};
const labels=['Учреждение политических партий','Архитектура выборов в Государственную Думу','Распределение субъектов Федерации','Парламентские выборы и руководство ГД','Режим Ghost voting','Выдвижение кандидатов в Президенты','Президентские выборы','Формирование Правительства','Комитеты и министерства','Государственные программы','Заседание Правительства','Законодательный процесс','Федеральный бюджет','Муниципальное управление','Кризисное управление','Итоговый разбор'];
const {STAGE_ACTIONS}=require('../components/game/stageActions');
const now='2026-09-27T12:00:00.000Z';
const fixture={};
for(const key of ['metrics','events','actions','members','channels','messages','stages','parties','votes','ballots','evaluations','crises','documents','activities','presence','profiles','partyDocuments','partyInvitations','partyMandates','partyAgreements','politicalPosts','politicalMedia','postFormalLinks','politicalDecisions','metricHistory','partySupportHistory','impactRules','impactLedger','formalDocuments','formalHistory','myEvaluations'])fixture[key]=[];
Object.assign(fixture,{game:{id:'design-preview',title:'Республика Политология',status:'running',current_round:4,turn_open:true,turn_ends_at:'2026-09-29T12:00:00Z',settings:{}},me:{game_id:'design-preview',user_id:'teacher-demo',full_name:'Александр Сергеевич',kind:'teacher',role_title:'Преподаватель',group_name:null,team:null,score:0,joined_at:now,party_joined_at:null},loading:false,chatLoading:false,error:'',chatOpen:false,recording:null,recordingPreview:null,recordingSaving:false,recordingStartedAt:null,recordingStream:null,secondsLeft:840,realtimeState:'connected',teacher:true,names:{},averageVsn:0});
fixture.stages=labels.map((title,i)=>({id:'stage-'+(i+1),game_id:'design-preview',stage_no:i+1,title,summary:STAGE_ACTIONS[i+1].body,mode:'Учебная процедура',status:i<3?'completed':i===3?'open':'locked',deadline:null,opened_at:now,completed_at:null}));fixture.currentStage=fixture.stages[3];
fixture.parties=[['Новая перспектива','#2453e6',195],['Город и люди','#e394bf',150],['Общий курс','#172e74',105]].map(([name,color,mandates],i)=>({id:'party-'+i,game_id:'design-preview',name,color,mandates,regions:[36,29,24][i],support:[43,33,24][i],budget:0,ideology:'Программа развития',description:'Учебная партия в демонстрационном составе республики.',leader_user_id:'student-'+i,registration_status:'registered',registration_note:null,ghost_active:false,ghost_loss_current:0,representation_penalty:0,regional_seat_penalty:0,ghost_risk_weight:1,presidential_rating_modifier:0,logo_path:null}));
fixture.members=[fixture.me,...Array.from({length:18},(_,i)=>({game_id:'design-preview',user_id:'student-'+i,full_name:['Анна Миронова','Илья Соколов','Мария Волкова','Павел Орлов','София Смирнова','Михаил Крылов'][i%6]+(i>=6?' · '+(i+1):''),kind:'student',role_title:'Депутат Государственной Думы',team:fixture.parties[i%3].name,group_name:'ГМУ-1241',score:0,joined_at:now,party_joined_at:now}))];fixture.names=Object.fromEntries(fixture.members.map(m=>[m.user_id,m.full_name]));
fixture.metrics=[['public_trust','Общественное доверие',68,65,'%','society'],['economy','Экономика',72,70,'','economy'],['budget','Резерв бюджета',40,40,'','economy'],['social_stability','Социальная стабильность',64,62,'%','society'],['lawfulness','Законность',81,80,'%','state'],['international_standing','Внешняя репутация',56,57,'%','international'],['legitimacy','Легитимность',67,65,'%','state'],['elite_support','Поддержка элит',50,49,'%','elites'],['social_tension','Социальное напряжение',41,44,'%','society'],['media_climate','Информационный фон',50,50,'%','society'],['security','Безопасность',73,72,'%','state']].map(([metric_key,label,value,previous_value,unit,group_key],i)=>({id:'metric-'+i,game_id:'design-preview',metric_key,label,value,previous_value,unit,group_key,is_public:true,description:'Условный показатель для проверки интерфейса.',min_value:0,max_value:100,sort_order:i}));
fixture.events=[['Объявлен состав Государственной Думы','Распределены 450 мандатов между тремя фракциями. Следующий шаг — выдвинуть кандидатов на должность Председателя.'],['Партии готовы к парламентской работе','Завершена регистрация команд. Уставы и программы доступны в партийных кабинетах.'],['Открыто обсуждение парламентской повестки','Согласуйте порядок работы и подготовьте предложения от своей фракции.']].map(([title,body],i)=>({id:'event-'+i,title,body,severity:'notice',published_at:new Date(Date.parse(now)-i*1000*1800).toISOString()}));
fixture.channels=[{id:'public-demo',name:'Общий штаб',kind:'public'},{id:'party-demo',name:'Моя фракция',kind:'team'}];fixture.channelId='public-demo';
fixture.messages=[
 {id:'c1',game_id:'design-preview',channel_id:'public-demo',author_id:'student-0',kind:'text',text:'Где все? Напоминаю, что заседание начинается через 15 минут.',storage_path:null,mime_type:null,created_at:'2026-09-27T09:15:00Z'},
 {id:'c2',game_id:'design-preview',channel_id:'public-demo',author_id:'student-0',kind:'text',text:'Подготовили окончательную повестку?',storage_path:null,mime_type:null,created_at:'2026-09-27T09:16:00Z'},
 {id:'c3',game_id:'design-preview',channel_id:'public-demo',author_id:'teacher-demo',kind:'text',text:'Прошу проверить материалы и подготовить предложения к заседанию.',storage_path:null,mime_type:null,created_at:'2026-09-27T09:19:00Z'},
 {id:'c4',game_id:'design-preview',channel_id:'public-demo',author_id:'student-1',kind:'text',text:'Проект постановления готов. Направляю документ для обсуждения.',storage_path:null,mime_type:null,created_at:'2026-09-27T09:22:00Z'},
 {id:'c5',game_id:'design-preview',channel_id:'public-demo',author_id:'student-1',kind:'file',text:'Проект постановления.pdf',storage_path:'preview/mock.pdf',mime_type:'application/pdf',url:'data:application/pdf;base64,JVBERi0xLjQK',created_at:'2026-09-27T09:23:00Z'},
 {id:'c6',game_id:'design-preview',channel_id:'public-demo',author_id:'teacher-demo',kind:'text',text:'Предлагаю рассмотреть оба варианта и вынести решение на голосование.',storage_path:null,mime_type:null,created_at:'2026-09-28T11:44:00Z'},
 {id:'c7',game_id:'design-preview',channel_id:'public-demo',author_id:'student-0',kind:'text',text:'Согласна. Добавлю аргументы в проект.',storage_path:null,mime_type:null,created_at:'2026-09-28T11:46:00Z'}
];
// Tiny valid WAV fixture exercises real voice playback without live credentials.
const voiceSamples=8000;
const voiceWav=Buffer.alloc(44+voiceSamples*2);
voiceWav.write('RIFF',0);voiceWav.writeUInt32LE(voiceWav.length-8,4);
voiceWav.write('WAVEfmt ',8);voiceWav.writeUInt32LE(16,16);
voiceWav.writeUInt16LE(1,20);voiceWav.writeUInt16LE(1,22);
voiceWav.writeUInt32LE(8000,24);voiceWav.writeUInt32LE(16000,28);
voiceWav.writeUInt16LE(2,32);voiceWav.writeUInt16LE(16,34);
voiceWav.write('data',36);voiceWav.writeUInt32LE(voiceSamples*2,40);
for(let i=0;i<voiceSamples;i++){
 const envelope=.2+.8*(.5+.5*Math.sin(i/8000*2*Math.PI*3));
 voiceWav.writeInt16LE(Math.round(Math.sin(i/8000*2*Math.PI*440)*1800*envelope),44+i*2);
}
const voicePreviewUrl='data:audio/wav;base64,'+voiceWav.toString('base64');
const voiceRms=Array.from({length:36},(_,i)=>{
 let sum=0;const start=Math.floor(i*voiceSamples/36),end=Math.floor((i+1)*voiceSamples/36);
 for(let n=start;n<end;n++){const sample=voiceWav.readInt16LE(44+n*2)/32768;sum+=sample*sample}
 return Math.sqrt(sum/Math.max(end-start,1));
});
const peak=Math.max(...voiceRms,1e-6);
const voiceWave=voiceRms.map(v=>Math.round(Math.max(18,Math.min(100,18+82*(v/peak)**.65))));
fixture.messages.push(
 {id:'c8',game_id:'design-preview',channel_id:'public-demo',author_id:'teacher-demo',kind:'audio',text:'voice-preview.wav',storage_path:'preview/mock.wav',mime_type:'audio/wav',url:voicePreviewUrl,voice_meta:{duration:1,waveform:voiceWave},created_at:'2026-09-28T12:00:00Z'},
 {id:'c9',game_id:'design-preview',channel_id:'public-demo',author_id:'student-0',kind:'video',text:null,storage_path:'preview/video.webm',mime_type:'video/webm',created_at:'2026-09-28T12:03:00Z'}
);
fixture.chatPins=[{id:'pin-audio',game_id:'design-preview',channel_id:'public-demo',message_id:'c8',pinned_by:'teacher-demo',pinned_at:'2026-09-28T14:01:00Z'},{id:'pin-video',game_id:'design-preview',channel_id:'public-demo',message_id:'c9',pinned_by:'teacher-demo',pinned_at:'2026-09-28T14:02:00Z'},{id:'pin-file',game_id:'design-preview',channel_id:'public-demo',message_id:'c5',pinned_by:'teacher-demo',pinned_at:'2026-09-28T14:00:00Z'}];
fixture.pinnedMessages=fixture.messages.filter(m=>fixture.chatPins.some(pin=>pin.message_id===m.id));
fixture.votes=[{id:'vote-demo',stage_no:4,title:'Об утверждении повестки заседания',body:'Предлагается утвердить порядок рассмотрения вопросов первого заседания Государственной Думы.',voting_mode:'mandate',status:'open',opened_at:now,closed_at:null,institution_key:'gd',procedure_key:'gd_resolution',quorum_kind:'fraction',quorum_value:.5,majority_kind:'eligible_majority',majority_value:.5,allow_abstain:true,result_code:null}];
fixture.availableActors=()=>[{key:'participant',label:'Участник'},{key:'gd',label:'Государственная Дума'}];fixture.canVote=()=>false;fixture.tally=()=>({yes:245,no:70,abstain:30});fixture.quorum=()=>({cast:345,eligible:450,needed:226,met:true});
const g=new Proxy(fixture,{get:(target,key)=>key in target?target[key]:noop});
// Replace only this process's hook export. The application source remains unchanged.
require('../components/game/useRepublicGame').useRepublicGame=()=>g;
const GameClient=require('../components/GameClient').default;
const base=renderToStaticMarkup(h(GameClient,{gameId:'design-preview'}));
const {AppRouterContext}=require('next/dist/shared/lib/app-router-context.shared-runtime');
const Home=require('../app/page').default;
const login=renderToStaticMarkup(h(AppRouterContext.Provider,{value:{push:noop,replace:noop,prefetch:noop,back:noop,forward:noop,refresh:noop}},h(Home)));
const pages=[['entry','Вход',login],['dashboard','Обзор',base]];
fixture.chatOpen=true;pages.push(['chat','Чат и обзор',renderToStaticMarkup(h(GameClient,{gameId:'design-preview'}))]);fixture.chatOpen=false;
const ChatPanel=require('../components/game/ChatPanel').default;
pages.push(['chat-panel','Командный чат',renderToStaticMarkup(h('main',{className:'previewChatPage'},h(ChatPanel,{g,draft:'',onDraftChange:noop})))]);
pages.push(['chat-channels','Список каналов',renderToStaticMarkup(h('main',{className:'previewChatPage'},h(ChatPanel,{g,draft:'',onDraftChange:noop,previewChannelOpen:true})))]);
pages.push(['chat-pins','Закреплённые материалы',renderToStaticMarkup(h('main',{className:'previewChatPage'},h(ChatPanel,{g,draft:'',onDraftChange:noop,previewPinsOpen:true})))]);
const savedRecording={recording:fixture.recording,recordingPreview:fixture.recordingPreview,recordingSaving:fixture.recordingSaving,recordingStartedAt:fixture.recordingStartedAt};
fixture.recording='audio';fixture.recordingStartedAt=Date.now()-32000;
pages.push(['chat-recording','Запись аудио',renderToStaticMarkup(h('main',{className:'previewChatPage'},h(ChatPanel,{g,draft:'',onDraftChange:noop})))]);
fixture.recording=null;fixture.recordingStartedAt=null;
fixture.recordingPreview={kind:'audio',blob:new Blob([voiceWav],{type:'audio/wav'}),url:voicePreviewUrl,mime:'audio/wav',fileName:'audio-preview.wav',channelId:'public-demo',duration:1,waveform:voiceWave};
pages.push(['chat-audio-preview','Предпросмотр аудио',renderToStaticMarkup(h('main',{className:'previewChatPage'},h(ChatPanel,{g,draft:'',onDraftChange:noop})))]);
fixture.recordingPreview={kind:'video',blob:new Blob(['mock video'],{type:'video/webm'}),url:'data:video/webm;base64,GkXfo',mime:'video/webm',fileName:'video-preview.webm',channelId:'public-demo',duration:18};
pages.push(['chat-video-preview','Предпросмотр видео',renderToStaticMarkup(h('main',{className:'previewChatPage'},h(ChatPanel,{g,draft:'',onDraftChange:noop})))]);
Object.assign(fixture,savedRecording);
const originalMessages=fixture.messages;
fixture.messages=[];
pages.push(['chat-empty','Пустой чат',renderToStaticMarkup(h('main',{className:'previewChatPage'},h(ChatPanel,{g,draft:'',onDraftChange:noop})))]);
fixture.messages=originalMessages;
const originalMe=fixture.me;fixture.me=fixture.members[1];fixture.teacher=false;pages.push(['student','Обзор участника',renderToStaticMarkup(h(GameClient,{gameId:'design-preview'}))]);fixture.game.turn_open=false;pages.push(['paused','Игра на паузе',renderToStaticMarkup(h(GameClient,{gameId:'design-preview'}))]);fixture.game.turn_open=true;fixture.me=originalMe;fixture.teacher=true;fixture.realtimeState='disconnected';pages.push(['offline','Связь потеряна',renderToStaticMarkup(h(GameClient,{gameId:'design-preview'}))]);fixture.realtimeState='connected';
const PublicScreen=require('../components/PublicScreen').default;pages.push(['audience','Экран аудитории',renderToStaticMarkup(h(PublicScreen,{gameId:'design-preview'}))]);
// Render the real metric modal with historical and comparable metrics so layout
// can be inspected at 360/390/768px and desktop without live credentials.
fixture.game.created_at=now;
fixture.metricHistory=fixture.metrics.slice(0,3).flatMap((metric,index)=>{
 const base=Number(metric.value)-(index===0?8:index===1?7:6);
 return [
  {id:index*3+1,game_id:'design-preview',metric_id:metric.id,metric_key:metric.metric_key,value:base,previous_value:null,delta:0,source_type:'baseline',source_id:null,actor_id:null,note:'Начальная точка показателя',recorded_at:'2026-09-27T12:00:00Z'},
  {id:index*3+2,game_id:'design-preview',metric_id:metric.id,metric_key:metric.metric_key,value:base+3,previous_value:base,delta:3,source_type:'decision',source_id:null,actor_id:null,note:'Завершение первого игрового этапа',recorded_at:'2026-09-28T10:00:00Z'},
  {id:index*3+3,game_id:'design-preview',metric_id:metric.id,metric_key:metric.metric_key,value:Number(metric.value),previous_value:base+3,delta:Number(metric.value)-base-3,source_type:'decision',source_id:null,actor_id:null,note:'Принято решение по итогам заседания',recorded_at:'2026-09-29T11:00:00Z'}
 ];
});
const StateMetricsDock=require('../components/game/StateMetricsDock').default;
pages.push(['metric-modal','График показателя',renderToStaticMarkup(h('main',{className:'previewMetricPage'},h(StateMetricsDock,{
 g,initialSelectedMetricId:fixture.metrics[0].id,initialCompareIds:[fixture.metrics[1].id,fixture.metrics[2].id]
})))]);
pages.push(['metric-modal-full','Предел сравнения',renderToStaticMarkup(h('main',{className:'previewMetricPage'},h(StateMetricsDock,{
 g,initialSelectedMetricId:fixture.metrics[0].id,initialCompareIds:[fixture.metrics[1].id,fixture.metrics[2].id,fixture.metrics[3].id]
})))]);
const savedMetricHistory=fixture.metricHistory;
fixture.metricHistory=[];
pages.push(['metric-modal-empty','График без истории',renderToStaticMarkup(h('main',{className:'previewMetricPage'},h(StateMetricsDock,{
 g,initialSelectedMetricId:fixture.metrics[0].id
})))]);
fixture.metricHistory=savedMetricHistory;
const defs=[['stages','Этапы','StagesView'],['parties','Партии','PartiesView'],['votes','Голосования','VotesView'],['documents','Реестр НПА','DocumentsView'],['actions','Процессы','PoliticalWallView'],['grades','Оценки','GradesView'],['teacher','Управление','TeacherView'],['profile','Профиль','ProfileView']];
for(const [id,label,file] of defs){const Component=require('../components/game/'+file).default;const content=renderToStaticMarkup(h(Component,{g,onNavigate:noop,onOpenVotes:noop,onOpenStages:noop,onOpenDocument:noop,onOpenProcesses:noop}));pages.push([id,label,base.replace(/(<main id="game-main"[^>]*>)[\s\S]*?(<\/main>)/,(_,start,end)=>start+content+end)]);}
let css=fs.readFileSync(path.join(root,'app/globals.css'),'utf8');css=css.replace(/@import '\.\/([^']+)' layer\(legacy\);/g,(_,file)=>'@layer legacy {\n'+fs.readFileSync(path.join(root,'app',file),'utf8')+'\n}');
for(const file of ['design-tokens','design-shell','design-views','design-responsive','design-readability','teacher-mobile'])css+='\n'+fs.readFileSync(path.join(root,'app',file+'.css'),'utf8');
for(const subset of ['latin','cyrillic']){const file=path.join(root,'node_modules/@fontsource-variable/manrope/files',`manrope-${subset}-wght-normal.woff2`);css+=`\n@font-face{font-family:'Manrope Variable';font-style:normal;font-weight:200 800;font-display:swap;src:url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')}) format('woff2');unicode-range:${subset==='cyrillic'?'U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116':'U+0000-00FF,U+0131,U+0152-0153,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215'};}`;}
css+='\n.previewNotice{position:fixed;z-index:2000;bottom:100px;left:50%;transform:translateX(-50%);max-width:calc(100% - 32px);background:#172447;color:white;border-radius:12px;padding:16px 20px;font:14px/1.5 sans-serif;box-shadow:0 12px 36px #17244733}.previewNotice[hidden]{display:none}';
function doc(markup){return '<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body>'+markup+'<div class="previewNotice" hidden role="status"></div><script>document.addEventListener("submit",e=>e.preventDefault());document.addEventListener("click",e=>{const b=e.target.closest("button,a");if(!b)return;e.preventDefault();const nav=b.closest(".focusNav,.mobileDock");if(nav){parent.postMessage({type:"navigate",text:b.innerText},"*");return}const n=document.querySelector(".previewNotice");n.textContent="Это макет с вымышленными данными. Рабочие действия доступны в самой игре.";n.hidden=false;clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>n.hidden=true,3000)});<\/script></body></html>';}
const data=JSON.stringify(pages.map(([id,label,markup])=>({id,label,html:doc(markup)}))).replaceAll('<','\\u003c');
const html=`<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GOS//SIMS — новый дизайн</title><style>*{box-sizing:border-box}body{margin:0;background:#dfe5f1;font:14px/1.5 system-ui,sans-serif;color:#172447}.reviewBar{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:12px 20px;background:#172447;color:#fff}.reviewBar strong{font-size:16px}.reviewBar select,.reviewBar button{font:inherit;min-height:38px;padding:7px 12px;background:white;color:#172447;border:0;border-radius:7px}.reviewBar p{margin:0;font-size:12px;color:#d4ddf5}.reviewBar .grow{flex:1}iframe{display:block;border:0;background:#fff;height:calc(100dvh - 108px);width:100%;max-width:100%;margin:auto}.reviewNote{padding:9px 20px;background:#fff1f7;font-size:12px;text-align:center;color:#742651}button:focus-visible,select:focus-visible{outline:3px solid #f3a8cf;outline-offset:3px}</style></head><body><header class="reviewBar"><strong>GOS//SIMS · Дизайн 4.0</strong><select id="screen" aria-label="Экран"></select><div class="grow"></div><button data-width="100%">По ширине окна</button><button data-width="768px">768 px</button><button data-width="390px">390 px</button><button data-width="360px">360 px</button></header><div class="reviewNote">Макет для просмотра · Вымышленные данные · Сетевые действия и вход отключены. Можно переключать экраны и ширину.</div><iframe id="preview" title="Предпросмотр дизайна GOS SIM" sandbox="allow-scripts allow-same-origin"></iframe><script>const pages=${data};const select=document.getElementById('screen'),frame=document.getElementById('preview');for(const page of pages){const o=document.createElement('option');o.value=page.id;o.textContent=page.label;select.append(o)}function show(id){const p=pages.find(p=>p.id===id)||pages[0];select.value=p.id;frame.srcdoc=p.html}select.addEventListener('change',()=>show(select.value));for(const b of document.querySelectorAll('[data-width]'))b.addEventListener('click',()=>frame.style.width=b.dataset.width);window.addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.data?.type!=='navigate')return;const map={'Обзор игры':'dashboard','Этапы и задачи':'stages','Политические процессы':'actions','Моя партия':'parties','Партии':'parties','Голосования':'votes','Реестр НПА':'documents','Оценки и разбор':'grades','Управление':'teacher','Мой профиль':'profile'};for(const [label,id] of Object.entries(map))if(e.data.text.trim().startsWith(label)){show(id);break}});show('dashboard');</script></body></html>`;
const out=path.join(root,'.design-review');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'gos-sim-preview.html'),html);
for(const [id,,markup] of pages)fs.writeFileSync(path.join(out,id+'.html'),markup);
console.log(`${pages.length} screens rendered from application components; offline preview ${Buffer.byteLength(html)} bytes.`);
