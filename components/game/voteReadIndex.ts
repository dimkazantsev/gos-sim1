import type {Ballot,Member,PartyMandateAllocation} from './types';

type BallotTotals={cast:number;yes:number;no:number;abstain:number};
const emptyTotals:Readonly<BallotTotals>={cast:0,yes:0,no:0,abstain:0};

/** Lazily aggregate the immutable ballot snapshot once per ballot array. */
export function createBallotReadIndex(ballots:readonly Ballot[]){
 let totals:Map<string,BallotTotals>|undefined;
 function read(voteId:string):Readonly<BallotTotals>{
  if(!totals){
   totals=new Map();
   for(const ballot of ballots){
    const id=ballot.vote_id;
    let row=totals.get(id);
    if(!row){row={cast:0,yes:0,no:0,abstain:0};totals.set(id,row)}
    row.cast+=Number(ballot.weight);
    row.yes+=Number(ballot.yes_weight??(ballot.choice==='yes'?ballot.weight:0));
    row.no+=Number(ballot.no_weight??(ballot.choice==='no'?ballot.weight:0));
    row.abstain+=Number(ballot.abstain_weight??(ballot.choice==='abstain'?ballot.weight:0));
   }
  }
  return totals.get(voteId)??emptyTotals;
 }
 return {
  cast:(voteId:string)=>read(voteId).cast,
  tally:(voteId:string)=>{const {yes,no,abstain}=read(voteId);return {yes,no,abstain,total:yes+no+abstain}}
 };
}

/** Preserve the frozen-weight/absent-allocation distinction and original 450-seat fallback. */
export function createMandateReadIndex(members:readonly Member[],allocations:readonly PartyMandateAllocation[]){
 let effectiveByUser:Map<string,number>|undefined;
 let totalBase=0;
 let fallbackByUser:Map<string,number>|undefined;
 function effective(uid:string):number|null{
  if(!effectiveByUser){
   effectiveByUser=new Map();
   for(const allocation of allocations){
    totalBase+=Math.max(0,Number(allocation.base_mandates)||0);
    const user=allocation.user_id;
    effectiveByUser.set(user,(effectiveByUser.get(user)??0)+Math.max(0,Number(allocation.effective_mandates)||0));
   }
  }
  return effectiveByUser.get(uid)??null;
 }
 function capacity(uid:string):number{
  const allocated=effective(uid);
  if(totalBase>0)return allocated??0;
  if(!fallbackByUser){
   fallbackByUser=new Map();
   const roster=members.filter(m=>m.kind==='student'&&!m.roster_archived_at)
    .sort((a,b)=>String(a.joined_at||'').localeCompare(String(b.joined_at||''))||a.user_id.localeCompare(b.user_id));
   const base=Math.floor(450/roster.length),remainder=450%roster.length;
   roster.forEach((member,rank)=>{if(!fallbackByUser!.has(member.user_id))fallbackByUser!.set(member.user_id,base+(rank<remainder?1:0))});
  }
  return fallbackByUser.get(uid)??0;
 }
 return {effective,capacity};
}
