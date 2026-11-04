'use client';
/**
 * Six generic, locally rendered editorial motifs, reused by all published
 * story posts. No files, image requests, timers, dependencies, or unpublished
 * episode names/plot in the public repository.
 */
export default function StoryNewsIllustration({episodeNo}:{episodeNo:number}){
 const variant=Number.isFinite(episodeNo)?Math.abs(Math.trunc(episodeNo))%6:0;
 const ink='var(--gs-ink,#172447)';
 const accent='var(--gs-accent,#2453e6)';
 // First three scenes have explicit editorial artwork rather than generic motifs.
 // The visuals are diagrams, NOT reconstructions of unpublished source documents.
 if(episodeNo>=1&&episodeNo<=3){
  const caption=episodeNo===1
   ?'Сюжетная схема: предварительное письмо Д-01 и идея выставки. Это не изображение подлинного документа.'
   :episodeNo===2
   ?'Сюжетная схема: семь разных интересов вокруг одного предложения. Персонажи не заменяют государственные органы.'
   :'Сюжетная схема: предварительное письмо Д-01 и рабочая презентация Д-02 имеют разный статус.';
  return <figure className="storyNewsIllustration" style={{
   margin:'12px 0 16px',padding:0,overflow:'hidden',
   borderRadius:14,border:'1px solid var(--gs-border,#dce3f0)',
   background:'var(--gs-accent-soft,#edf1ff)'}}>
   <svg viewBox="0 0 760 236" width="100%" style={{display:'block',height:'auto',width:'100%'}}
    role="presentation" aria-hidden="true" focusable="false">
    <rect width="760" height="236" fill="var(--gs-accent-soft,#edf1ff)"/>
    <path d="M0 205H760 M0 165H760 M0 125H760 M0 85H760" stroke={accent} strokeOpacity=".06"/>
    {episodeNo===1&&<>
     <rect x="65" y="28" width="247" height="182" rx="15" fill="white" fillOpacity=".87" stroke={ink} strokeOpacity=".39" strokeWidth="1.6"/>
     <text x="89" y="65" fontSize="18" fontWeight="700" fill={ink}>ПИСЬМО Д-01</text>
     <path d="M88 84H271 M88 103H257 M88 122H276 M88 141H225" stroke={accent} strokeWidth="4" strokeLinecap="round" opacity=".32"/>
     <circle cx="268" cy="179" r="13" fill={accent} fillOpacity=".13" stroke={accent} strokeWidth="2"/>
     <path d="M327 119H411" fill="none" stroke={accent} strokeWidth="3" strokeDasharray="6 8"/>
     <path d="M396 108L414 119L396 130" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
     <rect x="432" y="28" width="264" height="182" rx="15" fill="white" fillOpacity=".68" stroke={accent} strokeOpacity=".35" strokeWidth="1.6"/>
     <text x="454" y="64" fontSize="18" fontWeight="700" fill={ink}>ИДЕЯ ВЫСТАВКИ</text>
     <path d="M471 153V102L566 78L661 102V153 M476 153H655" fill="none" stroke={ink} strokeWidth="2.6" strokeLinejoin="round" opacity=".58"/>
     <path d="M495 153V105 M531 153V94 M566 153V85 M601 153V94 M638 153V105" fill="none" stroke={accent} strokeWidth="5" opacity=".19"/>
     <text x="451" y="185" fontSize="15" fontWeight="700" fill={accent}>РЕШЕНИЕ НЕ ПРИНЯТО</text>
    </>}
    {episodeNo===2&&<>
     <text x="70" y="57" fontSize="22" fontWeight="700" fill={ink}>СЕМЬ ТОЧЕК ЗРЕНИЯ</text>
     <text x="70" y="85" fontSize="15" fill={accent}>Один проект — разные интересы</text>
     {[102,194,286,378,470,562,654].map((x,i)=><g key={x}>
      <circle cx={x} cy={146} r="29" fill="white" fillOpacity=".83" stroke={accent} strokeOpacity=".34" strokeWidth="2"/>
      <circle cx={x} cy={140} r="9" fill={accent} fillOpacity=".28"/>
      <path d={'M'+(x-15)+' 164Q'+x+' 148 '+(x+15)+' 164'} fill="none" stroke={ink} strokeOpacity=".47" strokeWidth="3" strokeLinecap="round"/>
      <text x={x} y="203" fontSize="14" textAnchor="middle" fontWeight="600" fill={ink}>{i+1}</text>
     </g>)}
    </>}
    {episodeNo===3&&<>
     <rect x="63" y="27" width="265" height="177" rx="15" fill="white" fillOpacity=".84" stroke={ink} strokeOpacity=".4" strokeWidth="2"/>
     <text x="89" y="66" fontSize="22" fontWeight="700" fill={ink}>Д-01</text>
     <text x="89" y="92" fontSize="16" fill={accent}>Предварительное письмо</text>
     <path d="M89 120H299 M89 138H274 M89 156H287" stroke={accent} strokeWidth="3.6" opacity=".31" strokeLinecap="round"/>
     <path d="M377 96L394 116L411 96 M377 138L394 116L411 138" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round"/>
     <rect x="460" y="27" width="249" height="177" rx="15" fill="white" fillOpacity=".74" stroke={accent} strokeOpacity=".5" strokeWidth="2"/>
     <text x="485" y="66" fontSize="22" fontWeight="700" fill={ink}>Д-02</text>
     <text x="485" y="92" fontSize="16" fill={accent}>Рабочая презентация</text>
     <path d="M486 120H682 M486 138H664 M486 156H673" stroke={accent} strokeWidth="3.6" opacity=".31" strokeLinecap="round"/>
    </>}
   </svg>
   <figcaption style={{padding:'10px 14px',fontSize:12,lineHeight:1.5,
    color:'var(--gs-text-muted,#607995)',background:'var(--gs-surface,#fff)'}}>
    {caption}
   </figcaption>
  </figure>;
 }

 return <div className="storyNewsIllustration" aria-hidden="true"
  style={{overflow:'hidden',borderRadius:14,border:'1px solid var(--gs-border,#dce3f0)',
   background:'var(--gs-accent-soft,#edf1ff)',margin:'12px 0 16px'}}>
  <svg viewBox="0 0 760 120" width="100%" height="120" preserveAspectRatio="xMidYMid slice"
   style={{display:'block',maxHeight:120}} focusable="false" aria-hidden="true">
   <rect x="0" y="0" width="760" height="120" fill="var(--gs-accent-soft,#edf1ff)"/>
   <path d="M0 101H760 M0 82H760 M0 63H760 M0 44H760" stroke={accent} opacity=".09"/>
   <path d="M90 0V120 M210 0V120 M330 0V120 M450 0V120 M570 0V120 M690 0V120"
    stroke={accent} opacity=".09"/>
   {variant===0&&<>
    <path d="M105 97V36L194 18L283 36V97 M116 97H274 M130 43H258" fill="none" stroke={ink} strokeWidth="2.3" strokeLinejoin="round" opacity=".72"/>
    <path d="M132 96V49 M162 96V49 M194 96V49 M226 96V49 M256 96V49" stroke={accent} strokeWidth="7" opacity=".2"/>
    <path d="M352 98H660 M352 80H624 M352 62H582 M352 44H642" stroke={accent} strokeWidth="2.5" strokeLinecap="round" opacity=".47"/>
    <circle cx="640" cy="20" r="7" fill={accent} opacity=".32"/>
   </>}
   {variant===1&&<>
    <circle cx="196" cy="60" r="47" fill="none" stroke={accent} strokeWidth="2" opacity=".54"/>
    <circle cx="196" cy="60" r="21" fill={accent} opacity=".19"/>
    <path d="M104 88L158 48L196 60L250 28L296 58L354 28L408 67" fill="none" stroke={ink} strokeWidth="2.5" strokeLinejoin="round" opacity=".65"/>
    {[104,158,196,250,296,354,408].map((x,i)=><circle key={x} cx={x} cy={[88,48,60,28,58,28,67][i]} r="5" fill={accent}/>)}
    <path d="M482 85H687 M482 64H657 M482 43H619" stroke={accent} strokeWidth="3" opacity=".34" strokeLinecap="round"/>
   </>}
   {variant===2&&<>
    <rect x="121" y="23" width="164" height="74" rx="10" fill="white" fillOpacity=".63" stroke={accent} strokeWidth="1.7" opacity=".9"/>
    <path d="M145 42H247 M145 56H264 M145 70H230" stroke={ink} strokeWidth="2.7" opacity=".45" strokeLinecap="round"/>
    <circle cx="262" cy="84" r="6" fill={accent} opacity=".65"/>
    <path d="M365 96L408 38L449 69L493 21L546 62L604 34L661 93" fill="none" stroke={accent} strokeWidth="3" opacity=".72" strokeLinejoin="round"/>
    <path d="M365 96H662" stroke={ink} strokeWidth="1.5" opacity=".28"/>
   </>}
   {variant===3&&<>
    <path d="M105 100H690 M145 98V51H249V98 M176 50V22H313V98 M294 97V59H381V97 M389 98V39H473V98 M489 98V68H615V98"
     fill="none" stroke={ink} strokeWidth="2.3" opacity=".64" strokeLinejoin="round"/>
    <path d="M191 41H291 M201 57H268 M201 70H268 M409 55H455 M409 70H455 M508 82H596"
     stroke={accent} strokeWidth="4" opacity=".37" strokeLinecap="round"/>
    <circle cx="660" cy="35" r="18" fill={accent} opacity=".14"/>
    <circle cx="660" cy="35" r="8" stroke={accent} fill="none" strokeWidth="2" opacity=".6"/>
   </>}
   {variant===4&&<>
    <rect x="135" y="19" width="152" height="81" rx="8" fill="white" fillOpacity=".55" stroke={ink} strokeWidth="2" opacity=".78"/>
    <path d="M157 42H267 M157 57H248 M157 72H226" stroke={accent} strokeWidth="3" strokeLinecap="round" opacity=".43"/>
    <path d="M265 82L286 100L319 62" fill="none" stroke={accent} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity=".72"/>
    <path d="M380 37H650 M380 57H622 M380 77H671 M380 97H593" stroke={ink} strokeWidth="2.5" strokeLinecap="round" opacity=".32"/>
   </>}
   {variant===5&&<>
    <path d="M158 32H284A12 12 0 0 1 296 44V70A12 12 0 0 1 284 82H228L202 103V82H158A12 12 0 0 1 146 70V44A12 12 0 0 1 158 32Z"
     fill="white" fillOpacity=".55" stroke={ink} strokeWidth="2" opacity=".75"/>
    <path d="M169 51H271 M169 63H236" stroke={accent} strokeWidth="3" opacity=".48" strokeLinecap="round"/>
    <path d="M356 58H426L470 29L519 77L565 44H667" fill="none" stroke={accent} strokeWidth="2.5" strokeLinejoin="round" opacity=".69"/>
    <path d="M356 93H667" fill="none" stroke={ink} strokeWidth="2" opacity=".24"/>
    {[426,470,519,565].map((x,i)=><circle key={x} cx={x} cy={[58,29,77,44][i]} r="6" fill={accent} opacity=".58"/>)}
   </>}
  </svg>
 </div>;
}
