/** The ZIP export was handed to the browser recently; this is not proof the file was saved. */
export const GAME_BACKUP_RECEIPT_TTL_MS=60*60*1000;

export function gameBackupReceiptKey(userId:string,gameId:string){
 return 'gos-id:game-backup-export:v1:'+userId+':'+gameId;
}

export function freshGameBackupReceipt(value:string|null|undefined,now=Date.now()){
 if(!value)return false;
 const savedAt=Number(value);
 return Number.isSafeInteger(savedAt)&&savedAt>0&&savedAt<=now&&now-savedAt<GAME_BACKUP_RECEIPT_TTL_MS;
}

export function canPermanentlyDeleteGame({busy,confirmed,typed,code,backupReady}:{busy:boolean;confirmed:boolean;typed:string;code:string;backupReady:boolean}){
 return !busy&&confirmed&&typed===code&&backupReady;
}
