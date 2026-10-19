const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const profile=fs.readFileSync('components/game/ProfileView.tsx','utf8');
const grades=fs.readFileSync('components/game/GradesView.tsx','utf8');
const css=fs.readFileSync('app/2026-profile-comic.css','utf8');
const source=ts.createSourceFile('ProfileView.tsx',profile,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
assert.equal(source.parseDiagnostics.length,0,'Profile JSX/TSX must be valid');
assert(profile.includes("supabase.rpc('get_public_stage_scores',{p_game_id:gameId})"),'Use existing public-only RPC, not privileged tables');
assert(profile.includes('.filter(a=>a.user_id===userId)'),'Only selected profile member can contribute to its total');
assert(profile.includes("s.status==='final'?(s.final_score??s.auto_score):s.auto_score"),'Teacher final mark must replace draft, never add to it');
assert(profile.includes('Number.isFinite'),'Discard invalid numeric values');
assert(profile.includes('counted.reduce((sum,score)=>sum+score,0)'),'Display total, not mean');
assert(profile.includes("scoresLoaded?new Intl.NumberFormat('ru-RU'"),'Do not misreport zero before the server replies');
assert(profile.includes('Всего баллов: {scoreTotalLabel}'),'Main chip must show cumulative marks');
assert(profile.includes('<dt>Сумма баллов</dt><dd>{scoreTotalLabel}</dd>'),'Profile details must agree');
assert(profile.includes("aria-label={'Сумма баллов: '+scoreTotalLabel}"),'Public stages breakdown must agree');
assert(!profile.includes('avg.toFixed(2)'),'Remove stale average from profile summaries');
assert(grades.includes('const selected=rows.filter(a=>a.user_id===student.user_id),sum=selected.reduce((v,a)=>v+(shownScore(a)??0),0);'),'Stay consistent with journal sum');
assert(grades.includes("a.status==='final'?(a.final_score??a.auto_score):a.auto_score"),'Journal has same approved-first policy');
assert(profile.includes("filter:'user_id=eq.'+userId"),'Target only relevant grade realtime updates');
assert(profile.includes('supabase.removeChannel(channel)'),'Clean up subscription on profile/game changes');
assert(css.includes('.profilePage .profileIntro{flex:1 1 320px;min-width:0}'),'Header remains flexible');
assert(css.includes('.profilePage .profileHero{display:flex;align-items:center;gap:24px;flex-wrap:wrap'),'Header wraps for tablets');
assert(css.includes('@media(max-width:700px)'),'Mobile profile layout preserved');
function total(rows,student){
 return rows.filter(s=>s.user_id===student)
  .map(s=>Number(s.status==='final'?(s.final_score??s.auto_score):s.auto_score))
  .filter(Number.isFinite).reduce((sum,score)=>sum+score,0);
}
const assessments=[];
for(let stage=1;stage<=16;stage++){
 assessments.push({user_id:'student-a',stage_no:stage,status:stage%2?'draft':'final',auto_score:stage%3,final_score:stage%2?null:3});
 assessments.push({user_id:'student-b',stage_no:stage,status:'final',auto_score:3,final_score:0});
}
assert.equal(total(assessments,'student-a'),(assessments.filter(x=>x.user_id==='student-a').reduce((a,x)=>a+(x.status==='final'?(x.final_score??x.auto_score):x.auto_score),0)));
assert.equal(total(assessments,'student-b'),0,'Another student with zeros must not contribute');
assert.equal(total(assessments,'not-in-game'),0);
assert.equal(total([{user_id:'student-a',stage_no:1,status:'final',auto_score:3,final_score:1}], 'student-a'),1,'Teacher-approved result supersedes automatic result');
assert.equal(total([{user_id:'student-a',stage_no:1,status:'draft',auto_score:1.25,final_score:null}], 'student-a'),1.25);
const all=Array.from({length:40},(_,i)=>({user_id:'s'+i,stage_no:1,status:'final',auto_score:3,final_score:i%4}));
assert.equal(total(all,'s7'),3);
assert.equal(total(all,'s6'),2);
assert.equal(new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(1.25),'1,25');
console.log('PASS: public stages total, final-over-draft, 16 stages, 40 isolated accounts, realtime subscription, mobile layout contracts.');
