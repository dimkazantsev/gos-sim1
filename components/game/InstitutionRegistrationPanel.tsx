'use client';
import {useEffect,useState} from 'react';
import {CheckCircle2,Landmark,UsersRound} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import type {ReturnTypeRepublic} from './viewTypes';
const INSTITUTIONS=[
 {key:'gd',title:'Государственная Дума',hint:'Депутаты и участники, представляющие думские фракции.'},
 {key:'government',title:'Правительство',hint:'Министры и члены Правительства, назначенные в игре.'},
 {key:'municipality',title:'Муниципальный орган',hint:'Главы муниципалитетов и сотрудники местного самоуправления.'}
] as const;
type Entry={game_id:string;stage_no:number;institution_key:string;user_id:string;registered_at:string};
export default function InstitutionRegistrationPanel({g,readOnly=false}:{g:ReturnTypeRepublic;readOnly?:boolean}){
 const {game,me,members,partyMandates,parties,setError}=g;
 const [rows,setRows]=useState<Entry[]>([]);
 const [busy,setBusy]=useState('');
 const [notice,setNotice]=useState('');
 const stage=game?.current_round||1;
 const uid=me?.user_id;
 const load=async()=>{
  if(!game)return;
  const r=await supabase.from('institution_session_registrations').select('*').eq('game_id',game.id).eq('stage_no',stage);
  if(!r.error)setRows((r.data||[]) as Entry[]);
 };
 useEffect(()=>{
  if(!game||!uid)return;
  void load();
  const channel=supabase.channel('session-checkin:'+game.id)
   .on('postgres_changes',{schema:'public',table:'institution_session_registrations',event:'*',filter:'game_id=eq.'+game.id},()=>void load()).subscribe();
  return()=>{void supabase.removeChannel(channel)};
 },[game?.id,stage,uid]);
 if(!game||!me)return null;
 const myRole=(me.role_title||'').toLowerCase();
 const eligible=(key:string)=>key==='gd'?(myRole.includes('депутат')||myRole.includes('государственн')&&myRole.includes('дум'))
  :key==='government'?(myRole.includes('министр')||myRole.includes('правительств'))
  :(myRole.includes('муницип')||myRole.includes('администрац')||myRole.includes('глава города'));
 async function register(key:string){
  if(!game||!me)return;
  setBusy(key);setNotice('');
  const r=await supabase.rpc('register_institution_session',{p_game_id:game.id,p_institution:key});
  if(r.error)setError(r.error.message);
  else{await load();setNotice('Регистрация на заседание подтверждена.')}
  setBusy('');
 }
 return <section className="institutionRegistrationPanel" aria-label="Регистрация на заседания">
  <header><div><small>ПРИСУТСТВИЕ · ЭТАП {stage}</small><h2>Регистрация на заседания</h2>
   <p>Студент отмечает присутствие только в органе, которому соответствует его игровая роль. Голоса фракций в Думе учитывают назначенные мандаты и потери Ghost Voting.</p>
  </div><Landmark size={24} aria-hidden="true"/></header>
  <div className="institutionRegistrationGrid">{INSTITUTIONS.map(item=>{
   const membersHere=rows.filter(r=>r.institution_key===item.key);
   const mine=membersHere.some(r=>r.user_id===uid);
   const assigned=members.filter(m=>m.kind==='student'&&(item.key==='gd'?/депутат|государственн.*дум/i:item.key==='government'?/министр|правительств/i:/муницип|администрац|глава города/i).test(m.role_title||''));
   const registeredWeight=item.key==='gd'?membersHere.reduce((n,r)=>n+(partyMandates.find(a=>a.user_id===r.user_id)?.effective_mandates||0),0):membersHere.length;
   return <article key={item.key}><h3>{item.title}</h3><p>{item.hint}</p>
    <div className="institutionRegistrationStats"><span><UsersRound size={16}/> {membersHere.length}/{assigned.length} участников</span>
    {item.key==='gd'&&<span>{registeredWeight}/{parties.reduce((n,p)=>n+Math.max(0,p.mandates-p.ghost_loss_current),0)} доступных мандатов</span>}</div>
    <div className="institutionRegistrationPeople">{membersHere.map(r=><span key={r.user_id}><CheckCircle2 size={13}/>{members.find(m=>m.user_id===r.user_id)?.full_name||'Участник'}</span>)}</div>
    <button type="button" disabled={mine||!eligible(item.key)||busy!==''||readOnly}
     onClick={()=>void register(item.key)}>{mine?'Вы зарегистрированы':busy===item.key?'Регистрация…':eligible(item.key)?'Зарегистрироваться':'Нет полномочий для регистрации'}</button>
   </article>;
  })}</div>
  {notice&&<p className="institutionRegistrationNotice" role="status">{notice}</p>}
 </section>;
}
