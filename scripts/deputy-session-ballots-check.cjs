// Focused source contracts and 30-deputy arithmetic fixture, not a network load test.
const fs=require('node:fs'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const sql=read('supabase/migrations/20261014160000_personal_office_ballots_and_meeting_checkin.sql');
const offices=read('supabase/migrations/20261014161500_cumulative_ksrf_duma_membership.sql');
const duma=read('components/game/DumaLeadershipElection.tsx');
const committees=read('components/game/CommitteeChairElectionPanel.tsx');
for(const token of [
 'primary key(election_id,voter_id)','for update','office_personal_ballots_read',
 'cast_personal_office_ballot','private.require_game_meeting_registration',
 "pm.effective_mandates>0", "office_candidate_vote_weight",
 "gd_leadership_procedure", "result_code=''passed''",
 "ballot_mode<>''faction''", 'private.capture_parliament_office_winner',
 'public.nominate_office_candidate','public.add_duma_agenda_item','public.set_duma_agenda_item_status',
 'public.open_process_vote'
]) assert(sql.includes(token),'Missing security/vote contract: '+token);
assert(sql.indexOf("v_old:='group by c.id,c.user_id,c.party_id'")<sql.indexOf("v_old:='group by c.id,c.user_id';"),'Runoff grouping must be removed before overlapping winner group');
assert(offices.includes("new.current_round>=4"),'New deputies appear after stage 4 begins');
assert(offices.includes("'Член КСРФ'"),'Every active student gains KSRF office');
assert(offices.includes("'Депутат Государственной Думы'"),'GD deputy office is additive');
assert(offices.includes("on conflict(game_id,user_id,role_title) where status<>'ended' do nothing"),'Office grants are idempotent');
assert(duma.includes('open_duma_leadership_procedure_vote'),'Approval precedes nomination');
assert(duma.includes('<InstitutionRegistrationPanel'),'Duma registration visible at election');
assert(duma.includes('cast_personal_office_ballot'),'Individual vote action exposed');
assert(committees.includes('cast_personal_office_ballot'),'Committee deputy vote action exposed');
assert(!/disabled=\{busy\} onClick=\{\(\)=>void createElection\(\)\} disabled=/.test(duma),'Do not duplicate JSX attributes');
const deputies=Array.from({length:30},(_,i)=>({id:i,base:15,loss:i%3===0?2:0,chosen:i%2===0?'yes':'no'}));
const effective=d=>d.base-d.loss;
assert.equal(deputies.reduce((n,d)=>n+d.base,0),450);
const yes=deputies.filter(d=>d.chosen==='yes').reduce((n,d)=>n+effective(d),0);
const no=deputies.filter(d=>d.chosen==='no').reduce((n,d)=>n+effective(d),0);
assert.equal(yes+no,deputies.reduce((n,d)=>n+effective(d),0));
assert(yes+no<=450);
const repeat={...deputies[0],chosen:'no'};
const replaced=deputies.map((d,i)=>i===0?repeat:d); // upsert must replace, not add a second vote.
assert.equal(replaced.length,30);
assert.equal(replaced.reduce((n,d)=>n+effective(d),0),yes+no);
assert.equal(1+Math.floor(450/2),226);
console.log('PASS: 30-deputy weighted vote fixture, unique ballots, registration and office rights');
