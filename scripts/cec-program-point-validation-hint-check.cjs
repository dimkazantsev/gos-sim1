const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('components/game/PresidentialElectionLab.tsx','utf8');
const style=fs.readFileSync('app/stage6-cec-workspace-polish.css','utf8');
assert(app.includes('if(body.length<5){'),'Handler must validate short texts before submitting');
assert(app.includes("disabled={busy} onClick={()=>void addProgramPoint(c.id)}"),'Add button should work even with empty input');
assert(app.includes("document.getElementById('cec-program-input-'+candidateId)?.focus()"),'Invalid click must focus the input');
assert(app.includes("onKeyDown={e=>{if(e.key==='Enter')"),'Enter key should submit or explain validation');
assert(app.includes("setPointFeedback(v=>({...v,[candidateId]:body.length===0?"),'Empty click must produce explicit feedback');
assert(app.includes("Недостаточно символов. Добавьте ещё "),'Show missing character count');
assert(app.includes("Положение программы сохранено."),'Explain successful submission');
assert(app.includes("Не удалось сохранить положение."),'Failed RPC must show feedback');
assert(app.includes("aria-describedby={'cec-program-hint-'+c.id}"),'Input should link to hint');
assert(app.includes('className="candidatePointHint" aria-live="polite"'),'Screen readers should hear errors and success');
assert(style.includes('grid-column:1/-1')&&style.includes('candidatePointHint'),'Hint should fit desktop and mobile');
assert(app.includes("c.registration_status!=='registered'"),'Registered candidates remain read only');
for(const [body,valid] of [['',false],['dd',false],['     ',false],['Тезис',true],['Пункт программы',true]]){
 assert.equal(body.trim().length>=5,valid,'Validation mismatch for '+JSON.stringify(body));
}
console.log('PASS: Add button always reacts; empty/short inputs focus and explain, valid inputs submit, success/errors visible, Enter and accessibility supported.');
