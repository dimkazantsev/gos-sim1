'use client';
import {useRef,useState} from 'react';
import {FileText,Minus,Plus} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {userError} from '@/lib/userError';
import type {ReturnTypeRepublic} from './viewTypes';

/** Isolated editor: the authoritative rate and all rights are validated by one RPC.
 * In teacher student-preview the form works locally, but no write is possible. */
export default function CutoffPriceProposalEditor({
 g,price,readOnly,onClose,onOpenDocument
}:{
 g:ReturnTypeRepublic;price:number;readOnly:boolean;
 onClose:()=>void;onOpenDocument:(documentId:string)=>void
}){
 const [draft,setDraft]=useState(String(price));
 const [reason,setReason]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const saving=useRef(false),requestId=useRef('');
 const chair=g.me?.kind==='student'&&g.me.roster_archived_at==null&&
  g.officeAssignments.some(o=>o.game_id===g.game?.id&&o.user_id===g.me?.user_id&&
   o.status==='active'&&o.role_title==='Министерство по экономической политике');
 const canSubmit=!!chair&&!readOnly;
 function adjust(delta:number){
  setError('');
  setDraft(current=>String(Math.max(0,Math.min(100000,
   Math.round((Number(current||price)+delta)*100)/100))));
 }
 async function submit(){
  if(!g.game||!canSubmit||saving.current)return;
  const next=Number(draft),basis=reason.trim();
  if(!draft.trim()||!Number.isFinite(next)||next<0||next>100000||
   Math.abs(next*100-Math.round(next*100))>0.000001){
   setError('Укажите цену от 0 до 100 000 долларов с точностью до сотых.');return;
  }
  if(next===price){setError('Укажите цену, отличающуюся от действующей.');return;}
  if(basis.length<8||basis.length>1500){
   setError('Обоснование должно содержать от 8 до 1500 символов.');return;
  }
  if(!requestId.current)requestId.current=crypto.randomUUID();
  const abort=new AbortController();
  const timer=window.setTimeout(()=>abort.abort(),18000);
  saving.current=true;setBusy(true);setError('');
  try{
   const {data,error:rpcError}=await supabase.rpc('propose_cutoff_price_bill',{
    p_game_id:g.game.id,p_new_price:next,p_expected_price:price,
    p_reason:basis,p_request_id:requestId.current
   }).abortSignal(abort.signal);
   if(abort.signal.aborted){
    setError('Результат запроса неизвестен. Проверьте реестр НПА перед повторной отправкой.');return;
   }
   if(rpcError){setError(userError(rpcError));return;}
   const id=String((data as {document_id?:string}|null)?.document_id||'');
   if(!id){setError('Сервер не вернул номер законопроекта. Проверьте реестр НПА.');return;}
   try{await g.refreshDocuments(id);}catch{/* Document is already saved; navigation remains available. */}
   onClose();
   onOpenDocument(id);
  }catch(e){
   setError(abort.signal.aborted?
    'Результат запроса неизвестен. Проверьте реестр НПА перед повтором.':userError(e));
  }finally{window.clearTimeout(timer);saving.current=false;setBusy(false);}
 }
 return <div id="fiscal-cutoff-proposal" className="fiscalMacroBankDecision"
   role="group" aria-label="Законопроект об изменении цены отсечения">
  <div className="fiscalMacroBankDecisionHeading">
   <FileText size={21} aria-hidden="true"/>
   <div><strong>Изменение цены отсечения</strong>
    <p>Министерство по экономической политике готовит проект федерального закона. Действующая цена не изменится до одобрения Правительством, рассмотрения в Государственной Думе и Совете Федерации, подписания Президентом и опубликования.</p>
   </div>
  </div>
  {readOnly&&<p className="budgetNotice" role="status">
   Просмотр студента преподавателем: значения можно менять для проверки интерфейса, но создать законопроект или подписать документ за студента нельзя.
  </p>}
  <label className="fiscalMacroBankRateLabel">Предлагаемая базовая цена нефти, долларов за баррель
   <span className="fiscalMacroBankRateControl">
    <button type="button" className="secondary" aria-label="Понизить цену отсечения на один доллар"
     disabled={busy||Number(draft)<=0} onClick={()=>adjust(-1)}><Minus size={17}/></button>
    <input type="number" min={0} max={100000} step="0.01"
     aria-label="Предлагаемая цена отсечения" value={draft} disabled={busy}
     onChange={e=>{setDraft(e.target.value);setError('')}}/>
    <button type="button" className="secondary" aria-label="Повысить цену отсечения на один доллар"
     disabled={busy||Number(draft)>=100000} onClick={()=>adjust(1)}><Plus size={17}/></button>
   </span>
  </label>
  <label className="fiscalMacroBankReason">Обоснование законодательной инициативы
   <textarea rows={3} maxLength={1500} value={reason} disabled={busy}
    onChange={e=>{setReason(e.target.value);setError('')}}
    placeholder="Причины изменения бюджетного правила и последствия для нефтегазовых доходов и ФНБ"/>
  </label>
  <p>После подготовки откроется реестр НПА. Перед передачей Правительству необходимо оформить обязательный комплект законопроекта. Затем он проходит предусмотренные законодательные процедуры.</p>
  <div className="fiscalMacroBankActions">
   <button type="button" className="secondary" onClick={onClose} disabled={busy}>Отмена</button>
   <button type="button" className="primary" disabled={busy||!canSubmit}
    onClick={()=>void submit()}><FileText size={17} aria-hidden="true"/>
    {readOnly?'Создание недоступно при просмотре':busy?'Подготавливается…':'Подготовить проект ФЗ и открыть НПА'}
   </button>
  </div>
  {error&&<p role="alert" className="error">{error}</p>}
 </div>;
}
