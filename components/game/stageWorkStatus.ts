import type {Game,Stage} from './types';

// One source of truth for student-facing work on a stage. An 'open' row
// must not override a game still in the lobby or a paused/expired turn.
export function isStageWorkOpen(game:Game|null|undefined,stage:Stage|undefined){
 return !!game&&!!stage&&game.id===stage.game_id&&game.status==='running'&&
  game.turn_open&&stage.status==='open'&&
  (!stage.deadline||Date.parse(stage.deadline)>Date.now())&&
  (!game.turn_ends_at||Date.parse(game.turn_ends_at)>Date.now());
}
export function stageWorkLabel(game:Game|null|undefined,stage:Stage){
 if(stage.status==='completed')return 'Этап завершён';
 if(stage.status!=='open'||!game||game.status==='lobby')return 'Этап ещё не открыт';
 if(stage.score_closed_at)return 'Оформление документов · без начисления баллов';
 return isStageWorkOpen(game,stage)?'Этап открыт':'Этап приостановлен';
}
