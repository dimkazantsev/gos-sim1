/** A failed Storage signing request must not become 40 identical retries.
 * Never cache capability URLs across users: the caller owns a game-scoped cache.
 * Missing immutable UUID-named objects need longer backoff than a transient 5xx.
 */
export function assetFailureBackoffMs(error:unknown):number {
 const e=error as {code?:unknown;message?:unknown;status?:unknown}|null;
 const code=typeof e?.code==='string'?e.code:'';
 const message=typeof e?.message==='string'?e.message:'';
 if(code==='NoSuchKey'||/Object not found|NoSuchKey/i.test(message))return 60*60*1000;
 return 60*1000;
}
