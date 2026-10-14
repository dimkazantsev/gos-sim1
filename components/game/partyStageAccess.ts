import type {Game,Stage} from './types';
export function partyStageOpen(game:Game|null|undefined,stage:Stage|undefined){
 return !!game?.turn_open&&stage?.status==='open'&&(!stage.deadline||Date.parse(stage.deadline)>Date.now());
}
export function partyStageLabel(game:Game|null|undefined,stage:Stage|undefined){
 if(!stage||stage.status==='locked')return 'Этап ещё не открыт';
 if(stage.status==='completed')return 'Этап завершён';
 return partyStageOpen(game,stage)?'Этап открыт':'Этап приостановлен';
}
