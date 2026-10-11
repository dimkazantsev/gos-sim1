const assert=require('node:assert/strict');
function score(decisions,invites,winner,authorized){
 const evidence=decisions.map(d=>{
  const direct=authorized.includes(d.role);
  const eligible=decisions.filter(p=>p.id!==d.id&&p.choice===d.choice&&authorized.includes(p.role)&&invites.some(i=>i.inviter===d.id&&i.recipient===p.id&&i.status==='accepted')).map(p=>p.id);
  return {id:d.id,authority_ok:direct||eligible.length>0,delegated_ok:!direct&&eligible.length>0,best_option:d.choice===winner,roles:eligible};
 });
 const credited=evidence.filter(x=>x.authority_ok&&x.best_option);
 return evidence.map(x=>({...x,score_share:x.authority_ok&&x.best_option?Number((1/credited.length).toFixed(5)):0}));
}
const unauthorized={id:'organizer',role:'Министр культуры',choice:'option_4'};
const competent={id:'finance',role:'Министр финансов',choice:'option_4'};
const incompetent={id:'other',role:'Муниципальный советник',choice:'option_4'};
function test(name,fn){fn();console.log('PASS '+name);}
test('Solo unqualified student: no competence and no credit',()=>{
 const [a]=score([unauthorized],[],'option_4',['Министр финансов']);
 assert.equal(a.authority_ok,false);assert.equal(a.delegated_ok,false);assert.equal(a.score_share,0);assert.equal(a.best_option,true);
});
test('Accepted competent invite and same correct decision: equal fractional shares',()=>{
 const a=score([unauthorized,competent],[{inviter:'organizer',recipient:'finance',status:'accepted'}],'option_4',['Министр финансов']);
 assert.equal(a[0].delegated_ok,true);assert.deepEqual(a.map(x=>x.score_share),[0.5,0.5]);
});
test('Invitation accepted by an unqualified actor: no competence',()=>{
 const a=score([unauthorized,incompetent],[{inviter:'organizer',recipient:'other',status:'accepted'}],'option_4',['Министр финансов']);
 assert.deepEqual(a.map(x=>x.authority_ok),[false,false]);assert.deepEqual(a.map(x=>x.score_share),[0,0]);
});
test('No invitation: coincidentally identical votes do not delegate competence',()=>{
 const a=score([unauthorized,competent],[],'option_4',['Министр финансов']);
 assert.equal(a[0].authority_ok,false);assert.equal(a[0].score_share,0);assert.equal(a[1].score_share,1);
});
test('Repeated calculation is deterministic and allocation is not cumulative',()=>{
 const d=[unauthorized,competent],i=[{inviter:'organizer',recipient:'finance',status:'accepted'}];
 assert.deepEqual(score(d,i,'option_4',['Министр финансов']),score(d,i,'option_4',['Министр финансов']));
});
test('Wrong option and refused invitation do not create credit',()=>{
 const a=score([unauthorized,competent],[{inviter:'organizer',recipient:'finance',status:'declined'}],'option_2',['Министр финансов']);
 assert.deepEqual(a.map(x=>x.score_share),[0,0]);
});
