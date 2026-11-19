// A Duma ballot freezes its electorate when the vote opens. While the
// optional party-mandate projection is cold, never substitute 450 / roster
// size for an already verified snapshot. Server cast_vote_allocation always
// checks current mandates and attendance independently before saving.
export function gdVoteAllowance(
 frozenWeight:number,
 declaredPresent:number|null|undefined,
 cachedEffective:number|null|undefined
):number{
 const frozen=Number.isFinite(frozenWeight)?Math.max(0,Math.floor(frozenWeight)):0;
 const declared=declaredPresent==null?frozen:
  Number.isFinite(declaredPresent)?Math.max(0,Math.floor(declaredPresent)):0;
 const effective=cachedEffective==null?frozen:
  Number.isFinite(cachedEffective)?Math.max(0,Math.floor(cachedEffective)):0;
 return Math.min(frozen,declared,effective);
}
