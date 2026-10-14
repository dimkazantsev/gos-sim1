/* Public game identifiers only. Never store login passwords or invite codes here. */
const RECENT_GAME_CODES_KEY='gos-id:recent-game-codes:v1';
const RECENT_GAME_CODES_LIMIT=5;
type GameCodeStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;

function availableStorage():GameCodeStorage|null{
 try{return typeof window==='undefined'?null:window.localStorage}catch{return null}
}

function validGameCode(value:unknown):value is string{
 return typeof value==='string'&&value.trim().length>=2&&value.trim().length<=128;
}

/** The last successfully opened game comes first; malformed storage is ignored. */
export function readRememberedGameCodes(storage:GameCodeStorage|null=availableStorage()):string[]{
 if(!storage)return [];
 try{
  const stored=JSON.parse(storage.getItem(RECENT_GAME_CODES_KEY)||'[]');
  if(!Array.isArray(stored))return [];
  return [...new Set(stored.filter(validGameCode).map(x=>x.trim()))].slice(0,RECENT_GAME_CODES_LIMIT);
 }catch{return []}
}

/** Call only after the game has been successfully joined or resumed. */
export function rememberGameCode(code:string,storage:GameCodeStorage|null=availableStorage()):string[]{
 const previous=readRememberedGameCodes(storage),trimmed=code.trim();
 if(!validGameCode(trimmed)||!storage)return previous;
 const updated=[trimmed,...previous.filter(item=>item!==trimmed)].slice(0,RECENT_GAME_CODES_LIMIT);
 try{storage.setItem(RECENT_GAME_CODES_KEY,JSON.stringify(updated));return updated}catch{return previous}
}

/** Forget the selected public game code without touching credentials or other games. */
export function forgetRememberedGameCode(code:string,storage:GameCodeStorage|null=availableStorage()):string[]{
 const updated=readRememberedGameCodes(storage).filter(item=>item!==code.trim());
 if(!storage)return updated;
 try{
  if(updated.length)storage.setItem(RECENT_GAME_CODES_KEY,JSON.stringify(updated));
  else storage.removeItem(RECENT_GAME_CODES_KEY);
 }catch{/* Private browsing and storage restrictions must not block login. */}
 return updated;
}
