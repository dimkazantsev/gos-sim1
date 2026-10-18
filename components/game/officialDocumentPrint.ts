/** Print the approved official document sheet in an isolated A4 tab.
 * The application has other print visibility rules and a nested grid that
 * otherwise shrink or elongate a document in browser print preview.
 */
export function printOfficialDocument():boolean{
 if(typeof window==='undefined')return false;
 const paper=document.querySelector('.legalPortal .legalDocumentPaper');
 if(!(paper instanceof HTMLElement))return false;
 const tab=window.open('','_blank');
 if(!tab)return false;
 tab.opener=null;
 const copy=paper.cloneNode(true) as HTMLElement;
 copy.querySelectorAll('button,input,select,textarea,script,iframe,form,.formalEditActions,.documentEditNote').forEach(el=>el.remove());
 const originalImages=paper.querySelectorAll('img');
 copy.querySelectorAll('img').forEach((img,i)=>{if(originalImages[i]?.src)img.src=originalImages[i].src});
 const css=[
  '@page{size:A4 portrait;margin:16mm 18mm}',
  'html,body{margin:0!important;padding:0!important;width:auto!important;min-height:0!important;height:auto!important;background:#fff!important;color:#172b49}',
  '*,*::before,*::after{box-sizing:border-box}',
  'body{font-family:Georgia,"Times New Roman",serif;font-size:11pt;line-height:1.6}',
  '.formalPaper.legalDocumentPaper{display:block!important;position:static!important;width:100%!important;max-width:none!important;min-width:0!important;min-height:0!important;height:auto!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;transform:none!important;overflow:visible!important;background:#fff}',
  '.legalMasthead{display:grid;justify-items:center;gap:7px;text-align:center;padding:0 0 13px;border-bottom:1px solid #b7c2d0;break-inside:avoid}',
  '.legalEmblem{display:block;width:55px!important;height:65px!important;object-fit:contain}',
  '.formalPaperInstitution{font-size:11pt;font-weight:700;line-height:1.35}',
  '.legalDraftBadge{border:1px solid #b5c4d9;border-radius:4px;font-size:9pt;padding:3px 7px}',
  '.formalPaperType{font-size:12pt;font-weight:700}',
  '.formalPaperMeta{display:flex;justify-content:space-between;align-items:baseline;gap:9mm;margin:15px 0 22px;font-size:10pt;break-inside:avoid}',
  '.formalPaperMeta>*{min-width:0}',
  '.formalPaper h1{font-family:Georgia,"Times New Roman",serif;font-size:15pt;line-height:1.45;text-align:center;overflow-wrap:anywhere;margin:18px 0 26px;break-after:avoid}',
  '.formalPaperBody{display:block!important;width:100%!important;max-width:none!important;margin:0!important;font-family:Georgia,"Times New Roman",serif;font-size:11.5pt;line-height:1.6;text-align:justify}',
  '.formalPaperBody p{margin:0 0 12pt;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal}',
  '.formalPaperBody :is(table,figure){max-width:100%;break-inside:avoid}',
  '.formalPaperBody img,.formalSignature img{max-width:100%;height:auto}',
  '.formalSignature{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-top:29px;padding-top:15px;border-top:1px solid #cdd5e0;break-inside:avoid}',
  '.formalSignatureList{display:grid;gap:12pt;margin-top:20pt}.formalSignatureList .formalSignature{margin-top:0}',
  '.formalSignature>div{display:grid;gap:4px;font-size:10pt;min-width:0}',
  '.formalSignature b{font-weight:700}.formalSignature small{font-size:9pt}',
  '.formalSignatureImage{max-width:50%;margin:0}',
  '.legalPaperFooterBar{display:block;margin-top:25px;padding-top:12px;border-top:1px solid #cdd5e0;font-size:9pt;color:#4b607e;break-inside:avoid}',
  '.legalPaperFooterBar button{display:none!important}',
  'svg{max-width:100%;height:auto}',
  '@media screen{body{padding:24px;background:#e8edf4} .formalPaper.legalDocumentPaper{max-width:176mm!important;margin:0 auto!important;padding:16mm 18mm!important;box-shadow:0 3px 20px #2222!important}}',
  '@media print{html,body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.legalDocumentPaper{break-inside:auto!important}}'
 ].join('\n');
 const doc=tab.document;
 doc.open();
 doc.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body>'+copy.outerHTML+'</body></html>');
 doc.close();
 doc.title=(paper.querySelector('h1')?.textContent||'Документ')+' — печать';
 void (async()=>{
  try{
   await Promise.all([tab.document.fonts.ready,...Array.from(tab.document.images).map(img=>img.complete?Promise.resolve():new Promise<void>(resolve=>{img.onload=()=>resolve();img.onerror=()=>resolve()}))]);
  }catch{}
  if(!tab.closed){tab.focus();tab.print()}
 })();
 return true;
}
