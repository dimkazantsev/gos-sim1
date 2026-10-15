/* Browser regression for action-scoped errors, plus real helper and integration checks. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {chromium}=require('playwright-core');

const component=fs.readFileSync('components/game/ContextualGameError.tsx','utf8');
const app=fs.readFileSync('components/GameClient.tsx','utf8');
const parties=fs.readFileSync('components/game/PartiesView.tsx','utf8');
const hook=fs.readFileSync('components/game/useRepublicGame.ts','utf8');
const css=fs.readFileSync('app/globals.css','utf8');
assert(app.includes('onClickCapture={onGameActionClick}')&&app.includes('onChangeCapture={onGameFieldChange}')&&app.includes('onSubmitCapture={onGameFormSubmit}'),
 'Clicks, form submits and field changes must capture their origin');
assert(app.includes('<ContextualGameError error={error}')&&!app.includes('{error&&<div className="errorBox'),
 'The global error banner must be replaced by the shared contextual surface');
assert(component.includes('action.view!==view')&&component.includes('ACTION_ERROR_WINDOW_MS'),
 'Stale errors and actions from another view must fall back to a global banner');
assert(component.includes('if(!element.isConnected||!element.getClientRects().length)return'),
 'A removed or hidden action must never receive a detached error');
assert(component.includes('createPortal(notice,slot)')&&component.includes('return slot?createPortal(notice,slot):notice'),
 'Inline notice is portaled next to its origin and background errors remain visible globally');
assert(parties.includes("setInviteFeedback({partyId,kind:'error',message});")&&!parties.includes("setInviteFeedback({partyId,kind:'error',message});g.setError(message);"),
 'Invitation errors must not duplicate the local message in the global banner');
assert(hook.includes('if(onFailure)onFailure(userError(r.error));else setError(r.error)'),
 'Invitation RPC must report the translated error to the local form');

const browserPath=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!browserPath)throw Error('Chromium or Chrome required for contextual error layout tests');
const runtime=ts.transpileModule(component,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>*{box-sizing:border-box}body{margin:0;background:#f5f8fe;font:14px Arial,sans-serif}
#game-main{margin:16px auto;width:calc(100% - 32px);max-width:850px;padding:14px;border-radius:12px;background:#fff}
.fixtureForm{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;padding:10px}
.fixtureForm input{min-height:44px;width:100%;padding:9px}
.fixtureForm button{min-height:46px;border-radius:9px;border:1px solid #b5c6e4;background:#eaf2ff}
.fixtureRow{display:flex;flex-flow:row nowrap;gap:8px;max-width:100%}
.fixtureRow button{flex:0 0 auto}
${css}</style></head><body><header><button id="outer">Вне игры</button></header>
<main id="game-main"><div class="fixtureForm">
 <label>Название <input id="field" value="Название"></label>
 <button id="save"><span id="nested">Сохранить вариант</span></button>
 <div class="fixtureRow"><button id="invite">Пригласить</button><button id="cancel">Отменить</button></div>
 <button id="disabled" disabled>Недоступно</button>
</div></main></body></html>`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage();
  for(const width of [1440,1024,768,390,320]){
   await page.setViewportSize({width,height:780});
   await page.setContent(fixture);
   await page.addScriptTag({content:'(()=>{const exports={};const require=()=>({});'+runtime+';window.testErrorOrigin=exports.findGameErrorAction;})();'});
   const result=await page.evaluate(()=>{
    const root=document.getElementById('game-main');
    const find=window.testErrorOrigin;
    const findId=id=>find(document.getElementById(id),root);
    if(findId('nested')!==document.getElementById('save'))throw Error('Nested button content did not resolve to action');
    if(findId('outer')||findId('disabled'))throw Error('Outside or disabled button must not be an action');
    const snap=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width}};
    const save=document.getElementById('save');
    const inline=document.createElement('div');inline.className='gameActionErrorSlot';inline.setAttribute('data-game-error-surface','');
    inline.innerHTML='<div class="gameActionError" role="alert"><div class="gameActionErrorCopy"><strong>Действие: Сохранить вариант</strong><span>Проверьте связанные записи и заполненные поля.</span></div><button aria-label="Закрыть">×</button></div>';
    save.insertAdjacentElement('afterend',inline);
    const form=document.querySelector('.fixtureForm');
    const saveRect=snap(save),inlineRect=snap(inline);
    if(inline.previousElementSibling!==save)throw Error('Notice is not adjacent to the failed button');
    if(inlineRect.top<saveRect.bottom-1)throw Error('Error overlaps the save button');
    if(inlineRect.right>snap(form).right+1)throw Error('Notice exceeds form width');
    const row=document.querySelector('.fixtureRow');
    const rowSlot=document.createElement('div');rowSlot.className='gameActionErrorSlot';
    const invite=document.getElementById('invite');
    const computed=getComputedStyle(row);
    const rowFlex=computed.display.includes('flex')&&computed.flexDirection.startsWith('row')&&computed.flexWrap==='nowrap';
    (rowFlex&&row?row:invite).insertAdjacentElement('afterend',rowSlot);
    rowSlot.innerHTML='<div class="gameActionError">Отправка приглашения не удалась.</div>';
    const rowRect=snap(row),rowSlotRect=snap(rowSlot);
    if(rowSlot.previousElementSibling!==row||rowSlotRect.top<rowRect.bottom-1)throw Error('Nonwrapping toolbar lost space or overlapped');
    if(document.documentElement.scrollWidth>innerWidth+2)throw Error('Error notice caused horizontal page overflow');
    return {action:saveRect,notice:inlineRect,row:rowRect,rowNotice:rowSlotRect};
   });
   console.log('PASS contextual error '+width+'px: adjacent to action, flexible row intact, no horizontal overflow',result.notice.width);
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
