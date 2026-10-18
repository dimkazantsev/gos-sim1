'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import {useGameTableSync} from './useGameTableSync';
import type {ReturnTypeRepublic} from './viewTypes';
import InstitutionEmblemImage from './InstitutionEmblemImage';
import {institutionEmblem} from './institutionEmblems';
type Props={g:ReturnTypeRepublic;status:string|undefined;onSaved:()=>Promise<void>};
export default function PresidentialCecPublicationPanel({g,status,onSaved}:Props){
 const gameId=g.game?.id||'';
 const [turnout,setTurnout]=useState(''),[voters,setVoters]=useState(''),[violations,setViolations]=useState<'no'|'yes'|''>(''),
 [note,setNote]=useState(''),[preview,setPreview]=useState(''),[postId,setPostId]=useState<string|null>(null),
 [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const scope=useRef(gameId);scope.current=gameId;
 useEffect(()=>{setTurnout('');setVoters('');setViolations('');setNote('');setPreview('');setPostId(null);setNotice('')},[gameId]);
 async function loadPublished(){
  if(!gameId)return;
  const result=await supabase.from('political_posts').select('id').eq('game_id',gameId).eq('source_key','cec-presidential-results:'+gameId).maybeSingle();
  if(!result.error&&scope.current===gameId)setPostId(result.data?.id||null);
 }
 useGameTableSync(gameId,['political_posts','presidential_election_settings'],loadPublished,'cec-publication|'+gameId);
 async function showPreview(){
  if(!g.teacher||!gameId||busy)return;
  setBusy(true);
  const r=await supabase.rpc('preview_presidential_cec_protocol',{p_game_id:gameId,
   p_turnout_pct:turnout.trim()?Number(turnout):null,p_voter_count:voters.trim()?Number(voters):null,
   p_major_violations:violations?violations==='yes':null,p_note:note.trim()||null});
  if(r.error)g.setError(userError(r.error));else{setPreview(r.data||'');setNotice('Текст протокола сформирован из подтверждённых результатов ЦИК.')}
  setBusy(false);
 }
 async function publish(){
  if(!g.teacher||!gameId||busy||!valid||!preview)return;
  setBusy(true);
  const r=await supabase.rpc('publish_presidential_cec_protocol',{p_game_id:gameId,
   p_turnout_pct:Number(turnout),p_voter_count:Number(voters),
   p_major_violations:violations==='yes',p_note:note.trim()||null});
  if(r.error)g.setError(userError(r.error));else{setPostId(r.data||null);setNotice('Итоги опубликованы от имени ЦИК. Победитель вступит в должность после подтверждённой инаугурации.');await onSaved();await g.refresh()}
  setBusy(false);
 }
 const valid=turnout.trim()!==''&&Number.isFinite(Number(turnout))&&Number(turnout)>=0&&Number(turnout)<=100
  &&voters.trim()!==''&&Number.isInteger(Number(voters))&&Number(voters)>0&&!!violations;
 if(!g.teacher)return null;
 return <section className="stage7Panel" aria-label="Официальный протокол Центральной избирательной комиссии">
  <div className="stage7PanelHead"><div><small>ЦЕНТРАЛЬНАЯ ИЗБИРАТЕЛЬНАЯ КОМИССИЯ</small><h3>Официальный протокол и публикация результатов</h3>
   <p>Данные автоматически берутся из калькулятора: отдельные голоса преподавателей за программы и агитацию, рейтинги, утверждённый соцопрос, штрафы, второй тур и победитель. Изменяйте исходные значения в калькуляторе выше; итоговые цифры в протоколе защищены от ручной подмены.</p>
  </div><InstitutionEmblemImage src={institutionEmblem('cec','ЦИК РФ')} alt="ЦИК РФ" width={56} height={56}/></div>
  {postId?<div className="stage7Notice"><b>Итоги опубликованы в политическом процессе.</b> Победитель объявлен. Полномочия Президента предоставляются после инаугурации; повторная публикация заблокирована.</div>:
   status!=='finished'?<div className="stage7Notice">Протокол станет доступен после завершения подсчёта ЦИК. Для первого тура используйте полную формулу, для второго — отдельную формулу повторного голосования.</div>:
   <>
    <div className="stage7Grid">
     <label>Явка избирателей, %<input type="number" min="0" max="100" step="0.01" value={turnout} disabled={busy} onChange={e=>{setTurnout(e.target.value);setPreview('')}} placeholder="Фактическая явка"/></label>
     <label>Число проголосовавших<input type="number" min="1" step="1" value={voters} disabled={busy} onChange={e=>{setVoters(e.target.value);setPreview('')}} placeholder="Фактическое число"/></label>
     <label>Нарушения, влияющие на результаты<select value={violations} disabled={busy} onChange={e=>{setViolations(e.target.value as 'no'|'yes'|'');setPreview('')}}><option value="">Выберите по данным ЦИК</option><option value="no">Не зарегистрированы</option><option value="yes">Зарегистрированы</option></select></label>
    </div>
    <label>Дополнительное официальное разъяснение ЦИК<textarea rows={4} maxLength={4000} value={note} disabled={busy} onChange={e=>{setNote(e.target.value);setPreview('')}} placeholder="Фактические обстоятельства, порядок инаугурации и иные сведения"/></label>
    <div className="stage7Notice">Формула фиксирована правилами выборов: (Голоса ППС за программы + Голоса ППС за агитацию + Игровой рейтинг{g.game?' + Социологический опрос (если утверждён)':''}) / число участвующих компонентов. Все проценты можно уточнить через исходные голоса, рейтинг и опрос до фиксации итогов.</div>
    <div className="campaignSubmit"><button className="secondary" disabled={busy||!valid} onClick={()=>void showPreview()}>Сформировать протокол для проверки</button><button className="primary" disabled={busy||!valid||!preview} onClick={()=>void publish()}>Опубликовать от имени ЦИК и назначить Президента</button></div>
    {preview&&<div className="cecDecisionSheet"><h4>Предпросмотр официального сообщения</h4><pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',overflowWrap:'anywhere'}}>{preview}</pre></div>}
   </>
  }
  {notice&&<p className="stage7Notice" role="status">{notice}</p>}
 </section>;
}
