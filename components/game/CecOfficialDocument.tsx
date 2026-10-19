'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import InstitutionEmblemImage from './InstitutionEmblemImage';
import {institutionEmblem} from './institutionEmblems';
import {cecOfficialResolution,type CecDecisionStatus} from './cecOfficialWording';
import {cecRegistrationDirective} from './cecNameDeclension';

type Candidate={
 display_name:string;registration_number:string|null;
 registration_decision_no:string|null;registration_decision_at:string|null;
 registration_public_summary:string|null;party_id:string|null;
};
type ManualRemark={title:string;note:string;status:string};
type Decision={
 id:string;decision_type:CecDecisionStatus;decision_number:string;
 public_summary:string;created_at:string;created_by:string;
 reasoning?:{manual_remarks?:ManualRemark[];chair_signature_path?:string|null;chair_name?:string|null}|null;
};
export default function CecOfficialDocument({
 kind,candidate,decision,gameId,chairUserId,signerName,signatureFallbackUrl,onClose
}:{
 kind:'decision'|'credential';candidate:Candidate;decision?:Decision;
 gameId:string;chairUserId:string|null;signerName?:string|null;signatureFallbackUrl?:string|null;onClose:()=>void;
}){
 const [signedUrl,setSignedUrl]=useState<string|null>(null);
 const [loadingSignature,setLoadingSignature]=useState(true);
 const [imageLoaded,setImageLoaded]=useState(false);
 const fixedPath=decision?.reasoning?.chair_signature_path;
 useEffect(()=>{
  let alive=true;
  setSignedUrl(null);setImageLoaded(false);setLoadingSignature(true);
  async function loadChairSignature(){
   // Always resolve the elected CEC chair from his own game profile.
   // The NKO/Minjust certificate does not provide or authorize this signature.
   let currentPath:string|null=null;
   if(chairUserId&&gameId){
    const {data,error}=await supabase.from('game_profiles').select('signature_path')
     .eq('game_id',gameId).eq('user_id',chairUserId).maybeSingle();
    if(!error)currentPath=data?.signature_path||null;
   }
   const path=kind==='decision'&&fixedPath?fixedPath:(currentPath||fixedPath||null);
   if(path){
    const {data,error}=await supabase.storage.from('game-assets').createSignedUrl(path,3600);
    if(alive&&!error&&data?.signedUrl)setSignedUrl(data.signedUrl);
   }
   if(alive)setLoadingSignature(false);
  }
  void loadChairSignature();
  return()=>{alive=false};
 },[chairUserId,gameId,kind,fixedPath]);
 // A fallback URL from the current CEC chair's profile is safe only for that same user.
 const signature=signedUrl||(!loadingSignature?signatureFallbackUrl:null);
 const signatory=signerName||decision?.reasoning?.chair_name||'Председатель ЦИК РФ';
 const remarks=(decision?.reasoning?.manual_remarks||[]).filter(item=>item.note&&item.note.trim());
 const status=decision?.decision_type||'registered';
 const resolution=status==='registered'?cecRegistrationDirective(candidate.display_name):
  cecOfficialResolution(status,candidate.display_name,decision?.public_summary||candidate.registration_public_summary);
 const signatureElement=<div className="cecChairSignature">
  <span className="cecChairSignatureTitle">Председатель Центральной избирательной комиссии Российской Федерации</span>
  <span className="cecChairSignatureMark">
   {signature?<img src={signature} alt={'Подпись председателя ЦИК РФ — '+signatory}
    onLoad={()=>setImageLoaded(true)} onError={()=>{setImageLoaded(false);setSignedUrl(null)}}/>:
    <span>{loadingSignature?'Подпись загружается':'Подпись председателя ЦИК недоступна'}</span>}
  </span>
  <strong>{signatory}</strong>
 </div>;
 return <div className="cecDocumentModal" role="dialog" aria-modal="true"
  aria-label={kind==='decision'?'Решение ЦИК':'Удостоверение кандидата'}>
  <div className="cecDocumentBackdrop" onClick={onClose}/>
  <div className="cecDocumentShell">
   <div className="cecDocumentTools"><b>{kind==='decision'?'Решение ЦИК РФ':'Удостоверение кандидата'}</b><span/>
    <button type="button" disabled={loadingSignature||!signature||!imageLoaded}
     title={!signature?'Подпись председателя должна быть загружена до печати':undefined}
     onClick={()=>window.print()}>Печать / PDF</button>
    <button type="button" onClick={onClose}>Закрыть</button>
   </div>
   {kind==='decision'?<article className="cecPrintableDocument cecDecisionSheet">
    <header><InstitutionEmblemImage src={institutionEmblem('cec','ЦИК РФ')} alt="Эмблема ЦИК РФ" width={64} height={64}/>
     <div><b>ЦЕНТРАЛЬНАЯ ИЗБИРАТЕЛЬНАЯ КОМИССИЯ
РОССИЙСКОЙ ФЕДЕРАЦИИ</b></div>
    </header>
    <div className="cecDecisionMeta"><span>Решение № <b>{decision?.decision_number||candidate.registration_decision_no||'—'}</b></span>
     <span>{decision?.created_at||candidate.registration_decision_at?
      new Date(decision?.created_at||candidate.registration_decision_at||'').toLocaleDateString('ru-RU'):'Дата не указана'}</span>
    </div>
    <h3>{status==='registered'?'О регистрации кандидата':status==='rejected'?'Об отказе в регистрации кандидата':
     status==='withdrawn'?'О снятии кандидата с выборов':'О возврате документов на доработку'}</h3>
    <p>Центральная избирательная комиссия Российской Федерации рассмотрела документы,
     представленные кандидатом <b>{candidate.display_name}</b>
     {candidate.party_id?' и выдвинувшей его политической партией':''},
     в соответствии с Федеральным законом № 19-ФЗ «О выборах Президента Российской Федерации».</p>
    {remarks.length>0&&status!=='registered'&&<section className="cecDecisionReasoning">
     <h4>Замечания Центральной избирательной комиссии Российской Федерации</h4>
     <ol>{remarks.map((item,index)=><li key={index}><b>{item.title}</b>
       <span>{item.status==='revision'?'Требует доработки.':item.status==='rejected'?'Не соответствует.':'Замечание ЦИК.'}</span>
       <p>{item.note}</p></li>)}</ol>
    </section>}
    <div className="cecResolution"><small>ПОСТАНОВЛЯЕТ:</small><strong>{resolution}</strong></div>
    <footer>{signatureElement}</footer>
   </article>:<article className="cecPrintableDocument cecCredentialSheet">
    <div className="cecCredentialCover">
     <InstitutionEmblemImage src={institutionEmblem('cec','ЦИК РФ')} alt="Эмблема ЦИК РФ" width={58} height={58}/>
     <b>РОССИЙСКАЯ
ФЕДЕРАЦИЯ</b><small>УДОСТОВЕРЕНИЕ КАНДИДАТА</small>
    </div>
    <div className="cecCredentialInside">
     <section>
      <InstitutionEmblemImage src={institutionEmblem('cec','ЦИК РФ')} alt="Эмблема ЦИК РФ" width={44} height={44}/>
      <b>Центральная избирательная комиссия Российской Федерации</b>
      <strong>УДОСТОВЕРЕНИЕ КАНДИДАТА</strong><span>{candidate.registration_number||'—'}</span>
      <small>г. Москва · {candidate.registration_decision_at?
       new Date(candidate.registration_decision_at).toLocaleDateString('ru-RU'):'Дата регистрации не указана'}</small>
     </section>
     <section><small>Выборы Президента Российской Федерации</small>
      <h3>{candidate.display_name}</h3>
      <p>Зарегистрирован кандидатом на должность Президента Российской Федерации.</p>
      <b>{candidate.registration_decision_at?new Date(candidate.registration_decision_at).toLocaleDateString('ru-RU'):'—'}</b>
      <footer>{signatureElement}</footer>
     </section>
    </div>
   </article>}
  </div>
 </div>;
}
