import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {applyPortableAction} from './engine.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const original=JSON.parse(fs.readFileSync(path.join(root,'game.json'),'utf8'));
if(original.format!=='GOS-SIMS'||![1,2].includes(original.schema))throw Error('Некорректный Архив Сеанса');
const progress=path.join(root,'progress.json');
let state=fs.existsSync(progress)?JSON.parse(fs.readFileSync(progress,'utf8')):structuredClone(original);
const sessions=new Map();
const teacherCode=process.env.GOS_TEACHER_CODE||crypto.randomBytes(12).toString('base64url');
const studentCode=process.env.GOS_STUDENT_CODE||crypto.randomBytes(8).toString('base64url');
const host=process.env.GOS_HOST||'0.0.0.0',port=Number(process.env.PORT||8080);
function teacher(user){return user?.kind==='teacher'}
function current(req){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('gos_session='));return sessions.get(cookie?.slice(12))||{id:null,kind:'observer',name:'Гость'}}
function visible(user){
 if(teacher(user))return state;
 const tables={},include=['game_members','state_metrics','game_stages','game_parties','event_assignments','event_decisions','event_case_outcomes'];
 for(const name of include)tables[name]=structuredClone(state.tables[name]||[]);
 const assigned=new Set(tables.event_assignments.map(a=>a.case_id));
 tables.event_cases=(state.tables.event_cases||[]).filter(c=>assigned.has(c.id));
 tables.game_profiles=(state.tables.game_profiles||[]).map(({user_id,bio,gender,avatar_path})=>({user_id,bio,gender,avatar_path}));
 tables.political_posts=(state.tables.political_posts||[]).filter(p=>!['draft','rejected'].includes(p.status));
 tables.game_documents=state.tables.game_documents||[];
 tables.formal_documents=(state.tables.formal_documents||[]).filter(d=>['published','enacted','signed','effective'].includes(d.status));
 return {format:state.format,schema:state.schema,game:state.game,tables};
}
function save(){const temp=progress+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2));fs.renameSync(temp,progress)}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
async function body(req){let text='';for await(const part of req){text+=part;if(text.length>512000)throw Error('Запрос Слишком Большой')}return text?JSON.parse(text):{}}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost'),user=current(req);
  if(req.method==='POST'){
   if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){json(res,403,{error:'Недопустимый Источник Запроса'});return}
   const d=await body(req);
   if(url.pathname==='/api/login'){
    let next={id:null,kind:'observer',name:'Гость'};
    if(d.kind==='teacher'){
     if(d.password!==teacherCode){json(res,403,{error:'Неверный Код Преподавателя'});return}
     const member=(state.tables.game_members||[]).find(m=>m.kind==='teacher');next={id:member?.user_id||state.game.owner_id,kind:'teacher',name:member?.full_name||'Преподаватель'};
    }else if(d.kind==='student'){
     if(d.password!==studentCode){json(res,403,{error:'Неверный Код Участника'});return}
     const members=(state.tables.game_members||[]).filter(m=>m.kind==='student'&&m.full_name.trim()===String(d.name||'').trim());
     if(members.length!==1){json(res,403,{error:'Укажите Однозначное ФИО Участника Из Сеанса'});return}
     next={id:members[0].user_id,kind:'student',name:members[0].full_name};
    }else if(d.kind!=='observer'){json(res,403,{error:'Неизвестная Роль'});return}
    const token=crypto.randomBytes(32).toString('base64url');sessions.set(token,next);res.setHeader('Set-Cookie','gos_session='+token+'; HttpOnly; SameSite=Strict; Path=/');json(res,200,{user:next,state:visible(next)});return;
   }
   if(url.pathname==='/api/logout'){const cookie=(req.headers.cookie||'').match(/gos_session=([^;]+)/);if(cookie)sessions.delete(cookie[1]);res.setHeader('Set-Cookie','gos_session=; Max-Age=0; Path=/');json(res,200,{ok:true});return}
   if(url.pathname==='/api/reset'){
    if(!teacher(user)){json(res,403,{error:'Доступно Только Преподавателю'});return}
    state=structuredClone(original);save();json(res,200,{state:visible(user)});return;
   }
   if(url.pathname==='/api/action'){
    if(user.kind==='observer'){json(res,403,{error:'Гость Может Только Просматривать Игру'});return}
    const next=structuredClone(state);
    applyPortableAction(next,user,d.action,d);
    const previous=state;state=next;
    try{save()}catch(error){state=previous;throw error}
    json(res,200,{state:visible(user)});return;
   }
   json(res,404,{error:'Действие Не Найдено'});return;
  }
  if(req.method!=='GET'){json(res,405,{error:'Метод Не Поддерживается'});return}
  if(url.pathname==='/api/state'){json(res,200,{user,state:visible(user)});return}
  if(url.pathname==='/api/export'){
   if(!teacher(user)){json(res,403,{error:'Экспорт Доступен Преподавателю'});return}
   json(res,200,state);return;
  }
  if(url.pathname==='/'||url.pathname==='/index.html'){
   const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script id="session-data" type="application\/json">[\s\S]*?<\/script>/,'<script id="session-data" type="application/json">null</script>');
   res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(html);return;
  }
  if(url.pathname.startsWith('/media/')){
   const relative=decodeURIComponent(url.pathname.slice(1)),file=path.resolve(root,relative),mediaRoot=path.join(root,'media')+path.sep;
   if(!file.startsWith(mediaRoot)){json(res,403,{error:'Файл Недоступен'});return}
   const parts=relative.split('/');
   if(!teacher(user)){
    if(relative.includes('/signature-')||relative.includes('/formal/')||relative.includes('/parties/')){json(res,403,{error:'Файл Недоступен В Гостевом Просмотре'});return}
    if(parts[1]==='game-media'){
     const channel=(state.tables.chat_channels||[]).find(c=>c.id===parts[3]);
     if(!channel||channel.kind!=='public'){json(res,403,{error:'Закрытый Канал'});return}
    }
   }
   if(!fs.existsSync(file)||!fs.statSync(file).isFile()){json(res,404,{error:'Файл Не Найден'});return}
   const ext=path.extname(file),type={'.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.webm':'video/webm','.pdf':'application/pdf'}[ext]||'application/octet-stream';
   res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res);return;
  }
  json(res,404,{error:'Страница Не Найдена'});
 }catch(error){json(res,400,{error:error.message||'Ошибка Сеанса'})}
});
server.listen(port,host,()=>{console.log('GOS//SIMS: http://localhost:'+port);console.log('Код Преподавателя: '+teacherCode);console.log('Код Участников: '+studentCode);console.log('Гость Не Требует Кода. Прогресс Сохраняется В Progress.json.');});
