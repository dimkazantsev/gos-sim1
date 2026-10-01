'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
type Feedback={role:string;authority_ok:boolean;lawful:boolean;legal_basis:string;chosen_consequence:string;lawful_choices:{label:string;description:string;roles:string[]}[]};
export default function EventDecisionFeedback({caseId}:{caseId:string}){
 const [value,setValue]=useState<Feedback|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;void supabase.rpc('get_event_decision_feedback',{p_case_id:caseId}).then(r=>{if(active){if(r.error)setError('Не удалось загрузить разбор. Откройте событие повторно.');else setValue(r.data as Feedback)}});return()=>{active=false}},[caseId]);
 return <section className="eventLegalFeedback" aria-label="Разбор решения"><h4>Как следовало действовать</h4>{error?<p role="status">{error}</p>:!value?<p>Загружаем правовой разбор…</p>:<>
 <p>Ваша должность при ответе: <b>{value.role||'Без должности'}</b>.</p>
 <p>{value.authority_ok&&value.lawful?'Решение соответствует праву и вашим полномочиям.':!value.authority_ok?'Для этого решения требовались полномочия другого должностного лица. Следовало пригласить его к рассмотрению ситуации.':'Выбранное действие не соответствует правовым требованиям ситуации.'}</p>
 {value.chosen_consequence&&<p>{value.chosen_consequence}</p>}
 {value.lawful_choices.map((c,i)=><article key={i}><b>{c.label}</b><p>{c.description}</p>{c.roles?.length>0&&<small>Уполномоченные лица: {c.roles.join(', ')}</small>}</article>)}
 <p className="eventLegalBasis"><b>Правовое основание:</b> {value.legal_basis||'Применяется компетенция соответствующего органа и порядок принятия решения.'}</p>
 </>}</section>;
}
