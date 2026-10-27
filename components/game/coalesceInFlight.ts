/**
 * Share only requests that are still in flight. Unlike a TTL cache this cannot
 * replay an old roster after a role change, a new session, or an RLS update.
 */
export function coalesceInFlight<Key,Value>(
 pending:Map<Key,Promise<Value>>,
 key:Key,
 read:()=>Promise<Value>
):Promise<Value>{
 const current=pending.get(key);
 if(current)return current;
 const task=Promise.resolve().then(read);
 pending.set(key,task);
 const release=()=>{if(pending.get(key)===task)pending.delete(key)};
 void task.then(release,release);
 return task;
}
