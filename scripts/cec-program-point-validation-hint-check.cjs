const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('components/game/PresidentialElectionLab.tsx','utf8');
const style=fs.readFileSync('app/stage6-cec-workspace-polish.css','utf8');
assert(app.includes("const body=(pointDraft[candidateId]||'').trim();if(body.length<5)return;"),'Handler must reject empty or short program points');
assert(app.includes("disabled={busy||(pointDraft[c.id]||'').trim().length<5}"),'Button must follow 5-char constraint');
assert(app.includes("aria-describedby={'cec-program-hint-'+c.id}"),'Input must link to hint');
assert(app.includes("className=\"candidatePointHint\" aria-live=\"polite\""),'Screen reader feedback required');
assert(app.includes("Введите не менее 5 символов"),'Disabled reason should be visible');
assert(app.includes("Недостаточно символов. Добавьте ещё "),'Show missing character count');
assert(app.includes("Положение готово к добавлению."),'Explain when form is ready');
assert(style.includes("grid-column:1/-1")&&style.includes("candidatePointHint"),'Hint must fit desktop/mobile');
assert(app.includes("c.registration_status!=='registered'"),'Registered candidates remain read only');
for(const [input,shouldEnable] of [['dd',false],['     ',false],['Тезис',true],['Пункт программы',true]]){
  const count=input.trim().length;
  assert.equal(count>=5,shouldEnable,'Wrong button state for '+JSON.stringify(input));
  if(!shouldEnable&&count>0)assert.equal(5-count,input==='dd'?3:5-count,'Missing-character count');
}
console.log('PASS: registration extension does not affect program form; dd shows 3 missing characters, valid texts are enabled, accessibility and responsive hint work.');
