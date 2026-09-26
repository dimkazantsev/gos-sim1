'use client';
import {FormEvent,useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';
import {actionStatus} from './constants';

export default function ActionsView({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,names,actions,currentStage,submitAction,judgeAction}=g;
 const [type,setType]=useState('Проект управленческого решения'),[title,setTitle]=useState(''),[body,setBody]=useState(''),[budget,setBudget]=useState(0);
 if(!game||!me)return null;
 async function send(e:FormEvent){if(await submitAction(e,{type,title,body,budget})){setTitle('');setBody('');setBudget(0)}}
 const list=actions.filter(a=>teacher||a.author_id===me.user_id);
 return <><section className="pageHeader"><div><small>УПРАВЛЕНЧЕСКИЕ РЕШЕНИЯ</small><h1>Инициативы и документы</h1><p>Каждое действие фиксируется в протоколе с привязкой к текущему этапу.</p></div></section>
 <section className="actionColumns"><form className="surface actionForm" onSubmit={send}><div className="surfaceHead"><div><small>НОВОЕ ДЕЙСТВИЕ</small><h2>Подать инициативу</h2></div></div><select value={type} onChange={e=>setType(e.target.value)}><option>Проект управленческого решения</option><option>Законопроект</option><option>Постановление</option><option>Публичное заявление</option><option>Запрос дополнительной информации</option><option>Межфракционное предложение</option></select><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название решения" required/><textarea rows={9} value={body} onChange={e=>setBody(e.target.value)} placeholder="Проблема → решение → ожидаемый эффект → риски" required/><label className="inlineLabel">Ресурс / бюджет<input type="number" min="0" value={budget} onChange={e=>setBudget(+e.target.value)}/></label><button className="primary" disabled={!game.turn_open}>Отправить на рассмотрение</button></form>
 <div className="surface"><div className="surfaceHead"><div><small>РЕЕСТР · ЭТАП {currentStage?.stage_no}</small><h2>{teacher?'Все решения':'Мои решения'}</h2></div><b>{list.length}</b></div><div className="decisionList">{list.length===0?<div className="emptyState">Решений пока нет.</div>:list.map(a=><article key={a.id}><small>{a.action_type} · {new Date(a.submitted_at).toLocaleString('ru-RU')}</small><h3>{a.title}</h3><p>{a.body}</p><div><span className={`decisionStatus ${a.status}`}>{actionStatus(a.status)}</span><span className="resourceTag">Ресурс: {a.budget}</span>{teacher&&<span className="authorTag">{names[a.author_id]||'Участник'}</span>}{teacher&&<><button onClick={()=>judgeAction(a.id,'accepted')}>✓ Принять</button><button onClick={()=>judgeAction(a.id,'rejected')}>× Отклонить</button></>}</div></article>)}</div></div></section></>
}