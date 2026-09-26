'use client';
import {useState} from 'react';
import type {ReturnTypeRepublic} from './viewTypes';

export default function DocumentsView({g}:{g:ReturnTypeRepublic}){
 const {documents,teacher,createDocument,names}=g;
 const [title,setTitle]=useState(''),[type,setType]=useState('Постановление'),[body,setBody]=useState('');
 async function create(){if(await createDocument({title,type,body})){setTitle('');setBody('')}}
 return <><section className="pageHeader"><div><small>НОРМАТИВНЫЙ КОНТУР</small><h1>Документы игры</h1><p>Постановления, проекты законов, протоколы, государственные программы, указы и иные материалы сохраняются внутри сессии.</p></div></section>
 {teacher&&<section className="surface documentBuilder"><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название документа"/><select value={type} onChange={e=>setType(e.target.value)}><option>Постановление</option><option>Проект ФЗ</option><option>Проект ФКЗ</option><option>Указ</option><option>Протокол заседания</option><option>Государственная программа</option><option>Бюджет</option><option>Иное</option></select><textarea rows={5} value={body} onChange={e=>setBody(e.target.value)} placeholder="Текст / краткое содержание"/><button className="primary" onClick={create}>Добавить документ</button></section>}
 <div className="documentGrid">{documents.length===0?<div className="emptyState">Документов пока нет.</div>:documents.map(d=><article className="documentCard" key={d.id}><div className="docIcon">▤</div><div><small>{d.doc_type||'Документ'} · {new Date(d.created_at).toLocaleDateString('ru-RU')}</small><h3>{d.title}</h3>{d.body&&<p>{d.body}</p>}<span>Автор: {d.created_by?names[d.created_by]||'Преподаватель':'Система'}</span></div></article>)}</div></>
}