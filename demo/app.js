const $=(q,r=document)=>r.querySelector(q), $$=(q,r=document)=>[...r.querySelectorAll(q)];
const KEY='gossim.demo.v1', uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2);
const seed={user:null,mode:'student',round:1,seconds:720,open:true,chat:false,
metrics:[['Легитимность',67,'%'],['Экономика',54,'%'],['Бюджет',742,' млн'],['Соц. напряжение',41,'%'],['Безопасность',73,'%']],
events:[
{id:uid(),title:'Забастовка работников транспортного узла',body:'Профсоюз требует пересмотра тарифа и гарантий занятости.',impact:'+8 напряжение'},
{id:uid(),title:'Падение налоговых поступлений на 6%',body:'Минфин предупреждает о риске дефицита.',impact:'−24 млн'}],
missions:[['Подготовить проект решения по транспортному кризису',false],['Согласовать позицию с ведомством',false],['Оценить политический риск',false]],
actions:[],messages:[{author:'Система',text:'Раунд 1 начат. Канал доступен всем участникам.'}],journal:[]};
let s=(()=>{try{return {...structuredClone(seed),...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return structuredClone(seed)}})();
let timer,rec,stream,chunks=[];
const save=()=>localStorage.setItem(KEY,JSON.stringify({...s,messages:s.messages.filter(x=>!x.url)}));
const log=(title,body)=>{s.journal.unshift({time:new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),title,body});save()};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(){
 const logged=!!s.user; $('#authView').classList.toggle('hidden',logged); $('#gameView').classList.toggle('hidden',!logged); if(!logged)return;
 $('#profileName').textContent=s.user.fio.split(' ').slice(0,2).join(' '); $('#profileInitials').textContent=s.user.fio.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase();
 $('#teacherPanelBtn').classList.toggle('hidden',s.user.mode!=='teacher'); $('#roleName').textContent=s.user.mode==='teacher'?'Руководитель симуляции':'Министр внутренней политики';
 $('#roleLevel').textContent=s.user.mode==='teacher'?'Полный контроль сессии':'Исполнительная власть'; $('#sessionStatus').textContent=`Раунд ${s.round} · ${s.open?'активен':'ход закрыт'}`;
 $('#stateMetrics').innerHTML=s.metrics.map(m=>`<div class="metric"><span>${esc(m[0])}</span><strong>${m[1]}${m[2]}</strong><i style="width:${Math.min(100,Number(m[1]))}%"></i></div>`).join('');
 $('#eventsFeed').innerHTML=s.events.map(e=>`<article class="event"><div class="event-icon">◆</div><div><h4>${esc(e.title)}</h4><p>${esc(e.body)}</p><small>${esc(e.impact)}</small></div></article>`).join('');
 $('#missionList').innerHTML=s.missions.map((m,i)=>`<div class="mission ${m[1]?'done':''}"><button data-m="${i}">${m[1]?'✓':''}</button><strong>${esc(m[0])}</strong></div>`).join('');
 $$('[data-m]').forEach(b=>b.onclick=()=>{s.missions[+b.dataset.m][1]=!s.missions[+b.dataset.m][1];save();render()});
 $('#actionsTable').innerHTML=s.actions.map(a=>`<div class="data-row"><div><strong>${esc(a.title)}</strong><div class="subtle small">${esc(a.type)}</div></div><span>Раунд ${a.round}</span><span>${a.budget} млн</span><span class="tag">${a.status}</span></div>`).join('')||'<p class="subtle">Действий пока нет.</p>';
 $('#institutionsGrid').innerHTML=['Правительство','Парламент','Администрация главы государства','Судебная власть','СМИ','Группы интересов'].map(x=>`<div class="card institution"><div class="symbol">◇</div><h3>${x}</h3><p class="subtle">Полномочия и коммуникации игрового актора.</p></div>`).join('');
 $('#documentsList').innerHTML=['Конституция Республики Альтаир','Закон о бюджете','Регламент Правительства','План реагирования на кризисы'].map(x=>`<article class="doc-card"><span class="tag">Документ</span><h4>${x}</h4><p>Доступен участникам в соответствии с ролью.</p></article>`).join('');
 $('#playerScore').textContent=72+s.actions.length*4+s.missions.filter(x=>x[1]).length*3;
 $('#scoreBars').innerHTML=['Участие','Качество','Кооперация','Процедуры'].map((x,i)=>`<div class="score-bar"><span>${x}</span><i style="width:${[82,74,63,71][i]}%"></i></div>`).join('');
 $('#stabilityChart').innerHTML=[64,61,59,55,58,57,60,62,59,63,66].map(v=>`<i style="height:${v*2}px"></i>`).join('');
 $('#activityLeaderboard').innerHTML=['Орлова А.','Иванов И.','Смирнов П.','Ким Д.','Соколова М.'].map((x,i)=>`<div class="leader"><span>${i+1}. ${x}</span><b>${91-i*7}</b></div>`).join('');
 $('#journalList').innerHTML=s.journal.map(j=>`<div class="timeline-item"><strong>${esc(j.title)}</strong><p>${esc(j.body)}</p><time>${j.time}</time></div>`).join('');
 $('#chatMessages').innerHTML=s.messages.map(m=>`<div class="message"><span class="avatar">•</span><div class="message-bubble"><strong>${esc(m.author)}</strong>${m.text?`<p>${esc(m.text)}</p>`:''}${m.kind==='audio'&&m.url?`<audio controls src="${m.url}"></audio>`:''}${m.kind==='video'&&m.url?`<video controls playsinline src="${m.url}"></video>`:''}</div></div>`).join('');
 $('#chatDock').classList.toggle('hidden',!s.chat); startTimer();
}
function startTimer(){clearInterval(timer);const paint=()=>$('#turnTimer').textContent=`${String(Math.floor(s.seconds/60)).padStart(2,'0')}:${String(s.seconds%60).padStart(2,'0')}`;paint();if(!s.open)return;timer=setInterval(()=>{if(s.seconds>0){s.seconds--;paint();if(!(s.seconds%10))save()}else{s.open=false;save();render()}},1000)}
$$('[data-auth-mode]').forEach(b=>b.onclick=()=>{s.mode=b.dataset.authMode;$$('[data-auth-mode]').forEach(x=>x.classList.toggle('active',x===b));$('#groupField').classList.toggle('hidden',s.mode==='teacher');$('#teacherCodeField').classList.toggle('hidden',s.mode!=='teacher')});
$('#loginForm').onsubmit=e=>{e.preventDefault();const fio=$('#fioInput').value.trim();if(s.mode==='teacher'&&$('#teacherCodeInput').value!=='PREPOD2026')return alert('Код преподавателя: PREPOD2026');s.user={fio,mode:s.mode,group:$('#groupInput').value};log('Вход в игру',fio);save();render()};
$('#logoutBtn').onclick=()=>{s.user=null;save();render()}; $('#mobileMenuBtn').onclick=()=>$('#sidebar').classList.toggle('open');
$$('.nav-item').forEach(b=>b.onclick=()=>{$$('.nav-item').forEach(x=>x.classList.toggle('active',x===b));$$('.view-panel').forEach(x=>x.classList.add('hidden'));$('#'+b.dataset.view+'Panel').classList.remove('hidden');$('#sidebar').classList.remove('open')});
$('#openChatBtn').onclick=()=>{s.chat=true;save();render()}; $('#closeChatBtn').onclick=()=>{s.chat=false;save();render()};
$('#sendChatBtn').onclick=()=>{const t=$('#chatInput').value.trim();if(!t)return;s.messages.push({author:s.user.fio,text:t});$('#chatInput').value='';log('Сообщение',t);render()};
async function record(kind){if(rec?.state==='recording')return rec.stop();try{stream=await navigator.mediaDevices.getUserMedia(kind==='audio'?{audio:true}:{audio:true,video:true});chunks=[];rec=new MediaRecorder(stream);rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);rec.onstop=()=>{const url=URL.createObjectURL(new Blob(chunks,{type:rec.mimeType}));s.messages.push({author:s.user.fio,kind,url});stream.getTracks().forEach(t=>t.stop());rec=null;render()};rec.start()}catch{alert('Нужен доступ к микрофону/камере через https или localhost')}}
$('#audioBtn').onclick=()=>record('audio'); $('#videoBtn').onclick=()=>record('video');
$('#submitActionBtn').onclick=()=>{const title=$('#actionTitle').value.trim(),body=$('#actionBody').value.trim();if(!title||!body)return alert('Заполните название и обоснование');s.actions.unshift({title,body,type:$('#actionType').value,budget:+$('#actionBudget').value||0,status:'На рассмотрении',round:s.round});log('Отправлено действие',title);save();render();alert('Отправлено преподавателю')};
$$('[data-quick-action]').forEach(b=>b.onclick=()=>{$$('.nav-item').find(x=>x.dataset.view==='actions').click();$('#actionTitle').focus()});
$('#exportLogBtn').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(s,null,2)],{type:'application/json'}));a.download='gossim-session.json';a.click()};
$('#teacherPanelBtn').onclick=()=>{const r=$('#modalRoot');r.classList.remove('hidden');r.innerHTML=`<div class="modal"><div class="modal-head"><h2>Панель преподавателя</h2><button id="x" class="icon-btn">×</button></div><div class="teacher-grid"><div class="control-block"><h3>Ход игры</h3><button id="n" class="primary">Следующий раунд</button> <button id="t" class="secondary">${s.open?'Закрыть ход':'Открыть ход'}</button></div><div class="control-block"><h3>Событие</h3><input id="et" placeholder="Заголовок"><textarea id="eb" placeholder="Описание"></textarea><button id="ep" class="primary">Опубликовать</button></div><div class="control-block"><h3>Действия студентов</h3>${s.actions.map((a,i)=>`<div class="student-row"><span>${esc(a.title)}</span><button data-a="${i}">Принять</button></div>`).join('')}</div></div></div>`;$('#x').onclick=()=>r.classList.add('hidden');$('#n').onclick=()=>{s.round++;s.seconds=720;s.open=true;save();r.classList.add('hidden');render()};$('#t').onclick=()=>{s.open=!s.open;save();r.classList.add('hidden');render()};$('#ep').onclick=()=>{const title=$('#et').value.trim(),body=$('#eb').value.trim();if(title&&body){s.events.unshift({id:uid(),title,body,impact:'новое событие'});log('Событие опубликовано',title);save();r.classList.add('hidden');render()}};$$('[data-a]',r).forEach(b=>b.onclick=()=>{s.actions[+b.dataset.a].status='Принято';save();r.classList.add('hidden');render()})};
$('#filterEventsBtn').onclick=()=>alert('Фильтры событий будут подключены к production API.'); $('#soundToggle').onclick=()=>$('#soundToggle').classList.toggle('muted');
render();
