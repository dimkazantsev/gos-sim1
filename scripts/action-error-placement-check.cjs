/* Action-local errors preserve accessibility; all notices render above the layout. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript'),Module=require('node:module');
const file='components/game/useActionErrorPlacement.tsx';
const mod=new Module(file,module);
mod.filename=file;mod.paths=module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
}).outputText,file);
const {shouldLocalizeActionError}=mod.exports;
const now=500000;
const action={view:'parties',at:now-2000,connected:true,file:false};
assert.equal(shouldLocalizeActionError('Проверьте связанные записи и заполненные поля.','parties',action,now),true);
assert.equal(shouldLocalizeActionError('Приём приглашений завершён: председатель избран','parties',action,now),true);
assert.equal(shouldLocalizeActionError('','parties',action,now),false);
assert.equal(shouldLocalizeActionError('Сервер недоступен','votes',action,now),false,'Old view must not receive error');
assert.equal(shouldLocalizeActionError('Сервер недоступен','parties',{...action,connected:false},now),false,'Removed input must fall back to global alert');
assert.equal(shouldLocalizeActionError('Сервер недоступен','parties',{...action,at:now-40000},now),false,'Late background errors stay global');
assert.equal(shouldLocalizeActionError('Не удалось открыть игру','parties',action,now),false,'App initialization errors stay global');
assert.equal(shouldLocalizeActionError('Нет доступа к игре','parties',action,now),false,'Auth errors stay global');
assert.equal(shouldLocalizeActionError('Не удалось загрузить документ','parties',{...action,at:now-55000,file:true},now),true,'Long file upload remains linked to its field');
const client=fs.readFileSync('components/GameClient.tsx','utf8');
for(const fragment of ['useActionErrorPlacement(error,view','onClickCapture={actionError.onClickCapture}','onSubmitCapture={actionError.onSubmitCapture}','onChangeCapture={actionError.onChangeCapture}','error&&!actionError.localized','{actionError.notice}']){
 assert(client.includes(fragment),'Game main wires localized error routing: '+fragment);
}
const code=fs.readFileSync(file,'utf8');
assert(code.includes("role=\"alert\""),'Inline errors must announce to assistive technology');
assert(code.includes("aria-describedby"),'Originating control must be associated with the notice');
assert(code.includes("createPortal(")&&code.includes("document.body"),'All game errors must render above the layout, in the document portal');
assert(code.includes("document.addEventListener('pointermove'")&&code.includes("document.addEventListener('pointerdown'"),'Mouse and touch positions must be tracked');
assert(code.includes('document.activeElement')&&code.includes('getBoundingClientRect()'),'Keyboard focus fallback must be available');
assert(code.includes('const localized=!!error;'),'A background error must not paint a full-width banner');
assert(!code.includes('insertAdjacentElement'),'Errors must not shift the form or stage layout');
const css=fs.readFileSync('app/globals.css','utf8');
assert(css.includes('.actionErrorNotice')&&css.includes('position:fixed')&&css.includes('z-index:3000'),'Scoped floating error styles must be present');
assert(css.includes('calc(100vw - 24px)')&&css.includes('@media(max-width:480px)'),'Phone widths must be constrained');
console.log('PASS contextual errors: cursor overlay, keyboard/touch placement, async actions, role=alert, focus and no layout shift.');
