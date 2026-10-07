'use client';
import {useEffect,useState} from 'react';
import {useParams} from 'next/navigation';
import {supabase} from '@/lib/supabase';
import InstitutionEmblemImage from '@/components/game/InstitutionEmblemImage';
import {institutionEmblem} from '@/components/game/institutionEmblems';

type PollCandidate={id:string;name:string;photo_path:string|null;photo_url?:string};
type PollData={id:string;slug:string;title:string;status:'open'|'closed'|'draft';round_no:number;closes_at:string|null;candidates:PollCandidate[]};

export default function PublicPresidentialPoll(){
 const params=useParams<{slug:string}>(),slug=String(params?.slug||'');
 const [poll,setPoll]=useState<PollData|null>(null);
 const [selected,setSelected]=useState('');
 const [loading,setLoading]=useState(true);
 const [sent,setSent]=useState(false);
 const [error,setError]=useState('');
 async function load(){
  if(!slug)return;setLoading(true);setError('');
  const r=await supabase.rpc('get_public_presidential_poll',{p_slug:slug});
  if(r.error){setError(r.error.message);setLoading(false);return}
  const data=r.data as PollData|null;
  if(data){
   const candidates=await Promise.all((data.candidates||[]).map(async c=>{
    if(!c.photo_path)return c;
    const s=await supabase.storage.from('game-assets').createSignedUrl(c.photo_path,3600);
    return {...c,photo_url:s.data?.signedUrl||undefined};
   }));
   setPoll({...data,candidates});
  }else setPoll(null);
  setLoading(false);
 }
 useEffect(()=>{void load()},[slug]);
 async function vote(){
  if(!poll||!selected)return;
  let token=localStorage.getItem('gos-sims-public-voter');
  if(!token){token=crypto.randomUUID()+crypto.randomUUID();localStorage.setItem('gos-sims-public-voter',token)}
  const r=await supabase.rpc('cast_public_presidential_poll',{p_slug:slug,p_candidate_id:selected,p_voter_token:token});
  if(r.error){setError(r.error.message);return}
  setSent(true);
 }
 return <main className="publicElectionPoll"><div className="publicPollShell">
  <header className="publicPollHead"><InstitutionEmblemImage src={institutionEmblem('cec','ЦИК РФ')} alt="ЦИК РФ" width={64} height={64}/><div><small>GOS//SIMS · ЦИК РФ · УЧЕБНАЯ МОДЕЛЬ</small><h1>{poll?.title||'Социологический опрос'}</h1><p>{poll?.closes_at?'Голосование доступно до '+new Date(poll.closes_at).toLocaleString('ru-RU'):'Выборы Президента Российской Федерации'}</p></div></header>
  {loading&&<div className="publicPollState"><b>Загрузка опроса…</b></div>}
  {!loading&&!poll&&<div className="publicPollState"><b>Опрос не найден</b><p>Проверьте ссылку.</p></div>}
  {poll&&poll.status!=='open'&&<div className="publicPollState"><b>Опрос завершён</b><p>Приём ответов закрыт.</p></div>}
  {poll&&poll.status==='open'&&!sent&&<><section className="publicPollBallot">{poll.candidates.map(c=><button key={c.id} className={'publicPollCandidate '+(selected===c.id?'selected':'')} onClick={()=>setSelected(c.id)}>{c.photo_url?<img src={c.photo_url} alt=""/>:<span className="fallback">{c.name.slice(0,1)}</span>}<b>{c.name}</b><i aria-hidden="true"/></button>)}</section><button className="publicPollSubmit" disabled={!selected} onClick={()=>void vote()}>Проголосовать</button></>}
  {sent&&<div className="publicPollState"><b>Голос учтён</b><p>До закрытия опроса выбор можно изменить.</p><button className="publicPollSubmit" onClick={()=>setSent(false)}>Изменить выбор</button></div>}
  {error&&<div className="errorBox">{error}</div>}
 </div></main>;
}
