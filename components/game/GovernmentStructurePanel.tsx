'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';

type Structure={game_id:string;social_title:string;economic_title:string;defence_title:string;foreign_title:string;internal_title:string;status:'draft'|'submitted'|'approved'|'revision';note:string|null;proposed_by:string|null;reviewed_by:string|null};
const defaults={social:'Министерство по социальной политике',economic:'Министерство по экономической политике',defence:'Министерство по обороне и внутренней безопасности',foreign:'Министерство по внешней политике',internal:'Министерство по внутренней политике и государству'};

export default function GovernmentStructurePanel({g}:{g:ReturnTypeRepublic}){
 const {game,me,teacher,setError}=g;
 const [row,setRow]=useState<Structure|null>(null);
 const [titles,setTitles]=useState(defaults);
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const role=(me?.role_title||'').toLowerCase();
 const isPM=role.includes('председател')&&role.includes('правительств');
 const isPresident=role.includes('президент');

 async function load(){
  if(!game)return;
  const r=await supabase.from('government_structures').select('*').eq('game_id',game.id).maybeSingle();
  if(!r.error){
   const x=r.data as Structure|null;setRow(x);
   if(x)setTitles({social:x.social_title,economic:x.economic_title,defence:x.defence_title,foreign:x.foreign_title,internal:x.internal_title});
  }
 }
 useEffect(()=>{void load()},[game?.id]);
 useEffect(()=>{
  if(!game)return;
  const ch=supabase.channel('government-structure:'+game.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'government_structures',filter:'game_id=eq.'+game.id},()=>void load())
   .subscribe();
  return()=>{void supabase.removeChannel(ch)}
 },[game?.id]);

 if(!game||!me)return null;
 const canEdit=teacher||isPM;
 const canReview=teacher||isPresident;
 const editable=!row||row.status==='draft'||row.status==='revision';

 async function save(submit:boolean){
  setBusy(true);const r=await supabase.rpc('save_government_structure',{
   p_game_id:game.id,p_social_title:titles.social,p_economic_title:titles.economic,p_defence_title:titles.defence,
   p_foreign_title:titles.foreign,p_internal_title:titles.internal,p_submit:submit
  });
  if(r.error)setError(r.error.message);else await load();setBusy(false);
 }
 async function review(action:'approve'|'revision'){
  setBusy(true);const r=await supabase.rpc('review_government_structure',{p_game_id:game.id,p_action:action,p_note:note.trim()||null});
  if(r.error)setError(r.error.message);else{setNote('');await load()}setBusy(false);
 }

 return <section className="governmentStructure">
  <header><div><small>СТРУКТУРА ФОИВ · ЭТАП 8</small><h3>Пять министерств: функции фиксированы, названия можно уточнить</h3><p>Председатель Правительства предлагает структуру после назначения. По правилам игры увеличить число министерств нельзя; Президент может одобрить структуру либо вернуть её для переименования.</p></div><span className={row?.status||'draft'}>{row?.status==='approved'?'Одобрено':row?.status==='submitted'?'На рассмотрении':row?.status==='revision'?'На доработке':'Черновик'}</span></header>

  <div className="governmentStructureGrid">
   {([
    ['social','Социальная политика'],['economic','Экономическая политика'],['defence','Оборона и внутренняя безопасность'],
    ['foreign','Внешняя политика'],['internal','Внутренняя политика и государство']
   ] as const).map(([key,label])=><label key={key}><small>{label}</small><input disabled={!canEdit||!editable} value={titles[key]} onChange={e=>setTitles(v=>({...v,[key]:e.target.value}))}/></label>)}
  </div>
  {row?.note&&<div className="governmentStructureNote"><b>Замечание Президента</b><p>{row.note}</p></div>}
  {canEdit&&editable&&<div className="governmentStructureActions"><button className="secondary" disabled={busy} onClick={()=>void save(false)}>Сохранить черновик</button><button className="primary" disabled={busy} onClick={()=>void save(true)}>Представить Президенту</button></div>}
  {canReview&&row?.status==='submitted'&&<div className="governmentStructureReview"><textarea rows={2} value={note} onChange={e=>setNote(e.target.value)} placeholder="Комментарий к структуре / названиям"/><button className="secondary" disabled={busy} onClick={()=>void review('revision')}>Вернуть на переименование</button><button className="primary" disabled={busy} onClick={()=>void review('approve')}>Одобрить структуру</button></div>}
 </section>;
}
